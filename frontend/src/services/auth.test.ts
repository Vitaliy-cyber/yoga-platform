import { describe, it, expect } from 'vitest';
import { authApi } from './api';
import { server } from '../test/setup';
import { http, HttpResponse } from 'msw';

describe('authApi', () => {
  describe('login', () => {
    it('returns token response on successful login', async () => {
      const response = await authApi.login({ token: 'my-test-token' });

      expect(response.access_token).toBe('mock-jwt-token-xyz');
      expect(response.token_type).toBe('bearer');
      expect(response.user).toBeDefined();
      expect(response.user.token).toBe('my-test-token');
    });

    it('throws error when token is empty', async () => {
      server.use(
        http.post('/api/auth/login', () => {
          return HttpResponse.json(
            { detail: [{ msg: 'Token is required' }] },
            { status: 422 }
          );
        })
      );

      await expect(authApi.login({ token: '' })).rejects.toThrow();
    });

    it('handles server error', async () => {
      server.use(
        http.post('/api/auth/login', () => {
          return HttpResponse.json(
            { detail: 'Internal server error' },
            { status: 500 }
          );
        })
      );

      await expect(authApi.login({ token: 'test' })).rejects.toThrow('Internal server error');
    });
  });

  describe('getMe', () => {
    it('returns user when authenticated', async () => {
      // Note: In real tests, we need to set up auth header
      // This test relies on MSW mock that doesn't check auth
      server.use(
        http.get('/api/auth/me', () => {
          return HttpResponse.json({
            id: 1,
            token: 'test-token',
            name: 'Test User',
            created_at: '2024-01-01T00:00:00Z',
            last_login: null,
          });
        })
      );

      const user = await authApi.getMe();
      expect(user.id).toBe(1);
      expect(user.name).toBe('Test User');
    });

    it('throws error when not authenticated', async () => {
      server.use(
        http.get('/api/auth/me', () => {
          return HttpResponse.json(
            { detail: 'Not authenticated' },
            { status: 401 }
          );
        })
      );

      await expect(authApi.getMe()).rejects.toThrow('Not authenticated');
    });
  });

  describe('updateMe', () => {
    it('updates user name', async () => {
      server.use(
        http.put('/api/auth/me', async ({ request }) => {
          const body = await request.json() as { name?: string };
          return HttpResponse.json({
            id: 1,
            token: 'test-token',
            name: body.name || 'Default',
            created_at: '2024-01-01T00:00:00Z',
            last_login: null,
          });
        })
      );

      const user = await authApi.updateMe({ name: 'New Name' });
      expect(user.name).toBe('New Name');
    });

    it('throws error when not authenticated', async () => {
      server.use(
        http.put('/api/auth/me', () => {
          return HttpResponse.json(
            { detail: 'Not authenticated' },
            { status: 401 }
          );
        })
      );

      await expect(authApi.updateMe({ name: 'Test' })).rejects.toThrow('Not authenticated');
    });
  });
});
