import axios, { AxiosError, InternalAxiosRequestConfig } from 'axios';
import type {
  AnalyticsSummary,
  BodyPartBalance,
  Category,
  CategoryCreate,
  CategoryStats,
  ComparisonResult,
  DuplicateHandling,
  ImportPreviewResult,
  ImportResult,
  Muscle,
  MuscleComparison,
  MuscleHeatmapData,
  MuscleStats,
  OverviewStats,
  PaginatedSequenceResponse,
  PDFExportOptions,
  Pose,
  PoseListItem,
  PoseCreate,
  PoseUpdate,
  PoseVersionDetail,
  PoseVersionListItem,
  GenerateResponse,
  ApiError,
  LoginRequest,
  RateLimitError,
  RecentActivity,
  ReorderPosesRequest,
  RestoreVersionRequest,
  Sequence,
  SequenceCreate,
  SequencePoseCreate,
  SequencePoseUpdate,
  SequenceUpdate,
  TokenPairResponse,
  User,
  UserUpdate,
  VersionComparisonResult,
  VersionCountResponse,
} from '../types';
import { getAuthToken, useAuthStore } from '../store/useAuthStore';
import { logger } from '../lib/logger';
import {
  API_TIMEOUT_MS,
  TOKEN_REFRESH_JITTER_MS,
  TOKEN_REFRESH_THRESHOLD_MS,
  TOKEN_BACKGROUND_REFRESH_MS,
  TOKEN_VISIBILITY_DEBOUNCE_MS,
  TOKEN_RETRY_BASE_MS,
  TOKEN_RETRY_MAX_MS,
  TOKEN_MAX_RETRIES,
} from '../lib/constants';

// Get API URL from env or use relative path (for same-origin requests)
// Remove trailing slashes to prevent double-slash issues (e.g., "https://api.example.com/" + "${API_V1_PREFIX}/poses" = "https://api.example.com/${API_V1_PREFIX}/poses")
const rawApiUrl = import.meta.env.VITE_API_URL || window.location.origin;

const getPageProtocol = (): string => (typeof window !== 'undefined' ? window.location.protocol : 'http:');
const getPageOrigin = (): string => (typeof window !== 'undefined' ? window.location.origin : '');

const ensureHttpsIfNeeded = (url: string, pageProtocol: string = getPageProtocol()): string => {
  // Avoid mixed-content: if the app is served over HTTPS, force HTTPS for any http:// URL.
  if (pageProtocol === 'https:' && url.startsWith('http://')) {
    return url.replace(/^http:\/\//, 'https://');
  }
  return url;
};

const canNormalizeLegacyHostPath = (raw: string): boolean => {
  const firstSegment = raw.split('/', 1)[0];
  if (!firstSegment.includes('.') || firstSegment.includes(' ')) {
    return false;
  }
  if (!raw.includes('/')) {
    return false;
  }

  // Keys like "abc123.photo.png" are object names, not hostnames.
  const fileLikeTlds = new Set(['png', 'jpg', 'jpeg', 'webp', 'gif', 'svg']);
  const tld = firstSegment.split('.').pop()?.toLowerCase() || '';
  if (fileLikeTlds.has(tld)) {
    return false;
  }

  return true;
};

const normalizeDirectImageUrl = (directPath: string | null | undefined): string | null => {
  if (!directPath) return null;
  const trimmed = directPath.trim();
  if (!trimmed) return null;
  if (trimmed.startsWith('http://') || trimmed.startsWith('https://')) {
    return ensureHttpsIfNeeded(trimmed);
  }
  if (trimmed.startsWith('//')) {
    const protocol = getPageProtocol();
    return ensureHttpsIfNeeded(`${protocol}${trimmed}`);
  }
  if (trimmed.startsWith('/')) return null;
  // Legacy rows may contain host/path without scheme.
  if (canNormalizeLegacyHostPath(trimmed)) {
    return ensureHttpsIfNeeded(`https://${trimmed}`);
  }
  return null;
};

const normalizeApiBaseUrl = (
  raw: string,
  opts: { pageOrigin?: string; pageProtocol?: string } = {}
): string => {
  const fallback = opts.pageOrigin ?? getPageOrigin();
  const pageProtocol = opts.pageProtocol ?? getPageProtocol();
  const input = raw?.trim() ? raw.trim() : fallback;

  try {
    const url = new URL(input, fallback || undefined);

    // Avoid mixed content on HTTPS pages
    if (pageProtocol === 'https:' && url.protocol === 'http:') {
      url.protocol = 'https:';
    }

    // Normalize base path:
    // - remove trailing slashes
    // - if user mistakenly includes /api or /api/v1 in VITE_API_URL, strip it
    url.pathname = url.pathname.replace(/\/+$/, '');
    url.pathname = url.pathname.replace(/\/api\/v1$/, '');
    url.pathname = url.pathname.replace(/\/api$/, '');

    const normalized = `${url.origin}${url.pathname}`.replace(/\/+$/, '');
    return ensureHttpsIfNeeded(normalized, pageProtocol);
  } catch {
    // If it's not a valid URL, fall back to same-origin.
    return fallback.replace(/\/+$/, '');
  }
};

const API_BASE_URL = normalizeApiBaseUrl(rawApiUrl);

// API version prefix - all endpoints use /api/v1/
const API_V1_PREFIX = '/api/v1';

// Debug log (dev only)
logger.debug('API_BASE_URL:', API_BASE_URL);
logger.debug('API_V1_PREFIX:', API_V1_PREFIX);

/**
 * Get proxy URL for pose images to bypass S3 CORS restrictions.
 *
 * SECURITY: This function NO LONGER passes the JWT token as a query parameter.
 * Token-in-URL leaks to server logs, browser history, and referrer headers.
 *
 * Instead, the backend generates signed temporary URLs with HMAC signatures.
 * For image requests:
 * 1. First call the API endpoint to get a signed URL
 * 2. Use the signed URL (valid for ~5 minutes)
 *
 * For simple use cases where the image is loaded directly, the browser will
 * send the Authorization header with the Bearer token.
 *
 * @param poseId - The pose ID
 * @param imageType - Type of image: 'schema' | 'photo' | 'muscle_layer' | 'skeleton_layer'
 * @returns Base URL for the image (use with Authorization header)
 */
export const getImageProxyUrl = (
  poseId: number,
  imageType: 'schema' | 'photo' | 'muscle_layer' | 'skeleton_layer'
): string => {
  // SECURITY: NO LONGER passing token in URL
  // The image endpoint now requires either:
  // 1. Authorization header (for fetch/axios requests)
  // 2. Signed URL parameters (for <img> tags where headers can't be set)
  return `${API_BASE_URL}${API_V1_PREFIX}/poses/${poseId}/image/${imageType}`;
};

/**
 * Get the best URL for displaying an image in <img> tags.
 * For local storage paths (/storage/...), returns the direct path (served by Vite proxy).
 * For remote URLs or when no direct path is available, falls back to proxy endpoint.
 *
 * @param directPath - The direct path from the pose object (e.g., pose.photo_path)
 * @param poseId - The pose ID (used for fallback proxy URL)
 * @param imageType - Type of image (used for fallback proxy URL)
 * @returns URL suitable for <img> src attribute
 */
export const getImageUrl = (
  directPath: string | null | undefined,
  poseId: number,
  imageType: 'schema' | 'photo' | 'muscle_layer' | 'skeleton_layer'
): string => {
  // If we have a direct local storage path, use it (Vite proxy serves /storage)
  if (directPath && directPath.startsWith('/storage/')) {
    return directPath;
  }
  const normalizedDirect = normalizeDirectImageUrl(directPath);
  if (normalizedDirect) {
    return normalizedDirect;
  }
  // Fallback to proxy endpoint (requires auth - may not work for <img> tags)
  return getImageProxyUrl(poseId, imageType);
};

type TransientRetryError = Error & {
  isRateLimited?: boolean;
  retryAfter?: number;
  status?: number;
};

const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

const getTransientStatusCode = (error: unknown): number | undefined => {
  const anyErr = error as TransientRetryError;
  if (axios.isAxiosError(error)) {
    return error.response?.status;
  }
  return anyErr?.status ?? (anyErr?.isRateLimited ? 429 : undefined);
};

const getTransientRetryDelayMs = (error: unknown, attempt: number): number => {
  const anyErr = error as TransientRetryError;
  const statusCode = getTransientStatusCode(error);
  const retryAfterMs =
    statusCode === 429 &&
    anyErr?.isRateLimited &&
    typeof anyErr.retryAfter === "number"
      ? Math.max(250, Math.floor(anyErr.retryAfter * 1000))
      : null;
  const backoffMs = Math.min(100 * (2 ** attempt), 1500) + Math.floor(Math.random() * 100);
  return Math.min(retryAfterMs ?? backoffMs, 10_000);
};

const withTransientRetry = async <T>(
  operation: () => Promise<T>,
  maxAttempts: number = 5
): Promise<T> => {
  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    try {
      return await operation();
    } catch (error) {
      const statusCode = getTransientStatusCode(error);
      const isTransient = statusCode === 409 || statusCode === 429 || statusCode === 503;
      if (!isTransient || attempt >= maxAttempts - 1) {
        throw error;
      }
      // eslint-disable-next-line no-await-in-loop
      await sleep(getTransientRetryDelayMs(error, attempt));
    }
  }

  throw new Error("Transient retry loop exhausted");
};

