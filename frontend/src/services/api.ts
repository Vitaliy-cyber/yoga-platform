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
  SessionListResponse,
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
} from '../lib/constants';

// Get API URL from env or use relative path (for same-origin requests)
// Remove trailing slashes to prevent double-slash issues (e.g., "https://api.example.com/" + "${API_V1_PREFIX}/poses" = "https://api.example.com/${API_V1_PREFIX}/poses")
const rawApiUrl = import.meta.env.VITE_API_URL || window.location.origin;
const API_BASE_URL = rawApiUrl.replace(/\/+$/, '');

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
  // If we have a direct URL (e.g., S3 presigned URL), use it
  if (directPath && (directPath.startsWith('http://') || directPath.startsWith('https://'))) {
    return directPath;
  }
  // Fallback to proxy endpoint (requires auth - may not work for <img> tags)
  return getImageProxyUrl(poseId, imageType);
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
  imageType: 'schema' | 'photo' | 'muscle_layer' | 'skeleton_layer'
): Promise<string> => {
  try {
    const response = await api.get<{ signed_url: string }>(
      `${API_V1_PREFIX}/poses/${poseId}/image/${imageType}/signed-url`
    );
    return response.data.signed_url;
  } catch (error) {
    // Log the error for debugging, then fall back to base URL (will require auth header)
    logger.warn(`Failed to get signed URL for pose ${poseId} ${imageType}:`, error);
    return getImageProxyUrl(poseId, imageType);
  }
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
      // SECURITY: Don't send refresh_token in body - it's in httpOnly cookie
      // The server will read it from the cookie
      const response = await axios.post<TokenPairResponse>(
        `${API_BASE_URL}${API_V1_PREFIX}/auth/refresh`,
        {}, // Empty body - token comes from cookie
        { withCredentials: true }
      );

      const { access_token, expires_in, user } = response.data;

      // Update store with new tokens
      // Note: refresh_token is NOT stored in the store (XSS protection)
      useAuthStore.getState().setAuth(user, access_token, undefined, expires_in);

      return access_token;
    } catch {
      // Refresh failed - logout
      useAuthStore.getState().logout();
      return null;
    } finally {
      // Clear the promise so future refreshes can proceed
      refreshPromise = null;
    }
  })();

  return refreshPromise;
};

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
      // If refresh returned null, throw error to prevent hanging request
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

