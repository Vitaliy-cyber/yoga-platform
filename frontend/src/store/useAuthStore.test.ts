import { describe, it, expect, beforeEach, vi } from 'vitest';
import { act } from '@testing-library/react';
import { useAuthStore, getAuthToken } from './useAuthStore';
import type { User } from '../types';

// Mock localStorage
const localStorageMock = (() => {
  let store: Record<string, string> = {};
  return {
    getItem: vi.fn((key: string) => store[key] || null),
    setItem: vi.fn((key: string, value: string) => {
      store[key] = value;
    }),
    removeItem: vi.fn((key: string) => {
      delete store[key];
    }),
    clear: vi.fn(() => {
      store = {};
    }),
  };
})();

Object.defineProperty(window, 'localStorage', { value: localStorageMock });

describe('useAuthStore', () => {
  const mockUser: User = {
    id: 1,
    name: 'Test User',
    created_at: '2024-01-01T00:00:00Z',
    last_login: '2024-01-02T00:00:00Z',
  };

  const mockAccessToken = 'jwt-access-token-xyz';

  beforeEach(() => {
    // Reset store state before each test
    localStorageMock.clear();
    useAuthStore.setState({
      user: null,
      accessToken: null,
      isAuthenticated: false,
      isLoading: false,
    });
  });

  describe('Initial State', () => {
    it('initializes with no user', () => {
      const { user } = useAuthStore.getState();
      expect(user).toBeNull();
    });

    it('initializes with no access token', () => {
      const { accessToken } = useAuthStore.getState();
      expect(accessToken).toBeNull();
    });

    it('initializes as not authenticated', () => {
      const { isAuthenticated } = useAuthStore.getState();
      expect(isAuthenticated).toBe(false);
    });
  });

  describe('setAuth', () => {
    it('sets user and access token', () => {
      act(() => {
        useAuthStore.getState().setAuth(mockUser, mockAccessToken);
      });

      const state = useAuthStore.getState();
      expect(state.user).toEqual(mockUser);
      expect(state.accessToken).toBe(mockAccessToken);
    });

    it('sets isAuthenticated to true', () => {
      act(() => {
        useAuthStore.getState().setAuth(mockUser, mockAccessToken);
      });

      expect(useAuthStore.getState().isAuthenticated).toBe(true);
    });

    it('sets isLoading to false', () => {
      act(() => {
        useAuthStore.getState().setLoading(true);
      });

      act(() => {
        useAuthStore.getState().setAuth(mockUser, mockAccessToken);
      });

      expect(useAuthStore.getState().isLoading).toBe(false);
    });
  });

  describe('logout', () => {
    it('clears user and token', () => {
      act(() => {
        useAuthStore.getState().setAuth(mockUser, mockAccessToken);
      });

      act(() => {
        useAuthStore.getState().logout();
      });

      const state = useAuthStore.getState();
      expect(state.user).toBeNull();
      expect(state.accessToken).toBeNull();
    });

    it('sets isAuthenticated to false', () => {
      act(() => {
        useAuthStore.getState().setAuth(mockUser, mockAccessToken);
      });

      act(() => {
        useAuthStore.getState().logout();
      });

      expect(useAuthStore.getState().isAuthenticated).toBe(false);
    });

    it('sets isLoading to false', () => {
      act(() => {
        useAuthStore.getState().setLoading(true);
      });

      act(() => {
        useAuthStore.getState().logout();
      });

      expect(useAuthStore.getState().isLoading).toBe(false);
    });
  });

  describe('setLoading', () => {
    it('sets loading to true', () => {
      act(() => {
        useAuthStore.getState().setLoading(true);
      });

      expect(useAuthStore.getState().isLoading).toBe(true);
    });

    it('sets loading to false', () => {
      act(() => {
        useAuthStore.getState().setLoading(true);
      });

      act(() => {
        useAuthStore.getState().setLoading(false);
      });

      expect(useAuthStore.getState().isLoading).toBe(false);
    });
  });

  describe('updateUser', () => {
    it('updates user name', () => {
      act(() => {
        useAuthStore.getState().setAuth(mockUser, mockAccessToken);
      });

      act(() => {
        useAuthStore.getState().updateUser({ name: 'New Name' });
      });

      expect(useAuthStore.getState().user?.name).toBe('New Name');
    });

    it('preserves other user fields when updating', () => {
      act(() => {
        useAuthStore.getState().setAuth(mockUser, mockAccessToken);
      });

      act(() => {
        useAuthStore.getState().updateUser({ name: 'Updated' });
      });

      const user = useAuthStore.getState().user;
      expect(user?.id).toBe(mockUser.id);
      expect(user?.created_at).toBe(mockUser.created_at);
    });

    it('does nothing if no user is logged in', () => {
      act(() => {
        useAuthStore.getState().updateUser({ name: 'New Name' });
      });

      expect(useAuthStore.getState().user).toBeNull();
    });
  });

  describe('getAuthToken helper', () => {
    it('returns null when not authenticated', () => {
      const token = getAuthToken();
      expect(token).toBeNull();
    });

    it('returns access token when authenticated', () => {
      act(() => {
        useAuthStore.getState().setAuth(mockUser, mockAccessToken);
      });

      const token = getAuthToken();
      expect(token).toBe(mockAccessToken);
    });

    it('returns null after logout', () => {
      act(() => {
        useAuthStore.getState().setAuth(mockUser, mockAccessToken);
      });

      act(() => {
        useAuthStore.getState().logout();
      });

      const token = getAuthToken();
      expect(token).toBeNull();
    });
  });

  describe('Multiple Users', () => {
    it('can switch between users', () => {
      const user1: User = { ...mockUser, id: 1 };
      const user2: User = { ...mockUser, id: 2 };

      act(() => {
        useAuthStore.getState().setAuth(user1, 'jwt-1');
      });

      expect(useAuthStore.getState().user?.id).toBe(1);

      act(() => {
        useAuthStore.getState().logout();
      });

      act(() => {
        useAuthStore.getState().setAuth(user2, 'jwt-2');
      });

      expect(useAuthStore.getState().user?.id).toBe(2);
      expect(useAuthStore.getState().accessToken).toBe('jwt-2');
    });
  });

  describe('User with null name', () => {
    it('handles user without name', () => {
      const userWithoutName: User = {
        ...mockUser,
        name: null,
      };

      act(() => {
        useAuthStore.getState().setAuth(userWithoutName, mockAccessToken);
      });

      expect(useAuthStore.getState().user?.name).toBeNull();
    });

    it('can set name for user who had null name', () => {
      const userWithoutName: User = {
        ...mockUser,
        name: null,
      };

      act(() => {
        useAuthStore.getState().setAuth(userWithoutName, mockAccessToken);
      });

      act(() => {
        useAuthStore.getState().updateUser({ name: 'New Name' });
      });

      expect(useAuthStore.getState().user?.name).toBe('New Name');
    });
  });
});