/**
 * Fetch a signed URL for an image that can be used in <img> tags.
 * The signed URL includes HMAC signature and expiration, not the actual JWT token.
 *
 * @param poseId - The pose ID
 * @param imageType - Type of image
 * @returns Promise resolving to the signed URL
 */
export const getSignedImageUrl = async (
  poseId: number,
  imageType: 'schema' | 'photo' | 'muscle_layer' | 'skeleton_layer',
  options: { allowProxyFallback?: boolean } = {}
): Promise<string> => {
  try {
    const response = await withTransientRetry(() =>
      api.get<{ signed_url: string }>(
        `${API_V1_PREFIX}/poses/${poseId}/image/${imageType}/signed-url`
      )
    );
    return ensureHttpsIfNeeded(response.data.signed_url);
  } catch (error) {
    logger.warn(`Failed to get signed URL for pose ${poseId} ${imageType}:`, error);
    if (options.allowProxyFallback) {
      return getImageProxyUrl(poseId, imageType);
    }
    throw error;
  }
};

// Test-only exports (kept under a stable name to avoid accidental production usage)
export const __test__ = {
  ensureHttpsIfNeeded,
  normalizeDirectImageUrl,
  normalizeApiBaseUrl,
};

/**
 * Get the current locale from localStorage for Accept-Language header.
 * Maps 'ua' to 'uk' for proper HTTP Accept-Language header (ISO 639-1).
 */
const getCurrentLocale = (): string => {
  if (typeof window === 'undefined') {
    return 'uk'; // Default to Ukrainian for SSR
  }
  const stored = window.localStorage.getItem('yoga_locale');
  if (stored === 'ua') return 'uk';
  if (stored === 'en') return 'en';
  return 'uk'; // Default to Ukrainian
};

const api = axios.create({
  baseURL: API_BASE_URL,
  // Don't set Content-Type here - axios will set it automatically
  // For JSON requests it will be application/json
  // For FormData it will be multipart/form-data with boundary
  withCredentials: true, // Enable cookies for refresh token
  timeout: API_TIMEOUT_MS,
});

/**
 * SECURITY FIX: Token refresh with proper Promise queuing
 *
 * Problem: Race condition where concurrent requests could trigger multiple refresh
 * attempts, causing the backend to revoke all tokens (token reuse detection).
 *
 * Solution: Use a single Promise for the refresh operation that all concurrent
 * requests await. This ensures only one refresh request is made at a time.
 */

// Single Promise for the current refresh operation - prevents race conditions
let refreshPromise: Promise<string | null> | null = null;

/**
 * Get the refresh threshold with jitter to prevent thundering herd.
 * Base threshold: 60 seconds before expiry.
 * Add random jitter between 0-5 seconds to prevent all clients refreshing at once.
 */
const getRefreshThreshold = (): number => {
  return TOKEN_REFRESH_THRESHOLD_MS + Math.random() * TOKEN_REFRESH_JITTER_MS;
};

/**
 * Check if token should be refreshed with jitter to prevent thundering herd.
 */
const shouldRefreshTokenWithJitter = (): boolean => {
  const { tokenExpiresAt } = useAuthStore.getState();
  if (!tokenExpiresAt) return false;
  return Date.now() >= tokenExpiresAt - getRefreshThreshold();
};

/**
 * Refresh the access token using the httpOnly cookie refresh token.
 *
 * SECURITY: The refresh token is stored in an httpOnly cookie, not in localStorage.
 * This function sends the request with credentials, and the server reads the
 * refresh token from the cookie.
 *
 * Uses Promise queuing to prevent race conditions when multiple requests
 * need a refresh simultaneously.
 */
const refreshAccessToken = async (): Promise<string | null> => {
  // If a refresh is already in progress, wait for it
  if (refreshPromise) {
    return refreshPromise;
  }

  // Create a new refresh promise
  refreshPromise = (async () => {
    try {
      const existingAccessToken = getAuthToken();
      const inMemoryRefreshToken = useAuthStore.getState().refreshToken;
      let csrfToken = getCsrfToken();

      // Self-heal CSRF cookie when access token is still valid but csrf_token expired/missing.
      // Use raw axios (not `api`) to avoid interceptor recursion during refresh flow.
      if (!csrfToken && existingAccessToken) {
        try {
          await axios.get<User>(
            `${API_BASE_URL}${API_V1_PREFIX}/auth/me`,
            {
              withCredentials: true,
              headers: {
                Authorization: `Bearer ${existingAccessToken}`,
              },
            }
          );
          csrfToken = getCsrfToken();
        } catch {
          // Best-effort bootstrap only; refresh request will continue.
        }
      }
      const refreshHeaders: Record<string, string> = {};
      if (csrfToken) {
        refreshHeaders["X-CSRF-Token"] = csrfToken;
      }
      if (existingAccessToken) {
        // Helps backend treat refresh as same-user browser flow when possible.
        refreshHeaders.Authorization = `Bearer ${existingAccessToken}`;
      }

      // Prefer httpOnly cookie refresh in browser flows.
      // Fallback to in-memory refresh token when cookie context is blocked/misconfigured
      // (e.g. SameSite issues across origins). Token is never persisted to localStorage.
      const refreshBody = inMemoryRefreshToken
        ? { refresh_token: inMemoryRefreshToken }
        : {};
      const response = await axios.post<TokenPairResponse>(
        `${API_BASE_URL}${API_V1_PREFIX}/auth/refresh`,
        refreshBody,
        {
          withCredentials: true,
          headers: refreshHeaders,
        }
      );

      const { access_token, refresh_token, expires_in, user } = response.data;

      // Update store with rotated tokens.
      // refresh_token is held in-memory only (not persisted) as a resilience fallback.
      useAuthStore.getState().setAuth(user, access_token, refresh_token, expires_in);

      return access_token;
    } catch (error) {
      // Only logout on hard auth failures (401).
      // 403 during refresh is often CSRF/cookie-context related and should not
      // immediately destroy local auth state.
      // Do NOT logout on rate limiting (429), network errors, or other transient failures
      // TokenManager's retry logic will handle transient failures
      if (axios.isAxiosError(error)) {
        const status = error.response?.status;
        const detail = (() => {
          const data = error.response?.data as unknown;
          if (data && typeof data === 'object' && 'detail' in (data as Record<string, unknown>)) {
            const value = (data as Record<string, unknown>).detail;
            return typeof value === 'string' ? value : null;
          }
          return null;
        })();

        if (status === 401) {
          // Hard auth failure - refresh token is invalid/expired/revoked.
          logger.warn('Token refresh failed with 401 auth error, logging out');
          useAuthStore.getState().logout();
          return null;
        }

        if (status === 403) {
          logger.warn(`Token refresh forbidden (403): ${detail ?? 'no detail'}`);
          return null;
        }

        if (status === 429) {
          // Rate limited - don't logout, just return null
          logger.warn('Token refresh rate limited');
          return null;
        }

        // Other server errors - don't logout
        logger.warn(`Token refresh failed with status ${status}`);
        return null;
      }

      // Network error or other non-Axios error - don't logout
      logger.warn('Token refresh failed with network error');
      return null;
    } finally {
      // Clear the promise so future refreshes can proceed
      refreshPromise = null;
    }
  })();

  return refreshPromise;
};

// =============================================================================
// TokenManager - Comprehensive token lifecycle management
// =============================================================================

/**
 * Message types for cross-tab communication via BroadcastChannel.
 */
interface TokenBroadcastMessage {
  type: 'TOKEN_REFRESHED' | 'LOGOUT';
  data?: {
    accessToken?: string;
    expiresIn?: number;
  };
}

/**
 * TokenManager handles all aspects of token lifecycle:
 * 1. Silent refresh on startup (when token is expired but refresh cookie exists)
 * 2. Visibility change refresh (when user returns to tab)
 * 3. Background periodic refresh (proactive refresh before expiry)
 * 4. Retry with exponential backoff (resilient to transient failures)
 * 5. Offline detection (graceful handling when network is unavailable)
 * 6. Cross-tab coordination (sync logout/refresh across browser tabs)
 * 7. Heartbeat keepalive (prevent session timeout on inactive tabs)
 */
class TokenManager {
  private static instance: TokenManager | null = null;
  private backgroundTimer: ReturnType<typeof setInterval> | null = null;
  private visibilityDebounceTimer: ReturnType<typeof setTimeout> | null = null;
  private broadcastChannel: BroadcastChannel | null = null;
  private isOnline = typeof navigator !== 'undefined' ? navigator.onLine : true;
  private retryCount = 0;
  private isStarted = false;

  // Event handler references for cleanup
  private boundHandleVisibilityChange: () => void;
  private boundHandleOnline: () => void;
  private boundHandleOffline: () => void;
  private boundHandleStorageEvent: (e: StorageEvent) => void;

  private constructor() {
    // Bind methods to preserve 'this' context
    this.boundHandleVisibilityChange = this.handleVisibilityChange.bind(this);
    this.boundHandleOnline = this.handleOnline.bind(this);
    this.boundHandleOffline = this.handleOffline.bind(this);
    this.boundHandleStorageEvent = this.handleStorageEvent.bind(this);
  }

