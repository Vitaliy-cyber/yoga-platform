import { useEffect, useRef, useCallback } from 'react';
import { tokenManager } from '../services/api';
import { useAuthStore } from '../store/useAuthStore';
import { logger } from '../lib/logger';

/**
 * Return type for the useTokenRefresh hook.
 */
export interface UseTokenRefreshReturn {
  /** Whether a token refresh is currently in progress */
  isRefreshing: boolean;
  /** Error message from the last refresh attempt, if any */
  error: string | null;
  /** Timestamp of the last successful refresh */
  lastRefreshAt: number | null;
  /** Manually trigger a token refresh */
  forceRefresh: () => Promise<boolean>;
}

/**
 * Hook to manage token refresh lifecycle in React components.
 *
 * This hook:
 * 1. Starts the TokenManager when the user is authenticated
 * 2. Performs an initial silent refresh on mount if token is expired
 * 3. Stops the TokenManager when user logs out or component unmounts
 * 4. Exposes refresh state and manual refresh trigger
 *
 * @example
 * ```tsx
 * function App() {
 *   const { isRefreshing, error, forceRefresh } = useTokenRefresh();
 *
 *   if (error) {
 *     return <div>Session error: {error}</div>;
 *   }
 *
 *   return <MainContent />;
 * }
 * ```
 */
export function useTokenRefresh(): UseTokenRefreshReturn {
  const isRefreshing = useAuthStore((state) => state.isRefreshing);
  const error = useAuthStore((state) => state.refreshError);
  const lastRefreshAt = useAuthStore((state) => state.lastRefreshAt);
  const isAuthenticated = useAuthStore((state) => state.isAuthenticated);
  const _hasHydrated = useAuthStore((state) => state._hasHydrated);

  // Track if we've performed initial refresh
  const hasInitialRefreshRef = useRef(false);

  // Start/stop TokenManager based on authentication state
  useEffect(() => {
    // Wait for store hydration
    if (!_hasHydrated) {
      return;
    }

    // Track if this effect instance is still active
    let cancelled = false;

    if (isAuthenticated) {
      logger.debug('useTokenRefresh: Starting TokenManager');
      tokenManager.start();

      // Perform initial silent refresh if not done yet
      if (!hasInitialRefreshRef.current) {
        hasInitialRefreshRef.current = true;
        tokenManager.silentRefresh().then((success) => {
          // Only log if not cancelled (component still mounted)
          if (!cancelled && !success) {
            logger.warn('useTokenRefresh: Initial refresh failed');
          }
        });
      }
    } else {
      logger.debug('useTokenRefresh: Stopping TokenManager (not authenticated)');
      tokenManager.stop();
      hasInitialRefreshRef.current = false;
    }

    return () => {
      cancelled = true;
      // Note: We don't stop TokenManager here because App.tsx manages its lifecycle.
      // This hook only starts it if authenticated and tracks refresh state.
      // Stopping here would cause issues during React re-renders.
    };
  }, [isAuthenticated, _hasHydrated]);

  // Manual refresh trigger
  const forceRefresh = useCallback(async (): Promise<boolean> => {
    if (!isAuthenticated) {
      logger.warn('useTokenRefresh: Cannot force refresh - not authenticated');
      return false;
    }
    return tokenManager.silentRefresh();
  }, [isAuthenticated]);

  return {
    isRefreshing,
    error,
    lastRefreshAt,
    forceRefresh,
  };
}

/**
 * Hook to get just the refresh state without starting TokenManager.
 * Useful for components that need to display refresh status but don't
 * want to manage the TokenManager lifecycle.
 */
export function useTokenRefreshState(): Pick<UseTokenRefreshReturn, 'isRefreshing' | 'error' | 'lastRefreshAt'> {
  const isRefreshing = useAuthStore((state) => state.isRefreshing);
  const error = useAuthStore((state) => state.refreshError);
  const lastRefreshAt = useAuthStore((state) => state.lastRefreshAt);

  return { isRefreshing, error, lastRefreshAt };
}
