import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import type { User } from '../types';

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

  // Actions
  setAuth: (user: User, accessToken: string, refreshToken?: string, expiresIn?: number) => void;
  setTokens: (accessToken: string, refreshToken?: string, expiresIn?: number) => void;
  logout: () => void;
  setLoading: (loading: boolean) => void;
  setRefreshing: (refreshing: boolean) => void;
  updateUser: (user: Partial<User>) => void;
  setHasHydrated: (hasHydrated: boolean) => void;
  isTokenExpired: () => boolean;
  shouldRefreshToken: () => boolean;
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

      logout: () =>
        set({
          user: null,
          accessToken: null,
          refreshToken: null,
          tokenExpiresAt: null,
          isAuthenticated: false,
          isLoading: false,
          isRefreshing: false,
        }),

      setLoading: (isLoading) => set({ isLoading }),

      setRefreshing: (isRefreshing) => set({ isRefreshing }),

      updateUser: (updates) =>
        set((state) => ({
          user: state.user ? { ...state.user, ...updates } : null,
        })),

      setHasHydrated: (hasHydrated) => set({ _hasHydrated: hasHydrated }),

      // Check if token is expired
      isTokenExpired: () => {
        const { accessToken, tokenExpiresAt } = get();
        // Return true if there's no access token (considered expired/invalid)
        if (!accessToken) return true;
        // Return false if we have token but no expiry info (assume valid)
        if (!tokenExpiresAt) return false;
        return Date.now() >= tokenExpiresAt;
      },

      // Check if token should be refreshed (expires within 1 minute)
      shouldRefreshToken: () => {
        const { tokenExpiresAt, refreshToken } = get();
        if (!tokenExpiresAt || !refreshToken) return false;
        // Refresh if token expires within 60 seconds
        return Date.now() >= tokenExpiresAt - 60000;
      },
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
});

// Ensure hydration happens
if (typeof window !== 'undefined') {
  useAuthStore.persist.rehydrate();
}

// Helper to get token for API calls (can be used outside React)
export const getAuthToken = (): string | null => {
  return useAuthStore.getState().accessToken;
};

// Helper to get refresh token
export const getRefreshToken = (): string | null => {
  return useAuthStore.getState().refreshToken;
};

// Helper to check if should refresh
export const shouldRefresh = (): boolean => {
  return useAuthStore.getState().shouldRefreshToken();
};