  /**
   * Get singleton instance of TokenManager.
   */
  static getInstance(): TokenManager {
    if (!TokenManager.instance) {
      TokenManager.instance = new TokenManager();
    }
    return TokenManager.instance;
  }

  /**
   * Start all token management mechanisms.
   * Should be called when user is authenticated (e.g., from App.tsx on mount).
   */
  start(): void {
    if (this.isStarted) {
      logger.debug('TokenManager already started');
      return;
    }

    logger.debug('TokenManager starting...');
    this.isStarted = true;

    // Initialize cross-tab communication
    this.initBroadcastChannel();

    // Start listening to browser events
    if (typeof document !== 'undefined') {
      document.addEventListener('visibilitychange', this.boundHandleVisibilityChange);
    }
    if (typeof window !== 'undefined') {
      window.addEventListener('online', this.boundHandleOnline);
      window.addEventListener('offline', this.boundHandleOffline);
    }

    // Start background refresh timer
    this.startBackgroundRefresh();

    logger.info('TokenManager started');
  }

  /**
   * Stop all token management mechanisms.
   * Should be called on logout or when App unmounts.
   */
  stop(): void {
    if (!this.isStarted) {
      return;
    }

    logger.debug('TokenManager stopping...');
    this.isStarted = false;

    // Stop background refresh
    this.stopBackgroundRefresh();

    // Clear visibility debounce timer
    if (this.visibilityDebounceTimer) {
      clearTimeout(this.visibilityDebounceTimer);
      this.visibilityDebounceTimer = null;
    }

    // Remove event listeners
    if (typeof document !== 'undefined') {
      document.removeEventListener('visibilitychange', this.boundHandleVisibilityChange);
    }
    if (typeof window !== 'undefined') {
      window.removeEventListener('online', this.boundHandleOnline);
      window.removeEventListener('offline', this.boundHandleOffline);
      window.removeEventListener('storage', this.boundHandleStorageEvent);
    }

    // Close broadcast channel
    if (this.broadcastChannel) {
      this.broadcastChannel.close();
      this.broadcastChannel = null;
    }

    logger.info('TokenManager stopped');
  }

  /**
   * Perform a silent token refresh without user interaction.
   * Returns true if refresh was successful or not needed, false otherwise.
   */
  async silentRefresh(): Promise<boolean> {
    const state = useAuthStore.getState();
    const { accessToken, tokenExpiresAt } = state;

    // No token means not authenticated - nothing to refresh
    if (!accessToken) {
      logger.debug('silentRefresh: No access token, skipping');
      return false;
    }

    // Check if token is expired or close to expiry
    const isExpired = tokenExpiresAt ? Date.now() >= tokenExpiresAt : false;
    const shouldRefresh = tokenExpiresAt
      ? Date.now() >= tokenExpiresAt - getRefreshThreshold()
      : false;

    // Token is still valid and not close to expiry
    if (!isExpired && !shouldRefresh) {
      logger.debug('silentRefresh: Token still valid, skipping');
      return true;
    }

    // Check network status
    if (!this.isOnline) {
      logger.warn('silentRefresh: Offline, cannot refresh token');
      state.setRefreshError('Network offline');
      return false;
    }

    logger.info('silentRefresh: Attempting token refresh...');
    state.setRefreshing(true);
    state.setRefreshError(null);

    try {
      const newToken = await this.refreshWithRetry();

      if (newToken) {
        logger.info('silentRefresh: Token refreshed successfully');
        state.setLastRefreshAt(Date.now());
        state.setRefreshing(false);
        this.broadcastTokenRefresh();
        return true;
      } else {
        logger.warn('silentRefresh: Refresh returned null');
        state.setRefreshing(false);
        return false;
      }
    } catch (error) {
      logger.error('silentRefresh: Refresh failed', error);
      state.setRefreshError(error instanceof Error ? error.message : 'Unknown error');
      state.setRefreshing(false);
      return false;
    }
  }

  /**
   * Refresh token with exponential backoff retry logic.
   */
  private async refreshWithRetry(): Promise<string | null> {
    this.retryCount = 0;

    while (this.retryCount < TOKEN_MAX_RETRIES) {
      try {
        const result = await refreshAccessToken();
        this.retryCount = 0; // Reset on success
        return result;
      } catch (error) {
        this.retryCount++;

        if (this.retryCount >= TOKEN_MAX_RETRIES) {
          logger.error(`Token refresh failed after ${TOKEN_MAX_RETRIES} retries`);
          // Logout and broadcast to other tabs
          useAuthStore.getState().logout();
          this.broadcastLogout();
          return null;
        }

        const delay = this.calculateBackoff();
        logger.warn(
          `Token refresh failed, retry ${this.retryCount}/${TOKEN_MAX_RETRIES} in ${delay}ms`,
          error
        );

        await new Promise((resolve) => setTimeout(resolve, delay));
      }
    }

    return null;
  }

  /**
   * Calculate exponential backoff delay with jitter.
   * Formula: min(base * 2^retryCount + jitter, max)
   */
  private calculateBackoff(): number {
    const base = TOKEN_RETRY_BASE_MS * Math.pow(2, this.retryCount);
    const jitter = Math.random() * TOKEN_RETRY_BASE_MS;
    return Math.min(base + jitter, TOKEN_RETRY_MAX_MS);
  }

  /**
   * Handle visibility change event (tab becomes visible/hidden).
   * Uses debounce to prevent rapid refresh attempts when switching tabs quickly.
   */
  private handleVisibilityChange(): void {
    // Clear any pending debounce
    if (this.visibilityDebounceTimer) {
      clearTimeout(this.visibilityDebounceTimer);
      this.visibilityDebounceTimer = null;
    }

    // Only act when tab becomes visible
    if (document.visibilityState !== 'visible') {
      return;
    }

    // Debounce to prevent rapid switches triggering multiple refreshes
    this.visibilityDebounceTimer = setTimeout(() => {
      this.visibilityDebounceTimer = null;

      const { isAuthenticated } = useAuthStore.getState();
      if (!isAuthenticated) {
        return;
      }

      logger.debug('Tab became visible, checking token...');
      this.silentRefresh().catch((error) => {
        logger.error('Visibility change refresh failed:', error);
      });
    }, TOKEN_VISIBILITY_DEBOUNCE_MS);
  }

  /**
   * Handle online event - attempt to refresh token when network is restored.
   */
  private handleOnline(): void {
    logger.info('Network online');
    this.isOnline = true;
    useAuthStore.getState().setRefreshError(null);

    // Attempt refresh if authenticated
    const { isAuthenticated } = useAuthStore.getState();
    if (isAuthenticated) {
      this.silentRefresh().catch((error) => {
        logger.error('Online recovery refresh failed:', error);
      });
    }
  }

  /**
   * Handle offline event - stop refresh attempts.
   */
  private handleOffline(): void {
    logger.warn('Network offline');
    this.isOnline = false;
    useAuthStore.getState().setRefreshError('Network offline');
  }

  /**
   * Start background periodic refresh.
   */
  private startBackgroundRefresh(): void {
    if (this.backgroundTimer) {
      return;
    }

    this.backgroundTimer = setInterval(() => {
      const { isAuthenticated } = useAuthStore.getState();
      if (!isAuthenticated) {
        return;
      }

      // Only refresh if online and tab is visible (save resources)
      if (this.isOnline && document.visibilityState === 'visible') {
        logger.debug('Background refresh check...');
        this.silentRefresh().catch((error) => {
          logger.error('Background refresh failed:', error);
        });
      }
    }, TOKEN_BACKGROUND_REFRESH_MS);

    logger.debug(`Background refresh started (interval: ${TOKEN_BACKGROUND_REFRESH_MS}ms)`);
  }

  /**
   * Stop background periodic refresh.
   */
  private stopBackgroundRefresh(): void {
    if (this.backgroundTimer) {
      clearInterval(this.backgroundTimer);
      this.backgroundTimer = null;
      logger.debug('Background refresh stopped');
    }
  }

  /**
   * Initialize BroadcastChannel for cross-tab communication.
   * Falls back to localStorage events for browsers without BroadcastChannel support.
   */
  private initBroadcastChannel(): void {
    // Check for BroadcastChannel support (Safari < 15.4 doesn't support it)
    if (typeof BroadcastChannel !== 'undefined') {
      try {
        this.broadcastChannel = new BroadcastChannel('yoga-platform-auth');
        this.broadcastChannel.onmessage = this.handleBroadcastMessage.bind(this);
        logger.debug('BroadcastChannel initialized');
      } catch (error) {
        logger.warn('BroadcastChannel initialization failed, using localStorage fallback', error);
        this.initStorageFallback();
      }
    } else {
      logger.debug('BroadcastChannel not supported, using localStorage fallback');
      this.initStorageFallback();
    }
  }

  /**
   * Initialize localStorage fallback for cross-tab communication.
   * Used when BroadcastChannel is not available.
   */
  private initStorageFallback(): void {
    if (typeof window !== 'undefined') {
      window.addEventListener('storage', this.boundHandleStorageEvent);
    }
  }

