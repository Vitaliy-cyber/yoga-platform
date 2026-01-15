import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { BrowserRouter } from 'react-router-dom';
import { Login } from './Login';
import { useAuthStore } from '../store/useAuthStore';
import { server } from '../test/setup';
import { http, HttpResponse } from 'msw';

// Mock useNavigate
const mockNavigate = vi.fn();
vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual('react-router-dom');
  return {
    ...actual,
    useNavigate: () => mockNavigate,
  };
});

const renderLogin = () => {
  return render(
    <BrowserRouter>
      <Login />
    </BrowserRouter>
  );
};

describe('Login', () => {
  beforeEach(() => {
    mockNavigate.mockClear();
    useAuthStore.setState({
      user: null,
      accessToken: null,
      isAuthenticated: false,
      isLoading: false,
    });
  });

  describe('Rendering', () => {
    it('renders login page with title', () => {
      renderLogin();
      expect(screen.getByText('Pose Studio')).toBeInTheDocument();
    });

    it('renders welcome message', () => {
      renderLogin();
      expect(screen.getByText('Welcome')).toBeInTheDocument();
    });

    it('renders token input field', () => {
      renderLogin();
      expect(screen.getByPlaceholderText(/enter your unique token/i)).toBeInTheDocument();
    });

    it('renders sign in button', () => {
      renderLogin();
      expect(screen.getByRole('button', { name: /sign in/i })).toBeInTheDocument();
    });

    it('renders instructions text', () => {
      renderLogin();
      expect(screen.getByText(/new tokens create new accounts/i)).toBeInTheDocument();
    });
  });

  describe('Form Validation', () => {
    it('shows error when submitting empty token', async () => {
      renderLogin();
      const user = userEvent.setup();
      
      const button = screen.getByRole('button', { name: /sign in/i });
      await user.click(button);

      expect(screen.getByText(/please enter an access token/i)).toBeInTheDocument();
    });

    it('button is disabled when token is empty', () => {
      renderLogin();
      const button = screen.getByRole('button', { name: /sign in/i });
      expect(button).toBeDisabled();
    });

    it('button is enabled when token has value', async () => {
      renderLogin();
      const user = userEvent.setup();
      
      const input = screen.getByPlaceholderText(/enter your unique token/i);
      await user.type(input, 'my-token');

      const button = screen.getByRole('button', { name: /sign in/i });
      expect(button).not.toBeDisabled();
    });
  });

  describe('Login Flow', () => {
    it('shows loading state during login', async () => {
      // Delay the response to see loading state
      server.use(
        http.post('/api/auth/login', async () => {
          await new Promise(resolve => setTimeout(resolve, 100));
          return HttpResponse.json({
            access_token: 'test-token',
            token_type: 'bearer',
            user: {
              id: 1,
              token: 'test',
              name: null,
              created_at: '2024-01-01',
              last_login: null,
            },
          });
        })
      );

      renderLogin();
      const user = userEvent.setup();
      
      const input = screen.getByPlaceholderText(/enter your unique token/i);
      await user.type(input, 'test-token');

      const button = screen.getByRole('button', { name: /sign in/i });
      await user.click(button);

      // Should show loading text
      expect(screen.getByText(/signing in/i)).toBeInTheDocument();
    });

    it('navigates to home on successful login', async () => {
      renderLogin();
      const user = userEvent.setup();
      
      const input = screen.getByPlaceholderText(/enter your unique token/i);
      await user.type(input, 'valid-token');

      const button = screen.getByRole('button', { name: /sign in/i });
      await user.click(button);

      await waitFor(() => {
        expect(mockNavigate).toHaveBeenCalledWith('/', { replace: true });
      });
    });

    it('sets auth state on successful login', async () => {
      renderLogin();
      const user = userEvent.setup();
      
      const input = screen.getByPlaceholderText(/enter your unique token/i);
      await user.type(input, 'valid-token');

      const button = screen.getByRole('button', { name: /sign in/i });
      await user.click(button);

      await waitFor(() => {
        const state = useAuthStore.getState();
        expect(state.isAuthenticated).toBe(true);
        expect(state.accessToken).toBe('mock-jwt-token-xyz');
      });
    });

    it('shows error message on login failure', async () => {
      server.use(
        http.post('/api/auth/login', () => {
          return HttpResponse.json(
            { detail: 'Invalid token' },
            { status: 400 }
          );
        })
      );

      renderLogin();
      const user = userEvent.setup();
      
      const input = screen.getByPlaceholderText(/enter your unique token/i);
      await user.type(input, 'invalid-token');

      const button = screen.getByRole('button', { name: /sign in/i });
      await user.click(button);

      await waitFor(() => {
        expect(screen.getByText(/invalid token/i)).toBeInTheDocument();
      });
    });

    it('does not navigate on login failure', async () => {
      server.use(
        http.post('/api/auth/login', () => {
          return HttpResponse.json(
            { detail: 'Error' },
            { status: 500 }
          );
        })
      );

      renderLogin();
      const user = userEvent.setup();
      
      const input = screen.getByPlaceholderText(/enter your unique token/i);
      await user.type(input, 'test-token');

      const button = screen.getByRole('button', { name: /sign in/i });
      await user.click(button);

      await waitFor(() => {
        expect(screen.getByText(/error/i)).toBeInTheDocument();
      });

      expect(mockNavigate).not.toHaveBeenCalled();
    });
  });

  describe('Input Handling', () => {
    it('trims whitespace from token', async () => {
      let capturedToken = '';
      server.use(
        http.post('/api/auth/login', async ({ request }) => {
          const body = await request.json() as { token: string };
          capturedToken = body.token;
          return HttpResponse.json({
            access_token: 'test',
            token_type: 'bearer',
            user: {
              id: 1,
              token: body.token,
              name: null,
              created_at: '2024-01-01',
              last_login: null,
            },
          });
        })
      );

      renderLogin();
      const user = userEvent.setup();
      
      const input = screen.getByPlaceholderText(/enter your unique token/i);
      await user.type(input, '  my-token  ');

      const button = screen.getByRole('button', { name: /sign in/i });
      await user.click(button);

      await waitFor(() => {
        expect(capturedToken).toBe('my-token');
      });
    });

    it('handles special characters in token', async () => {
      renderLogin();
      const user = userEvent.setup();
      
      const input = screen.getByPlaceholderText(/enter your unique token/i);
      await user.type(input, 'token-with_special.chars!@#');

      const button = screen.getByRole('button', { name: /sign in/i });
      await user.click(button);

      await waitFor(() => {
        expect(mockNavigate).toHaveBeenCalled();
      });
    });
  });

  describe('Accessibility', () => {
    it('focuses input on load', () => {
      renderLogin();
      const input = screen.getByPlaceholderText(/enter your unique token/i);
      expect(document.activeElement).toBe(input);
    });

    it('has accessible form labels', () => {
      renderLogin();
      expect(screen.getByLabelText(/access token/i)).toBeInTheDocument();
    });

    it('can submit form with Enter key', async () => {
      renderLogin();
      const user = userEvent.setup();
      
      const input = screen.getByPlaceholderText(/enter your unique token/i);
      await user.type(input, 'test-token');
      await user.keyboard('{Enter}');

      await waitFor(() => {
        expect(mockNavigate).toHaveBeenCalled();
      });
    });
  });
});