// Error handling helper
const handleError = (error: AxiosError<ApiError>): never => {
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

  throw new Error(message);
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
      const response = await api.get<Category[]>(`${API_V1_PREFIX}/categories`, { signal });
      return response.data;
    } catch (error) {
      // Re-throw abort errors without transformation
      if (axios.isCancel(error) || (error instanceof Error && error.name === 'AbortError')) {
        const abortError = new Error('Request aborted');
        abortError.name = 'AbortError';
        throw abortError;
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

  getById: async (id: number): Promise<Pose> => {
    try {
      const response = await api.get<Pose>(`${API_V1_PREFIX}/poses/${id}`);
      return response.data;
    } catch (error) {
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
};

// === Generate API ===

export const generateApi = {
  /**
   * Генерація зображень з схеми пози
   * Пайплайн: Схема → Фото → М'язи
   */
  generate: async (file: File, additionalNotes?: string): Promise<GenerateResponse> => {
    try {
      const formData = new FormData();
      formData.append('schema_file', file);
      if (additionalNotes?.trim()) {
        formData.append('additional_notes', additionalNotes);
      }

      const response = await api.post<GenerateResponse>(`${API_V1_PREFIX}/generate`, formData);
      return response.data;
    } catch (error) {
      throw handleError(error as AxiosError<ApiError>);
    }
  },

  /**
   * Генерація зображень з існуючої схеми пози (server-side fetch)
   * Обходить CORS проблеми - сервер сам завантажує схему
   */
  generateFromPose: async (poseId: number, additionalNotes?: string): Promise<GenerateResponse> => {
    try {
      // Always send an object body (even empty) to ensure Content-Type: application/json is set
      const body = additionalNotes?.trim() ? { additional_notes: additionalNotes } : {};
      const response = await api.post<GenerateResponse>(`${API_V1_PREFIX}/generate/from-pose/${poseId}`, body);
      return response.data;
    } catch (error) {
      throw handleError(error as AxiosError<ApiError>);
    }
  },

  /**
   * Генерація зображень з текстового опису пози
   * Не потребує завантаження зображення - AI генерує з опису
   */
  generateFromText: async (description: string, additionalNotes?: string): Promise<GenerateResponse> => {
    try {
      const body: { description: string; additional_notes?: string } = { description };
      if (additionalNotes?.trim()) {
        body.additional_notes = additionalNotes;
      }
      const response = await api.post<GenerateResponse>(`${API_V1_PREFIX}/generate/from-text`, body);
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
   * @returns WebSocket URL with token authentication
   */
  getWebSocketUrl: (taskId: string): string => {
    const token = getAuthToken();
    // Convert http(s) to ws(s)
    const wsBase = API_BASE_URL.replace(/^http/, 'ws');
    return `${wsBase}${API_V1_PREFIX}/ws/generate/${taskId}?token=${encodeURIComponent(token || '')}`;
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
    }
  },

  logoutAll: async (): Promise<void> => {
    try {
      await api.post(`${API_V1_PREFIX}/auth/logout-all`);
    } catch (error) {
      throw handleError(error as AxiosError<ApiError>);
    }
  },

  getMe: async (): Promise<User> => {
    try {
      const response = await api.get<User>(`${API_V1_PREFIX}/auth/me`);
      return response.data;
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

  getSessions: async (): Promise<SessionListResponse> => {
    try {
      const response = await api.get<SessionListResponse>(`${API_V1_PREFIX}/auth/sessions`);
      return response.data;
    } catch (error) {
      throw handleError(error as AxiosError<ApiError>);
    }
  },

  revokeSession: async (sessionId: number): Promise<void> => {
    try {
      await api.delete(`${API_V1_PREFIX}/auth/sessions/${sessionId}`);
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
      const response = await api.get<ComparisonResult>('/api/compare/poses', {
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
      const response = await api.get<MuscleComparison[]>('/api/compare/muscles', {
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
      const response = await api.get<OverviewStats>('/api/analytics/overview');
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
      const response = await api.get<MuscleStats[]>('/api/analytics/muscles');
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
      const response = await api.get<MuscleHeatmapData>('/api/analytics/muscle-heatmap');
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
      const response = await api.get<CategoryStats[]>('/api/analytics/categories');
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
      const response = await api.get<RecentActivity[]>('/api/analytics/recent-activity', {
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
      const response = await api.get<BodyPartBalance[]>('/api/analytics/body-part-balance');
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
      const response = await api.get<AnalyticsSummary>('/api/analytics/summary', { signal });
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
      const response = await api.get<PaginatedSequenceResponse>('/api/sequences', {
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
      const response = await api.get<Sequence>(`/api/sequences/${id}`);
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
      const response = await api.post<Sequence>('/api/sequences', data);
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
      const response = await api.put<Sequence>(`/api/sequences/${id}`, data);
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
      await api.delete(`/api/sequences/${id}`);
    } catch (error) {
      throw handleError(error as AxiosError<ApiError>);
    }
  },

  /**
   * Add a pose to a sequence
   */
  addPose: async (sequenceId: number, poseData: SequencePoseCreate): Promise<Sequence> => {
    try {
      const response = await api.post<Sequence>(`/api/sequences/${sequenceId}/poses`, poseData);
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
      const response = await api.put<Sequence>(`/api/sequences/${sequenceId}/poses/${sequencePoseId}`, poseData);
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
      const response = await api.delete<Sequence>(`/api/sequences/${sequenceId}/poses/${sequencePoseId}`);
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
      const response = await api.put<Sequence>(`/api/sequences/${sequenceId}/poses/reorder`, data);
      return response.data;
    } catch (error) {
      throw handleError(error as AxiosError<ApiError>);
    }
  },
};

// === Versions API ===

export const versionsApi = {
  /**
   * Get version history for a pose
   */
  list: async (poseId: number, skip = 0, limit = 50, signal?: AbortSignal): Promise<PoseVersionListItem[]> => {
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
      throw handleError(error as AxiosError<ApiError>);
    }
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
    try {
      const response = await api.get<PoseVersionDetail>(`${API_V1_PREFIX}/poses/${poseId}/versions/${versionId}`);
      return response.data;
    } catch (error) {
      throw handleError(error as AxiosError<ApiError>);
    }
  },

  /**
   * Restore pose to a specific version
   */
  restore: async (poseId: number, versionId: number, data?: RestoreVersionRequest): Promise<{ success: boolean; message: string; pose_id: number }> => {
    try {
      const response = await api.post<{ success: boolean; message: string; pose_id: number }>(
        `${API_V1_PREFIX}/poses/${poseId}/versions/${versionId}/restore`,
        data || {}
      );
      return response.data;
    } catch (error) {
      throw handleError(error as AxiosError<ApiError>);
    }
  },

  /**
   * Compare two versions
   */
  diff: async (poseId: number, v1: number, v2: number): Promise<VersionComparisonResult> => {
    try {
      const response = await api.get<VersionComparisonResult>(`${API_V1_PREFIX}/poses/${poseId}/versions/${v1}/diff/${v2}`);
      return response.data;
    } catch (error) {
      throw handleError(error as AxiosError<ApiError>);
    }
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
      const response = await api.get('/api/export/poses/json', {
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
      const response = await api.get('/api/export/poses/csv', {
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
  posePdf: async (poseId: number, options?: Partial<PDFExportOptions>): Promise<Blob> => {
    try {
      const params: Record<string, boolean | string> = {};
      if (options?.include_photo !== undefined) params.include_photo = options.include_photo;
      if (options?.include_schema !== undefined) params.include_schema = options.include_schema;
      if (options?.include_muscle_layer !== undefined) params.include_muscle_layer = options.include_muscle_layer;
      if (options?.include_muscles_list !== undefined) params.include_muscles_list = options.include_muscles_list;
      if (options?.include_description !== undefined) params.include_description = options.include_description;
      if (options?.page_size) params.page_size = options.page_size;

      const response = await api.get(`/api/export/pose/${poseId}/pdf`, {
        params,
        responseType: 'blob',
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

      const response = await api.get('/api/export/poses/pdf', {
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
      const response = await api.get('/api/export/backup', {
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
      const response = await api.get('/api/export/categories/json', {
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

      const response = await api.post<ImportResult>('/api/import/poses/json', formData, {
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

      const response = await api.post<ImportResult>('/api/import/poses/csv', formData, {
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

      const response = await api.post<ImportResult>('/api/import/backup', formData, {
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

      const response = await api.post<ImportPreviewResult>('/api/import/preview/json', formData, {
        params: { duplicate_handling: duplicateHandling },
      });
      return response.data;
    } catch (error) {
      throw handleError(error as AxiosError<ApiError>);
    }
  },
};

export default api;