  /**
   * Handle localStorage events for cross-tab sync (fallback for BroadcastChannel).
   */
  private handleStorageEvent(event: StorageEvent): void {
    if (event.key === 'yoga-platform-auth-broadcast' && event.newValue) {
      try {
        const message = JSON.parse(event.newValue) as TokenBroadcastMessage;
        this.handleBroadcastMessage({ data: message } as MessageEvent<TokenBroadcastMessage>);
      } catch (error) {
        logger.error('Failed to parse storage event', error);
      }
    }
  }

  /**
   * Handle incoming broadcast messages from other tabs.
   */
  private handleBroadcastMessage(event: MessageEvent<TokenBroadcastMessage>): void {
    const { type, data } = event.data;

    switch (type) {
      case 'TOKEN_REFRESHED':
        // Another tab refreshed the token - update our store
        if (data?.accessToken) {
          logger.info('Received token refresh from another tab');
          useAuthStore.getState().setTokens(
            data.accessToken,
            undefined,
            data.expiresIn
          );
          useAuthStore.getState().setLastRefreshAt(Date.now());
        }
        break;

      case 'LOGOUT':
        // Another tab logged out - logout this tab too
        logger.info('Received logout from another tab');
        useAuthStore.getState().logout();
        break;

      default:
        logger.warn('Unknown broadcast message type:', type);
    }
  }

  /**
   * Broadcast token refresh to other tabs.
   */
  private broadcastTokenRefresh(): void {
    const { accessToken, tokenExpiresAt } = useAuthStore.getState();
    const expiresIn = tokenExpiresAt
      ? Math.floor((tokenExpiresAt - Date.now()) / 1000)
      : undefined;

    const message: TokenBroadcastMessage = {
      type: 'TOKEN_REFRESHED',
      data: { accessToken: accessToken || undefined, expiresIn },
    };

    this.broadcast(message);
  }

  /**
   * Broadcast logout to other tabs.
   */
  broadcastLogout(): void {
    const message: TokenBroadcastMessage = { type: 'LOGOUT' };
    this.broadcast(message);
  }

  /**
   * Send a broadcast message to other tabs.
   */
  private broadcast(message: TokenBroadcastMessage): void {
    if (this.broadcastChannel) {
      this.broadcastChannel.postMessage(message);
    } else if (typeof localStorage !== 'undefined') {
      // localStorage fallback
      localStorage.setItem('yoga-platform-auth-broadcast', JSON.stringify(message));
      // Remove immediately to allow same message to be sent again
      localStorage.removeItem('yoga-platform-auth-broadcast');
    }
  }
}

// Lazy singleton getter - avoids initialization issues with store
export const getTokenManager = (): TokenManager => TokenManager.getInstance();

// For backwards compatibility - lazy initialization
export const tokenManager = {
  start: () => getTokenManager().start(),
  stop: () => getTokenManager().stop(),
  silentRefresh: () => getTokenManager().silentRefresh(),
  broadcastLogout: () => getTokenManager().broadcastLogout(),
};

// Also export class for testing
export { TokenManager };

/**
 * Get CSRF token from cookie for state-changing requests.
 */
const getCsrfToken = (): string | null => {
  const match = document.cookie.match(/(?:^|; )csrf_token=([^;]*)/);
  return match ? decodeURIComponent(match[1]) : null;
};

// Add auth token, CSRF token, and Accept-Language header to all requests
api.interceptors.request.use(
  async (config: InternalAxiosRequestConfig) => {
    // Add Accept-Language header for localized error messages from backend
    const locale = getCurrentLocale();
    config.headers['Accept-Language'] = locale;

    // Add CSRF token for state-changing requests
    const method = config.method?.toUpperCase();
    if (method && ['POST', 'PUT', 'PATCH', 'DELETE'].includes(method)) {
      const csrfToken = getCsrfToken();
      if (csrfToken) {
        config.headers['X-CSRF-Token'] = csrfToken;
      } else {
        // CSRF token may not be present on initial load before first server response
        // This is expected behavior - the server will set the cookie on first response
        logger.debug('CSRF token not found in cookies - may be first request');
      }
    }

    // Check if token needs refresh before making request
    // Use Promise queuing to prevent race conditions
    if (shouldRefreshTokenWithJitter()) {
      const newToken = await refreshAccessToken();
      if (newToken) {
        config.headers.Authorization = `Bearer ${newToken}`;
        return config;
      }
      // Refresh failed (rate limited, network error, or auth error)
      // If we still have a token, try using it - the 401 response interceptor
      // will handle the retry if needed
      const existingToken = getAuthToken();
      if (existingToken) {
        logger.debug('Refresh failed, using existing token');
        config.headers.Authorization = `Bearer ${existingToken}`;
        return config;
      }
      // No token at all - throw error
      throw new Error('Authentication failed - please log in again');
    }

    // Use existing token
    const token = getAuthToken();
    if (token) {
      config.headers.Authorization = `Bearer ${token}`;
    }

    return config;
  },
  (error) => Promise.reject(error)
);

// Handle 401 errors, token refresh, and rate limiting
api.interceptors.response.use(
  (response) => response,
  async (error: AxiosError) => {
    const originalRequest = error.config as InternalAxiosRequestConfig & { _retry?: boolean };

    // Handle rate limiting (429)
    if (error.response?.status === 429) {
      const rateLimitData = error.response.data as RateLimitError;
      const retryAfter = rateLimitData?.retry_after || 60;

      // Create a more user-friendly error
      const rateLimitError = new Error(
        `Too many requests. Please wait ${retryAfter} seconds before trying again.`
      );
      (rateLimitError as Error & { retryAfter: number }).retryAfter = retryAfter;
      (rateLimitError as Error & { isRateLimited: boolean }).isRateLimited = true;

      return Promise.reject(rateLimitError);
    }

    // Handle 401 - attempt token refresh
    // SECURITY: Use Promise queuing to prevent multiple simultaneous refresh attempts
    if (error.response?.status === 401 && !originalRequest._retry) {
      originalRequest._retry = true;

      try {
        // This will queue behind any existing refresh or start a new one
        const newToken = await refreshAccessToken();

        if (newToken) {
          originalRequest.headers.Authorization = `Bearer ${newToken}`;
          return api(originalRequest);
        } else {
          // Refresh failed - logout already happened in refreshAccessToken
          return Promise.reject(error);
        }
      } catch (refreshError) {
        return Promise.reject(refreshError);
      }
    }

    // Handle 403 - DO NOT force logout
    // 403 Forbidden means the user is authenticated but not authorized for this action.
    // This is different from 401 Unauthorized which means invalid/expired authentication.
    // Examples of 403: CSRF failure, resource access denied, insufficient permissions.
    // The user should NOT be logged out for permission errors.
    if (error.response?.status === 403) {
      // Log the reason for debugging but don't logout
      logger.warn('403 Forbidden - Permission denied:', error.response?.data);
    }

    return Promise.reject(error);
  }
);

export const isAbortRequestError = (error: unknown): boolean => {
  if (axios.isCancel(error)) {
    return true;
  }

  if (axios.isAxiosError(error)) {
    // Axios v1 cancellation consistently uses ERR_CANCELED.
    if (error.code === 'ERR_CANCELED') {
      return true;
    }
  }

  if (error instanceof Error) {
    const loweredMessage = error.message.toLowerCase();
    if (
      error.name === 'AbortError' ||
      loweredMessage.includes('request aborted') ||
      loweredMessage === 'canceled' ||
      loweredMessage === 'cancelled'
    ) {
      return true;
    }
  }

  return false;
};

const createAbortError = (): Error => {
  const abortError = new Error('Request aborted');
  abortError.name = 'AbortError';
  return abortError;
};

const inFlightRequests = new Map<string, Promise<unknown>>();

const coalesceInFlight = <T>(
  key: string,
  factory: () => Promise<T>,
): Promise<T> => {
  const existing = inFlightRequests.get(key);
  if (existing) {
    return existing as Promise<T>;
  }

  const requestPromise = factory().finally(() => {
    if (inFlightRequests.get(key) === requestPromise) {
      inFlightRequests.delete(key);
    }
  });

  inFlightRequests.set(key, requestPromise as Promise<unknown>);
  return requestPromise;
};

const waitForPromiseWithAbort = <T>(
  promise: Promise<T>,
  signal?: AbortSignal,
): Promise<T> => {
  if (!signal) {
    return promise;
  }

  if (signal.aborted) {
    return Promise.reject(createAbortError());
  }

  return new Promise<T>((resolve, reject) => {
    const onAbort = () => {
      signal.removeEventListener('abort', onAbort);
      reject(createAbortError());
    };

    signal.addEventListener('abort', onAbort, { once: true });

    promise.then(
      (value) => {
        signal.removeEventListener('abort', onAbort);
        resolve(value);
      },
      (error) => {
        signal.removeEventListener('abort', onAbort);
        reject(error);
      },
    );
  });
};

// Error handling helper
const handleError = (error: AxiosError<ApiError>): never => {
  if (isAbortRequestError(error)) {
    throw createAbortError();
  }

  // Check if it's a rate limit error
  if ((error as Error & { isRateLimited?: boolean }).isRateLimited) {
    throw error;
  }

  const detail = error.response?.data?.detail;
  let message: string;

  if (Array.isArray(detail)) {
    // FastAPI validation errors come as array
    message = detail.map(err => {
      if (typeof err === 'string') return err;
      // Pydantic v2 uses 'msg', older versions might use 'message'
      return err.msg || err.message || JSON.stringify(err);
    }).join(', ');
  } else if (typeof detail === 'object' && detail !== null) {
    message = JSON.stringify(detail);
  } else if (typeof detail === 'string') {
    message = detail;
  } else {
    message = error.message || 'Unknown error';
  }

  const err = new Error(message) as Error & { status?: number };
  if (typeof error.response?.status === 'number') {
    err.status = error.response.status;
  }
  throw err;
};

