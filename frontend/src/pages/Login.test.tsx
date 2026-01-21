import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { BrowserRouter } from 'react-router-dom';
import { Login } from './Login';
import { useAuthStore } from '../store/useAuthStore';
import { I18nProvider } from '../i18n';

/**
 * Login Component Tests
 *
 * These tests focus on component behavior and UI interactions.
 * Tests use real API calls where possible (backend must be running).
 *
 * Note: Some tests (like error scenarios) cannot be tested with real API
 * without mocking, as we cannot trigger server errors from tests.
 */

// Mock useNavigate (router behavior mock, not data mock)
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
    <I18nProvider>
      <BrowserRouter>
        <Login />
      </BrowserRouter>
    </I18nProvider>
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
      expect(screen.getByText('Студія Поз')).toBeInTheDocument();
    });

    it('renders welcome message', () => {
      renderLogin();
      expect(screen.getByText('Вітаємо')).toBeInTheDocument();
    });

    it('renders token input field', () => {
      renderLogin();
      expect(screen.getByPlaceholderText(/введіть ваш токен/i)).toBeInTheDocument();
    });

    it('renders sign in button', () => {
      renderLogin();
      expect(screen.getByRole('button', { name: /увійти/i })).toBeInTheDocument();
    });

    it('renders instructions text', () => {
      renderLogin();
      expect(screen.getByText(/нові токени створюють акаунт/i)).toBeInTheDocument();
    });
  });

  describe('Form Validation', () => {
    it('shows error when submitting empty token', async () => {
      renderLogin();
      const user = userEvent.setup();

      const button = screen.getByRole('button', { name: /увійти/i });
      await user.click(button);

      expect(screen.getByText(/введіть токен доступу/i)).toBeInTheDocument();
    });

    it('button is disabled when token is empty', () => {
      renderLogin();
      const button = screen.getByRole('button', { name: /увійти/i });
      expect(button).toBeDisabled();
    });

    it('button is enabled when token has value', async () => {
      renderLogin();
      const user = userEvent.setup();

      const input = screen.getByPlaceholderText(/введіть ваш токен/i);
      await user.type(input, 'my-token');

      const button = screen.getByRole('button', { name: /увійти/i });
      expect(button).not.toBeDisabled();
    });
  });

  describe('Login Flow', () => {
    it('shows loading state when submitting', async () => {
      renderLogin();
      const user = userEvent.setup();

      const input = screen.getByPlaceholderText(/введіть ваш токен/i);
      await user.type(input, 'test-token');

      const button = screen.getByRole('button', { name: /увійти/i });
      await user.click(button);

      // Should show loading text immediately after click
      expect(screen.getByText(/вхід/i)).toBeInTheDocument();
    });

    it('navigates to home on successful login', async () => {
      // Uses real API - backend must be running
      renderLogin();
      const user = userEvent.setup();

      const input = screen.getByPlaceholderText(/введіть ваш токен/i);
      await user.type(input, 'valid-token');

      const button = screen.getByRole('button', { name: /увійти/i });
      await user.click(button);

      await waitFor(() => {
        expect(mockNavigate).toHaveBeenCalledWith('/', { replace: true });
      }, { timeout: 10000 });
    });

    it('sets auth state on successful login', async () => {
      // Uses real API - backend must be running
      renderLogin();
      const user = userEvent.setup();

      const input = screen.getByPlaceholderText(/введіть ваш токен/i);
      await user.type(input, 'valid-token');

      const button = screen.getByRole('button', { name: /увійти/i });
      await user.click(button);

      await waitFor(() => {
        const state = useAuthStore.getState();
        expect(state.isAuthenticated).toBe(true);
        expect(state.accessToken).toBeTruthy();
      }, { timeout: 10000 });
    });
  });

  describe('Input Handling', () => {
    it('allows typing in token field', async () => {
      renderLogin();
      const user = userEvent.setup();

      const input = screen.getByPlaceholderText(/введіть ваш токен/i);
      await user.type(input, 'my-test-token');

      expect(input).toHaveValue('my-test-token');
    });

    it('handles special characters in token', async () => {
      renderLogin();
      const user = userEvent.setup();

      const input = screen.getByPlaceholderText(/введіть ваш токен/i);
      await user.type(input, 'token-with_special.chars!@#');

      expect(input).toHaveValue('token-with_special.chars!@#');
    });
  });

  describe('Accessibility', () => {
    it('focuses input on load', () => {
      renderLogin();
      const input = screen.getByPlaceholderText(/введіть ваш токен/i);
      expect(document.activeElement).toBe(input);
    });

    it('has accessible form labels', () => {
      renderLogin();
      expect(screen.getByLabelText(/токен доступу/i)).toBeInTheDocument();
    });

    it('can submit form with Enter key', async () => {
      renderLogin();
      const user = userEvent.setup();

      const input = screen.getByPlaceholderText(/введіть ваш токен/i);
      await user.type(input, 'test-token');
      await user.keyboard('{Enter}');

      // Form should submit (loading state appears)
      await waitFor(() => {
        expect(screen.getByText(/вхід/i)).toBeInTheDocument();
      });
    });
  });
});
