import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import type { User } from '../types';

// Storage key for persisting auth state
const TOKEN_KEY = 'yoga_auth_token';

interface AuthState {
  // Auth state
  user: User | null;
  accessToken: string | null;
  isAuthenticated: boolean;
  isLoading: boolean;
  _hasHydrated: boolean;

  // Actions
  setAuth: (user: User, accessToken: string) => void;
  logout: () => void;
  setLoading: (loading: boolean) => void;
  updateUser: (user: Partial<User>) => void;
  setHasHydrated: (hasHydrated: boolean) => void;
}

export const useAuthStore = create<AuthState>()(
  persist(
    (set) => ({
      // Initial state
      user: null,
      accessToken: null,
      isAuthenticated: false,
      isLoading: true, // Start as loading to check stored auth
      _hasHydrated: false,

      // Actions
      setAuth: (user, accessToken) =>
        set({
          user,
          accessToken,
          isAuthenticated: Boolean(accessToken),
          isLoading: false,
        }),

      logout: () =>
        set({
          user: null,
          accessToken: null,
          isAuthenticated: false,
          isLoading: false,
        }),

      setLoading: (isLoading) => set({ isLoading }),

      updateUser: (updates) =>
        set((state) => ({
          user: state.user ? { ...state.user, ...updates } : null,
        })),

      setHasHydrated: (hasHydrated) => set({ _hasHydrated: hasHydrated }),
    }),
    {
      name: TOKEN_KEY,
      storage: createJSONStorage(() => localStorage),
      // Only persist token and user, not loading/auth flags
      partialize: (state) => ({
        user: state.user,
        accessToken: state.accessToken,
      }),
    }
  )
);

// Handle hydration separately to avoid TDZ issues
// This runs after the store is created
useAuthStore.persist.onFinishHydration((state) => {
  const hasToken = Boolean(state.accessToken);
  useAuthStore.setState({
    isAuthenticated: hasToken,
    isLoading: hasToken, // Will be set to false after validation in App.tsx
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