/**
 * Error handling helper for blob responses (e.g., file exports).
 * When responseType is 'blob', error responses are also blobs that need special parsing.
 */
const handleBlobError = async (error: AxiosError): Promise<never> => {
  // Check if it's a rate limit error
  if ((error as Error & { isRateLimited?: boolean }).isRateLimited) {
    throw error;
  }

  // If the response data is a Blob, try to parse it as JSON to get the error message
  // Only attempt JSON parsing if content-type indicates JSON
  if (error.response?.data instanceof Blob) {
    const contentType = error.response.headers?.['content-type'] || '';
    const isJsonResponse = contentType.includes('application/json');

    if (!isJsonResponse) {
      // Non-JSON blob error, fall through to default handling
      throw handleError(error as AxiosError<ApiError>);
    }

    try {
      const text = await error.response.data.text();
      const json = JSON.parse(text) as ApiError;
      const detail = json.detail;

      let message: string;
      if (Array.isArray(detail)) {
        message = detail.map(err => {
          if (typeof err === 'string') return err;
          return err.msg || err.message || JSON.stringify(err);
        }).join(', ');
      } else if (typeof detail === 'object' && detail !== null) {
        message = JSON.stringify(detail);
      } else if (typeof detail === 'string') {
        message = detail;
      } else {
        message = 'Export failed';
      }
      throw new Error(message);
    } catch (parseError) {
      // If parsing fails, it might already be the error we want to throw
      if (parseError instanceof Error && parseError.message !== 'Export failed') {
        throw parseError;
      }
      // Fall through to default error handling
    }
  }

  // Fall back to standard error handling
  throw handleError(error as AxiosError<ApiError>);
};

// === Categories API ===

export const categoriesApi = {
  getAll: async (signal?: AbortSignal): Promise<Category[]> => {
    try {
      const requestPromise = coalesceInFlight<Category[]>(
        "categories:getAll",
        async () => {
          const response = await api.get<Category[]>(`${API_V1_PREFIX}/categories`, {
            signal: undefined,
          });
          return response.data;
        },
      );
      return await waitForPromiseWithAbort(requestPromise, signal);
    } catch (error) {
      if (isAbortRequestError(error)) {
        throw createAbortError();
      }
      throw handleError(error as AxiosError<ApiError>);
    }
  },

  getById: async (id: number): Promise<Category> => {
    try {
      const response = await api.get<Category>(`${API_V1_PREFIX}/categories/${id}`);
      return response.data;
    } catch (error) {
      throw handleError(error as AxiosError<ApiError>);
    }
  },

  create: async (data: CategoryCreate): Promise<Category> => {
    try {
      const response = await api.post<Category>(`${API_V1_PREFIX}/categories`, data);
      return response.data;
    } catch (error) {
      throw handleError(error as AxiosError<ApiError>);
    }
  },

  update: async (id: number, data: Partial<CategoryCreate>): Promise<Category> => {
    try {
      const response = await api.put<Category>(`${API_V1_PREFIX}/categories/${id}`, data);
      return response.data;
    } catch (error) {
      throw handleError(error as AxiosError<ApiError>);
    }
  },

  delete: async (id: number): Promise<void> => {
    try {
      await api.delete(`${API_V1_PREFIX}/categories/${id}`);
    } catch (error) {
      throw handleError(error as AxiosError<ApiError>);
    }
  },
};

// === Muscles API ===

export const musclesApi = {
  getAll: async (bodyPart?: string): Promise<Muscle[]> => {
    try {
      const params = bodyPart ? { body_part: bodyPart } : {};
      const response = await api.get<Muscle[]>(`${API_V1_PREFIX}/muscles`, { params });
      return response.data;
    } catch (error) {
      throw handleError(error as AxiosError<ApiError>);
    }
  },

  getById: async (id: number): Promise<Muscle> => {
    try {
      const response = await api.get<Muscle>(`${API_V1_PREFIX}/muscles/${id}`);
      return response.data;
    } catch (error) {
      throw handleError(error as AxiosError<ApiError>);
    }
  },

  seed: async (): Promise<Muscle[]> => {
    try {
      const response = await api.post<Muscle[]>(`${API_V1_PREFIX}/muscles/seed`);
      return response.data;
    } catch (error) {
      throw handleError(error as AxiosError<ApiError>);
    }
  },
};

// === Poses API ===

// Paginated response type from backend
interface PaginatedResponse<T> {
  items: T[];
  total: number;
  skip: number;
  limit: number;
}

export const posesApi = {
  getAll: async (categoryId?: number, skip = 0, limit = 100, signal?: AbortSignal): Promise<PoseListItem[]> => {
    try {
      const params: Record<string, number | undefined> = { skip, limit };
      if (categoryId) params.category_id = categoryId;
      const response = await api.get<PaginatedResponse<PoseListItem>>(`${API_V1_PREFIX}/poses`, { params, signal });
      // Backend returns paginated response { items, total, skip, limit }
      return response.data.items;
    } catch (error) {
      throw handleError(error as AxiosError<ApiError>);
    }
  },

  search: async (query: string): Promise<PoseListItem[]> => {
    try {
      const response = await api.get<PoseListItem[]>(`${API_V1_PREFIX}/poses/search`, {
        params: { q: query },
      });
      return response.data;
    } catch (error) {
      throw handleError(error as AxiosError<ApiError>);
    }
  },

  getByCategory: async (categoryId: number): Promise<PoseListItem[]> => {
    try {
      const response = await api.get<PoseListItem[]>(`${API_V1_PREFIX}/poses/category/${categoryId}`);
      return response.data;
    } catch (error) {
      throw handleError(error as AxiosError<ApiError>);
    }
  },

  getById: async (id: number, signal?: AbortSignal): Promise<Pose> => {
    try {
      const requestPromise = coalesceInFlight<Pose>(
        `poses:getById:${id}`,
        async () => {
          const response = await api.get<Pose>(`${API_V1_PREFIX}/poses/${id}`);
          return response.data;
        },
      );
      return await waitForPromiseWithAbort(requestPromise, signal);
    } catch (error) {
      if (isAbortRequestError(error)) {
        throw createAbortError();
      }
      throw handleError(error as AxiosError<ApiError>);
    }
  },

  getByCode: async (code: string): Promise<Pose> => {
    try {
      const response = await api.get<Pose>(`${API_V1_PREFIX}/poses/code/${code}`);
      return response.data;
    } catch (error) {
      throw handleError(error as AxiosError<ApiError>);
    }
  },

  create: async (data: PoseCreate): Promise<Pose> => {
    try {
      const response = await api.post<Pose>(`${API_V1_PREFIX}/poses`, data);
      return response.data;
    } catch (error) {
      throw handleError(error as AxiosError<ApiError>);
    }
  },

  update: async (id: number, data: PoseUpdate): Promise<Pose> => {
    try {
      const response = await api.put<Pose>(`${API_V1_PREFIX}/poses/${id}`, data);
      return response.data;
    } catch (error) {
      throw handleError(error as AxiosError<ApiError>);
    }
  },

  delete: async (id: number): Promise<void> => {
    try {
      await api.delete(`${API_V1_PREFIX}/poses/${id}`);
    } catch (error) {
      throw handleError(error as AxiosError<ApiError>);
    }
  },

  uploadSchema: async (id: number, file: File): Promise<Pose> => {
    try {
      const formData = new FormData();
      formData.append('file', file);
      // Don't set Content-Type manually - axios will set it with correct boundary for FormData
      const response = await api.post<Pose>(`${API_V1_PREFIX}/poses/${id}/schema`, formData);
      return response.data;
    } catch (error) {
      throw handleError(error as AxiosError<ApiError>);
    }
  },

  reanalyzeMuscles: async (id: number): Promise<Pose> => {
    try {
      // AI muscle analysis can take longer, use extended timeout (2 minutes)
      const response = await api.post<Pose>(
        `${API_V1_PREFIX}/poses/${id}/reanalyze-muscles`,
        null,
        { timeout: 120_000 }
      );
      return response.data;
    } catch (error) {
      throw handleError(error as AxiosError<ApiError>);
    }
  },

  /**
   * Застосувати результати генерації до існуючої пози
   * Оновлює фото, шар м'язів та асоціації з м'язами
   */
  applyGeneration: async (poseId: number, taskId: string): Promise<Pose> => {
    try {
      const response = await api.post<Pose>(
        `${API_V1_PREFIX}/poses/${poseId}/apply-generation/${taskId}`
      );
      return response.data;
    } catch (error) {
      throw handleError(error as AxiosError<ApiError>);
    }
  },
};

// === Generate API ===

