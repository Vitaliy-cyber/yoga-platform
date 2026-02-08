import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import type { User } from '../types';
import { useGenerationStore } from './useGenerationStore';

// Storage key for persisting auth state
const TOKEN_KEY = 'yoga_auth_token';

interface AuthState {
  // Auth state
  user: User | null;
  accessToken: string | null;
  refreshToken: string | null;
  tokenExpiresAt: number | null;  // Unix timestamp in milliseconds
  isAuthenticated: boolean;
  isLoading: boolean;
  isRefreshing: boolean;  // Flag to prevent multiple refresh attempts
  _hasHydrated: boolean;
  lastRefreshAt: number | null;  // Timestamp of last successful token refresh
  refreshError: string | null;   // Error message from last refresh attempt

  // Actions
  setAuth: (user: User, accessToken: string, refreshToken?: string, expiresIn?: number) => void;
  setTokens: (accessToken: string, refreshToken?: string, expiresIn?: number) => void;
  logout: () => void;
  setLoading: (loading: boolean) => void;
  setRefreshing: (refreshing: boolean) => void;
  updateUser: (user: Partial<User>) => void;
  setHasHydrated: (hasHydrated: boolean) => void;
  setLastRefreshAt: (timestamp: number | null) => void;
  setRefreshError: (error: string | null) => void;
}

export const useAuthStore = create<AuthState>()(
  persist(
    (set, get) => ({
      // Initial state
      user: null,
      accessToken: null,
      refreshToken: null,
      tokenExpiresAt: null,
      isAuthenticated: false,
      isLoading: true, // Start as loading to check stored auth
      isRefreshing: false,
      _hasHydrated: false,
      lastRefreshAt: null,
      refreshError: null,

      // Actions
      setAuth: (user, accessToken, refreshToken, expiresIn) => {
        const tokenExpiresAt = expiresIn
          ? Date.now() + expiresIn * 1000
          : null;

        set({
          user,
          accessToken,
          refreshToken: refreshToken || get().refreshToken,
          tokenExpiresAt,
          isAuthenticated: Boolean(accessToken),
          isLoading: false,
        });
        useGenerationStore.getState().syncOwner(user.id);
      },

      setTokens: (accessToken, refreshToken, expiresIn) => {
        const tokenExpiresAt = expiresIn
          ? Date.now() + expiresIn * 1000
          : null;

        set({
          accessToken,
          refreshToken: refreshToken || get().refreshToken,
          tokenExpiresAt,
          isAuthenticated: Boolean(accessToken),
        });
      },

      logout: () => {
        useGenerationStore.getState().syncOwner(null);
        set({
          user: null,
          accessToken: null,
          refreshToken: null,
          tokenExpiresAt: null,
          isAuthenticated: false,
          isLoading: false,
          isRefreshing: false,
          lastRefreshAt: null,
          refreshError: null,
        });
      },

      setLoading: (isLoading) => set({ isLoading }),

      setRefreshing: (isRefreshing) => set({ isRefreshing }),

      updateUser: (updates) =>
        set((state) => ({
          user: state.user ? { ...state.user, ...updates } : null,
        })),

      setHasHydrated: (hasHydrated) => set({ _hasHydrated: hasHydrated }),

      setLastRefreshAt: (timestamp) => set({ lastRefreshAt: timestamp }),

      setRefreshError: (error) => set({ refreshError: error }),

    }),
    {
      name: TOKEN_KEY,
      storage: createJSONStorage(() => localStorage),
      // SECURITY: Only persist accessToken and user in localStorage
      // NEVER persist refreshToken in localStorage - it's vulnerable to XSS attacks
      // The refreshToken is stored in an httpOnly cookie instead, which is
      // inaccessible to JavaScript and thus protected from XSS
      partialize: (state) => ({
        user: state.user,
        accessToken: state.accessToken,
        // SECURITY: refreshToken is INTENTIONALLY NOT persisted
        // It's stored in an httpOnly cookie by the backend
        tokenExpiresAt: state.tokenExpiresAt,
      }),
    }
  )
);

// Handle hydration separately to avoid TDZ issues
// This runs after the store is created
useAuthStore.persist.onFinishHydration((state) => {
  const hasToken = Boolean(state.accessToken);
  const isExpired = state.tokenExpiresAt ? Date.now() >= state.tokenExpiresAt : false;

  // SECURITY: refreshToken is no longer persisted in localStorage (XSS protection)
  // It's stored in an httpOnly cookie instead. We rely on the cookie being present
  // for refresh operations. If the access token is expired, the API interceptor
  // will attempt to refresh using the cookie.
  const shouldStayAuthenticated = hasToken && !isExpired;

  // If we have an expired token but might have a valid refresh cookie,
  // stay in loading state so the app can attempt a refresh
  const mightHaveRefreshCookie = hasToken && isExpired;

  useAuthStore.setState({
    isAuthenticated: shouldStayAuthenticated,
    isLoading: shouldStayAuthenticated || mightHaveRefreshCookie,
    _hasHydrated: true,
  });
  useGenerationStore.getState().syncOwner(state.user?.id ?? null);
});

// Ensure hydration happens
if (typeof window !== 'undefined') {
  useAuthStore.persist.rehydrate();
}

// Helper to get token for API calls (can be used outside React)
export const getAuthToken = (): string | null => {
  return useAuthStore.getState().accessToken;
};
