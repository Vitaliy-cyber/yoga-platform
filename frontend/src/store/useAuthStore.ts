import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { User } from '../types';

const TOKEN_KEY = 'yoga_auth_token';

interface AuthState {
  // Auth state
  user: User | null;
  accessToken: string | null;
  isAuthenticated: boolean;
  isLoading: boolean;

  // Actions
  setAuth: (user: User, accessToken: string) => void;
  logout: () => void;
  setLoading: (loading: boolean) => void;
  updateUser: (user: Partial<User>) => void;
}

export const useAuthStore = create<AuthState>()(
  persist(
    (set) => ({
      // Initial state
      user: null,
      accessToken: null,
      isAuthenticated: false,
      isLoading: true, // Start as loading to check stored auth

      // Actions
      setAuth: (user, accessToken) =>
        set({
          user,
          accessToken,
          isAuthenticated: true,
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
    }),
    {
      name: TOKEN_KEY,
      // Only persist token and user, not loading state
      partialize: (state) => ({
        user: state.user,
        accessToken: state.accessToken,
        isAuthenticated: state.isAuthenticated,
      }),
      // After rehydration, set loading to false
      onRehydrateStorage: () => (state, error) => {
        if (error) {
          console.error('Failed to rehydrate auth state:', error);
        }
        // Use setState to properly trigger re-render
        useAuthStore.setState({ isLoading: false });
      },
    }
  )
);

// Helper to get token for API calls (can be used outside React)
export const getAuthToken = (): string | null => {
  return useAuthStore.getState().accessToken;
};