export const generateApi = {
  /**
   * Генерація зображень з схеми пози
   * Пайплайн: Схема → Фото → М'язи
   */
  generate: async (
    file: File,
    additionalNotes?: string,
    generateMuscles: boolean = true
  ): Promise<GenerateResponse> => {
    try {
      const formData = new FormData();
      formData.append('schema_file', file);
      formData.append('generate_muscles', String(Boolean(generateMuscles)));
      if (additionalNotes?.trim()) {
        formData.append('additional_notes', additionalNotes);
      }

      const response = await withTransientRetry(() =>
        api.post<GenerateResponse>(`${API_V1_PREFIX}/generate`, formData)
      );
      return response.data;
    } catch (error) {
      throw handleError(error as AxiosError<ApiError>);
    }
  },

  /**
   * Перегенерація зображень з можливістю передачі схеми та референсного фото
   * Використовується для регенерації існуючих зображень з фідбеком
   */
  regenerate: async (options: {
    schemaFile?: File;
    referencePhoto: File;
    additionalNotes?: string;
    generateMuscles?: boolean;
  }): Promise<GenerateResponse> => {
    try {
      const formData = new FormData();

      // Primary source - use schema if available, otherwise reference photo.
      // NOTE: Backend currently accepts only `schema_file` (+ optional `additional_notes`).
      // We intentionally do NOT upload `reference_photo` to avoid unnecessary payload
      // (and potential 413 / proxy body-size limits) until the backend supports it.
      formData.append('schema_file', options.schemaFile ?? options.referencePhoto);
      formData.append(
        'generate_muscles',
        String(options.generateMuscles !== false)
      );
      if (options.additionalNotes?.trim()) {
        formData.append('additional_notes', options.additionalNotes);
      }

      const response = await withTransientRetry(() =>
        api.post<GenerateResponse>(`${API_V1_PREFIX}/generate`, formData)
      );
      return response.data;
    } catch (error) {
      throw handleError(error as AxiosError<ApiError>);
    }
  },

  /**
   * Генерація зображень з існуючої схеми пози (server-side fetch)
   * Обходить CORS проблеми - сервер сам завантажує схему
   */
  generateFromPose: async (
    poseId: number,
    additionalNotes?: string,
    generateMuscles: boolean = true
  ): Promise<GenerateResponse> => {
    try {
      // Always send an object body (even empty) to ensure Content-Type: application/json is set
      const body: { additional_notes?: string; generate_muscles: boolean } = {
        generate_muscles: generateMuscles,
      };
      if (additionalNotes?.trim()) {
        body.additional_notes = additionalNotes;
      }
      const response = await withTransientRetry(() =>
        api.post<GenerateResponse>(`${API_V1_PREFIX}/generate/from-pose/${poseId}`, body)
      );
      return response.data;
    } catch (error) {
      throw handleError(error as AxiosError<ApiError>);
    }
  },

  /**
   * Генерація зображень з текстового опису пози
   * Не потребує завантаження зображення - AI генерує з опису
   */
  generateFromText: async (
    description: string,
    additionalNotes?: string,
    generateMuscles: boolean = true
  ): Promise<GenerateResponse> => {
    try {
      const body: {
        description: string;
        additional_notes?: string;
        generate_muscles: boolean;
      } = { description, generate_muscles: generateMuscles };
      if (additionalNotes?.trim()) {
        body.additional_notes = additionalNotes;
      }
      const response = await withTransientRetry(() =>
        api.post<GenerateResponse>(`${API_V1_PREFIX}/generate/from-text`, body)
      );
      return response.data;
    } catch (error) {
      throw handleError(error as AxiosError<ApiError>);
    }
  },

  getStatus: async (taskId: string): Promise<GenerateResponse> => {
    try {
      const response = await api.get<GenerateResponse>(`${API_V1_PREFIX}/generate/status/${taskId}`);
      return response.data;
    } catch (error) {
      throw handleError(error as AxiosError<ApiError>);
    }
  },

  /**
   * Get WebSocket URL for real-time generation status updates.
   *
   * WebSocket replaces polling for better performance:
   * - No rate limit issues (single persistent connection)
   * - Real-time updates (no polling interval delay)
   * - Lower bandwidth and server load
   *
   * @param taskId - The generation task ID
   * @returns WebSocket URL (token passed via Sec-WebSocket-Protocol; not in URL)
   */
  getWebSocketUrl: (taskId: string): string => {
    // Convert http(s) to ws(s)
    const wsBase = API_BASE_URL.replace(/^http/, 'ws');
    return `${wsBase}${API_V1_PREFIX}/ws/generate/${taskId}`;
  },

  /**
   * Save generation result to gallery as a new pose.
   * Creates a Pose record with photo, muscle layer, and analyzed muscles.
   */
  saveToGallery: async (data: {
    task_id: string;
    name: string;
    code: string;
    name_en?: string;
    category_id?: number;
    description?: string;
  }): Promise<{ pose_id: number; message: string }> => {
    try {
      const response = await api.post<{ pose_id: number; message: string }>(
        `${API_V1_PREFIX}/generate/save-to-gallery`,
        data
      );
      return response.data;
    } catch (error) {
      throw handleError(error as AxiosError<ApiError>);
    }
  },
};

// === Auth API ===

export const authApi = {
  login: async (data: LoginRequest): Promise<TokenPairResponse> => {
    try {
      const response = await api.post<TokenPairResponse>(`${API_V1_PREFIX}/auth/login`, data);
      return response.data;
    } catch (error) {
      throw handleError(error as AxiosError<ApiError>);
    }
  },

  refresh: async (refreshToken?: string): Promise<TokenPairResponse> => {
    try {
      const body = refreshToken ? { refresh_token: refreshToken } : undefined;
      const response = await api.post<TokenPairResponse>(`${API_V1_PREFIX}/auth/refresh`, body);
      return response.data;
    } catch (error) {
      throw handleError(error as AxiosError<ApiError>);
    }
  },

  logout: async (refreshToken?: string): Promise<void> => {
    try {
      const body = refreshToken ? { refresh_token: refreshToken } : undefined;
      await api.post(`${API_V1_PREFIX}/auth/logout`, body);
    } catch {
      // Ignore logout errors - we're logging out anyway
    } finally {
      // Ensure other tabs are informed even if the API call fails
      tokenManager.broadcastLogout();
    }
  },

  logoutAll: async (): Promise<void> => {
    try {
      await api.post(`${API_V1_PREFIX}/auth/logout-all`);
      tokenManager.broadcastLogout();
    } catch (error) {
      throw handleError(error as AxiosError<ApiError>);
    }
  },

  getMe: async (): Promise<User> => {
    try {
      return await coalesceInFlight<User>("auth:getMe", async () => {
        const response = await api.get<User>(`${API_V1_PREFIX}/auth/me`);
        return response.data;
      });
    } catch (error) {
      throw handleError(error as AxiosError<ApiError>);
    }
  },

  updateMe: async (data: UserUpdate): Promise<User> => {
    try {
      const response = await api.put<User>(`${API_V1_PREFIX}/auth/me`, data);
      return response.data;
    } catch (error) {
      throw handleError(error as AxiosError<ApiError>);
    }
  },

};

// === Compare API ===

export const compareApi = {
  /**
   * Compare multiple poses (2-4 poses)
   * Returns detailed comparison including muscle analysis
   * @param ids - Array of pose IDs to compare
   * @param signal - Optional AbortSignal for request cancellation
   */
  poses: async (ids: number[], signal?: AbortSignal): Promise<ComparisonResult> => {
    try {
      const response = await api.get<ComparisonResult>(`${API_V1_PREFIX}/compare/poses`, {
        params: { ids: ids.join(',') },
        signal,
      });
      return response.data;
    } catch (error) {
      throw handleError(error as AxiosError<ApiError>);
    }
  },

  /**
   * Compare muscles between poses (lighter endpoint)
   */
  muscles: async (ids: number[]): Promise<MuscleComparison[]> => {
    try {
      const response = await api.get<MuscleComparison[]>(`${API_V1_PREFIX}/compare/muscles`, {
        params: { pose_ids: ids.join(',') },
      });
      return response.data;
    } catch (error) {
      throw handleError(error as AxiosError<ApiError>);
    }
  },
};

// === Analytics API ===

export const analyticsApi = {
  /**
   * Get overview statistics (total poses, categories, completion rate)
   */
  getOverview: async (): Promise<OverviewStats> => {
    try {
      const response = await api.get<OverviewStats>(`${API_V1_PREFIX}/analytics/overview`);
      return response.data;
    } catch (error) {
      throw handleError(error as AxiosError<ApiError>);
    }
  },

  /**
   * Get muscle statistics (activations, average levels)
   */
  getMuscles: async (): Promise<MuscleStats[]> => {
    try {
      const response = await api.get<MuscleStats[]>(`${API_V1_PREFIX}/analytics/muscles`);
      return response.data;
    } catch (error) {
      throw handleError(error as AxiosError<ApiError>);
    }
  },

  /**
   * Get data for muscle heatmap visualization
   */
  getMuscleHeatmap: async (): Promise<MuscleHeatmapData> => {
    try {
      const response = await api.get<MuscleHeatmapData>(`${API_V1_PREFIX}/analytics/muscle-heatmap`);
      return response.data;
    } catch (error) {
      throw handleError(error as AxiosError<ApiError>);
    }
  },

  /**
   * Get category statistics
   */
  getCategories: async (): Promise<CategoryStats[]> => {
    try {
      const response = await api.get<CategoryStats[]>(`${API_V1_PREFIX}/analytics/categories`);
      return response.data;
    } catch (error) {
      throw handleError(error as AxiosError<ApiError>);
    }
  },

  /**
   * Get recent activity feed
   */
  getRecentActivity: async (limit = 10): Promise<RecentActivity[]> => {
    try {
      const response = await api.get<RecentActivity[]>(`${API_V1_PREFIX}/analytics/recent-activity`, {
        params: { limit },
      });
      return response.data;
    } catch (error) {
      throw handleError(error as AxiosError<ApiError>);
    }
  },

  /**
   * Get body part balance statistics
   */
  getBodyPartBalance: async (): Promise<BodyPartBalance[]> => {
    try {
      const response = await api.get<BodyPartBalance[]>(`${API_V1_PREFIX}/analytics/body-part-balance`);
      return response.data;
    } catch (error) {
      throw handleError(error as AxiosError<ApiError>);
    }
  },

  /**
   * Get complete analytics summary (all data in one request)
   * @param signal - Optional AbortSignal for request cancellation
   */
  getSummary: async (signal?: AbortSignal): Promise<AnalyticsSummary> => {
    try {
      const response = await api.get<AnalyticsSummary>(`${API_V1_PREFIX}/analytics/summary`, { signal });
      return response.data;
    } catch (error) {
      throw handleError(error as AxiosError<ApiError>);
    }
  },
};

// === Sequences API ===

export const sequencesApi = {
  /**
   * Get paginated list of sequences
   */
  getAll: async (skip = 0, limit = 20): Promise<PaginatedSequenceResponse> => {
    try {
      const response = await api.get<PaginatedSequenceResponse>(`${API_V1_PREFIX}/sequences`, {
        params: { skip, limit },
      });
      return response.data;
    } catch (error) {
      throw handleError(error as AxiosError<ApiError>);
    }
  },

  /**
   * Get a single sequence by ID with all poses
   */
  getById: async (id: number): Promise<Sequence> => {
    try {
      const response = await api.get<Sequence>(`${API_V1_PREFIX}/sequences/${id}`);
      return response.data;
    } catch (error) {
      throw handleError(error as AxiosError<ApiError>);
    }
  },

  /**
   * Create a new sequence
   */
  create: async (data: SequenceCreate): Promise<Sequence> => {
    try {
      const response = await api.post<Sequence>(`${API_V1_PREFIX}/sequences`, data);
      return response.data;
    } catch (error) {
      throw handleError(error as AxiosError<ApiError>);
    }
  },

  /**
   * Update a sequence's metadata
   */
  update: async (id: number, data: SequenceUpdate): Promise<Sequence> => {
    try {
      const response = await api.put<Sequence>(`${API_V1_PREFIX}/sequences/${id}`, data);
      return response.data;
    } catch (error) {
      throw handleError(error as AxiosError<ApiError>);
    }
  },

  /**
   * Delete a sequence
   */
  delete: async (id: number): Promise<void> => {
    try {
      await api.delete(`${API_V1_PREFIX}/sequences/${id}`);
    } catch (error) {
      throw handleError(error as AxiosError<ApiError>);
    }
  },

  /**
   * Add a pose to a sequence
   */
  addPose: async (sequenceId: number, poseData: SequencePoseCreate): Promise<Sequence> => {
    try {
      const response = await api.post<Sequence>(`${API_V1_PREFIX}/sequences/${sequenceId}/poses`, poseData);
      return response.data;
    } catch (error) {
      throw handleError(error as AxiosError<ApiError>);
    }
  },

  /**
   * Update a pose in a sequence (duration, transition note)
   */
  updatePose: async (sequenceId: number, sequencePoseId: number, poseData: SequencePoseUpdate): Promise<Sequence> => {
    try {
      const response = await api.put<Sequence>(`${API_V1_PREFIX}/sequences/${sequenceId}/poses/${sequencePoseId}`, poseData);
      return response.data;
    } catch (error) {
      throw handleError(error as AxiosError<ApiError>);
    }
  },

  /**
   * Remove a pose from a sequence
   */
  removePose: async (sequenceId: number, sequencePoseId: number): Promise<Sequence> => {
    try {
      const response = await api.delete<Sequence>(`${API_V1_PREFIX}/sequences/${sequenceId}/poses/${sequencePoseId}`);
      return response.data;
    } catch (error) {
      throw handleError(error as AxiosError<ApiError>);
    }
  },

  /**
   * Reorder poses in a sequence
   */
  reorderPoses: async (sequenceId: number, data: ReorderPosesRequest): Promise<Sequence> => {
    try {
      const response = await api.put<Sequence>(`${API_V1_PREFIX}/sequences/${sequenceId}/poses/reorder`, data);
      return response.data;
    } catch (error) {
      throw handleError(error as AxiosError<ApiError>);
    }
  },

  /**
   * Export all poses from a sequence as a single PDF (keeps sequence order)
   */
  exportPdf: async (
    sequenceId: number,
    pageSize: 'A4' | 'Letter' = 'A4',
  ): Promise<Blob> => {
    try {
      const response = await api.get(`${API_V1_PREFIX}/sequences/${sequenceId}/pdf`, {
        params: { page_size: pageSize },
        responseType: 'blob',
      });
      return response.data;
    } catch (error) {
      return handleBlobError(error as AxiosError);
    }
  },
};

// === Versions API ===

export const versionsApi = {
  /**
   * Get version history for a pose
   */
  list: async (poseId: number, skip = 0, limit = 50, signal?: AbortSignal): Promise<PoseVersionListItem[]> => {
    const maxAttempts = 6;
    for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
      try {
        const response = await api.get<PoseVersionListItem[] | { items: PoseVersionListItem[] }>(`${API_V1_PREFIX}/poses/${poseId}/versions`, {
          params: { skip, limit },
          signal,
        });
        // Handle both array response and paginated response { items: [] }
        const data = response.data;
        if (Array.isArray(data)) {
          return data;
        }
        // Paginated response format
        if (data && typeof data === 'object' && 'items' in data && Array.isArray(data.items)) {
          return data.items;
        }
        // Fallback to empty array if response is unexpected
        console.warn('Unexpected versions response format:', data);
        return [];
      } catch (error) {
        // Re-throw abort errors without transformation
        if (axios.isCancel(error) || (error instanceof Error && error.name === 'AbortError')) {
          const abortError = new Error('Request aborted');
          abortError.name = 'AbortError';
          throw abortError;
        }

        const anyErr = error as unknown as Error & { isRateLimited?: boolean; retryAfter?: number };
        const statusCode = axios.isAxiosError(error)
          ? error.response?.status
          : (anyErr as unknown as { status?: number })?.status ??
            (anyErr?.isRateLimited ? 429 : undefined);
        const isTransient = statusCode === 409 || statusCode === 429 || statusCode === 503;
        if (isTransient && attempt < maxAttempts - 1 && !signal?.aborted) {
          const retryAfterMs =
            statusCode === 429 && anyErr?.isRateLimited && typeof anyErr.retryAfter === 'number'
              ? Math.max(100, Math.floor(anyErr.retryAfter * 1000))
              : null;
          const backoffMs = Math.min(50 * (2 ** attempt), 800) + Math.floor(Math.random() * 50);
          const delayMs = Math.min(retryAfterMs ?? backoffMs, 5_000);
          // eslint-disable-next-line no-await-in-loop
          await new Promise((r) => setTimeout(r, delayMs));
          continue;
        }

        throw handleError(error as AxiosError<ApiError>);
      }
    }
    // Unreachable, but TS wants a return.
    return [];
  },

  /**
   * Get version count for a pose
   */
  count: async (poseId: number): Promise<VersionCountResponse> => {
    try {
      const response = await api.get<VersionCountResponse>(`${API_V1_PREFIX}/poses/${poseId}/versions/count`);
      return response.data;
    } catch (error) {
      throw handleError(error as AxiosError<ApiError>);
    }
  },

  /**
   * Get detailed version info
   */
  get: async (poseId: number, versionId: number): Promise<PoseVersionDetail> => {
    const maxAttempts = 6;
    for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
      try {
        const response = await api.get<PoseVersionDetail>(`${API_V1_PREFIX}/poses/${poseId}/versions/${versionId}`);
        return response.data;
      } catch (error) {
        const anyErr = error as unknown as Error & { isRateLimited?: boolean; retryAfter?: number; status?: number };
        const statusCode = axios.isAxiosError(error)
          ? error.response?.status
          : anyErr?.status ?? (anyErr?.isRateLimited ? 429 : undefined);
        const isTransient = statusCode === 409 || statusCode === 429 || statusCode === 503;
        if (isTransient && attempt < maxAttempts - 1) {
          const retryAfterMs =
            statusCode === 429 && anyErr?.isRateLimited && typeof anyErr.retryAfter === "number"
              ? Math.max(250, Math.floor(anyErr.retryAfter * 1000))
              : null;
          const backoffMs = Math.min(100 * (2 ** attempt), 1500) + Math.floor(Math.random() * 100);
          const delayMs = Math.min(retryAfterMs ?? backoffMs, 10_000);
          // eslint-disable-next-line no-await-in-loop
          await new Promise((r) => setTimeout(r, delayMs));
          continue;
        }
        throw handleError(error as AxiosError<ApiError>);
      }
    }
    // Unreachable, but TS wants a return.
    throw new Error("Failed to load version");
  },

  /**
   * Restore pose to a specific version
   */
  restore: async (poseId: number, versionId: number, data?: RestoreVersionRequest): Promise<{ success: boolean; message: string; pose_id: number }> => {
    const maxAttempts = 6;
    for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
      try {
        const response = await api.post<{ success: boolean; message: string; pose_id: number }>(
          `${API_V1_PREFIX}/poses/${poseId}/versions/${versionId}/restore`,
          data || {}
        );
        return response.data;
      } catch (error) {
        const anyErr = error as unknown as Error & { isRateLimited?: boolean; retryAfter?: number; status?: number };
        const statusCode = axios.isAxiosError(error)
          ? error.response?.status
          : anyErr?.status ?? (anyErr?.isRateLimited ? 429 : undefined);
        const isTransient = statusCode === 409 || statusCode === 429 || statusCode === 503;
        if (isTransient && attempt < maxAttempts - 1) {
          const retryAfterMs =
            statusCode === 429 && anyErr?.isRateLimited && typeof anyErr.retryAfter === "number"
              ? Math.max(250, Math.floor(anyErr.retryAfter * 1000))
              : null;
          const backoffMs = Math.min(100 * (2 ** attempt), 1500) + Math.floor(Math.random() * 100);
          const delayMs = Math.min(retryAfterMs ?? backoffMs, 10_000);
          // eslint-disable-next-line no-await-in-loop
          await new Promise((r) => setTimeout(r, delayMs));
          continue;
        }
        throw handleError(error as AxiosError<ApiError>);
      }
    }
    // Unreachable, but TS wants a return.
    throw new Error("Failed to restore version");
  },

  /**
   * Compare two versions
   */
  diff: async (poseId: number, v1: number, v2: number): Promise<VersionComparisonResult> => {
    const maxAttempts = 6;
    for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
      try {
        const response = await api.get<VersionComparisonResult>(`${API_V1_PREFIX}/poses/${poseId}/versions/${v1}/diff/${v2}`);
        return response.data;
      } catch (error) {
        const anyErr = error as unknown as Error & { isRateLimited?: boolean; retryAfter?: number; status?: number };
        const statusCode = axios.isAxiosError(error)
          ? error.response?.status
          : anyErr?.status ?? (anyErr?.isRateLimited ? 429 : undefined);
        const isTransient = statusCode === 409 || statusCode === 429 || statusCode === 503;
        if (isTransient && attempt < maxAttempts - 1) {
          const retryAfterMs =
            statusCode === 429 && anyErr?.isRateLimited && typeof anyErr.retryAfter === "number"
              ? Math.max(250, Math.floor(anyErr.retryAfter * 1000))
              : null;
          const backoffMs = Math.min(100 * (2 ** attempt), 1500) + Math.floor(Math.random() * 100);
          const delayMs = Math.min(retryAfterMs ?? backoffMs, 10_000);
          // eslint-disable-next-line no-await-in-loop
          await new Promise((r) => setTimeout(r, delayMs));
          continue;
        }
        throw handleError(error as AxiosError<ApiError>);
      }
    }
    // Unreachable, but TS wants a return.
    throw new Error("Failed to compare versions");
  },
};

// === Export API ===

/**
 * Helper function to download a blob as a file
 */
export const downloadBlob = (blob: Blob, filename: string): void => {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
};

export const exportApi = {
  /**
   * Export all poses as JSON
   */
  posesJson: async (categoryId?: number): Promise<Blob> => {
    try {
      const params = categoryId ? { category_id: categoryId } : {};
      const response = await api.get(`${API_V1_PREFIX}/export/poses/json`, {
        params,
        responseType: 'blob',
      });
      return response.data;
    } catch (error) {
      return handleBlobError(error as AxiosError);
    }
  },

  /**
   * Export all poses as CSV
   */
  posesCsv: async (categoryId?: number): Promise<Blob> => {
    try {
      const params = categoryId ? { category_id: categoryId } : {};
      const response = await api.get(`${API_V1_PREFIX}/export/poses/csv`, {
        params,
        responseType: 'blob',
      });
      return response.data;
    } catch (error) {
      return handleBlobError(error as AxiosError);
    }
  },

  /**
   * Export a single pose as PDF
   */
  posePdf: async (
    poseId: number,
    options?: Partial<PDFExportOptions>,
    handlers?: {
      onProgress?: (percent: number) => void;
    },
  ): Promise<Blob> => {
    try {
      const params: Record<string, boolean | string> = {};
      if (options?.include_photo !== undefined) params.include_photo = options.include_photo;
      if (options?.include_schema !== undefined) params.include_schema = options.include_schema;
      if (options?.include_muscle_layer !== undefined) params.include_muscle_layer = options.include_muscle_layer;
      if (options?.include_muscles_list !== undefined) params.include_muscles_list = options.include_muscles_list;
      if (options?.include_description !== undefined) params.include_description = options.include_description;
      if (options?.page_size) params.page_size = options.page_size;

      const response = await api.get(`${API_V1_PREFIX}/export/pose/${poseId}/pdf`, {
        params,
        responseType: 'blob',
        onDownloadProgress: (event) => {
          if (!handlers?.onProgress) return;
          const total = typeof event.total === 'number' ? event.total : 0;
          if (total > 0) {
            const percent = Math.min(100, Math.max(0, Math.round((event.loaded / total) * 100)));
            handlers.onProgress(percent);
            return;
          }
          if (event.loaded > 0) {
            // Fallback when content-length is unavailable.
            const estimated = Math.min(95, Math.max(5, Math.round(Math.log10(event.loaded + 1) * 18)));
            handlers.onProgress(estimated);
          }
        },
      });
      return response.data;
    } catch (error) {
      return handleBlobError(error as AxiosError);
    }
  },

  /**
   * Export all poses as PDF (one pose per page)
   */
  allPosesPdf: async (categoryId?: number, pageSize?: 'A4' | 'Letter'): Promise<Blob> => {
    try {
      const params: Record<string, number | string> = {};
      if (categoryId) params.category_id = categoryId;
      if (pageSize) params.page_size = pageSize;

      const response = await api.get(`${API_V1_PREFIX}/export/poses/pdf`, {
        params,
        responseType: 'blob',
      });
      return response.data;
    } catch (error) {
      return handleBlobError(error as AxiosError);
    }
  },

  /**
   * Export full backup (all data)
   */
  backup: async (): Promise<Blob> => {
    try {
      const response = await api.get(`${API_V1_PREFIX}/export/backup`, {
        responseType: 'blob',
      });
      return response.data;
    } catch (error) {
      return handleBlobError(error as AxiosError);
    }
  },

  /**
   * Export categories as JSON
   */
  categoriesJson: async (): Promise<Blob> => {
    try {
      const response = await api.get(`${API_V1_PREFIX}/export/categories/json`, {
        responseType: 'blob',
      });
      return response.data;
    } catch (error) {
      return handleBlobError(error as AxiosError);
    }
  },
};

// === Import API ===

export const importApi = {
  /**
   * Import poses from JSON file
   */
  posesJson: async (file: File, duplicateHandling: DuplicateHandling = 'skip'): Promise<ImportResult> => {
    try {
      const formData = new FormData();
      formData.append('file', file);

      const response = await api.post<ImportResult>(`${API_V1_PREFIX}/import/poses/json`, formData, {
        params: { duplicate_handling: duplicateHandling },
      });
      return response.data;
    } catch (error) {
      throw handleError(error as AxiosError<ApiError>);
    }
  },

  /**
   * Import poses from CSV file
   */
  posesCsv: async (file: File, duplicateHandling: DuplicateHandling = 'skip'): Promise<ImportResult> => {
    try {
      const formData = new FormData();
      formData.append('file', file);

      const response = await api.post<ImportResult>(`${API_V1_PREFIX}/import/poses/csv`, formData, {
        params: { duplicate_handling: duplicateHandling },
      });
      return response.data;
    } catch (error) {
      throw handleError(error as AxiosError<ApiError>);
    }
  },

  /**
   * Restore from backup file
   */
  backup: async (
    file: File,
    duplicateHandling: DuplicateHandling = 'skip',
    importCategories = true,
    importPoses = true
  ): Promise<ImportResult> => {
    try {
      const formData = new FormData();
      formData.append('file', file);

      const response = await api.post<ImportResult>(`${API_V1_PREFIX}/import/backup`, formData, {
        params: {
          duplicate_handling: duplicateHandling,
          import_categories: importCategories,
          import_poses: importPoses,
        },
      });
      return response.data;
    } catch (error) {
      throw handleError(error as AxiosError<ApiError>);
    }
  },

  /**
   * Preview import before executing (JSON files only)
   */
  previewJson: async (file: File, duplicateHandling: DuplicateHandling = 'skip'): Promise<ImportPreviewResult> => {
    try {
      const formData = new FormData();
      formData.append('file', file);

      const response = await api.post<ImportPreviewResult>(`${API_V1_PREFIX}/import/preview/json`, formData, {
        params: { duplicate_handling: duplicateHandling },
      });
      return response.data;
    } catch (error) {
      throw handleError(error as AxiosError<ApiError>);
    }
  },
};

export default api;
