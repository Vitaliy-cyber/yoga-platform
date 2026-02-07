import React, { useEffect } from 'react';
import axios from 'axios';
import { createBrowserRouter, RouterProvider, Navigate, Outlet } from 'react-router-dom';
import { MotionConfig } from 'framer-motion';
import { Layout } from './components/Layout';
import { Dashboard, PoseGallery, PoseDetail, Upload, Generate, Login, ComparePage, AnalyticsDashboard, SequenceListPage, SequenceNew, SequenceDetail, Settings } from './pages';
import { authApi, tokenManager } from './services/api';
import { useAuthStore } from './store/useAuthStore';
import { AlertTriangle, Loader2 } from 'lucide-react';
import { I18nProvider } from './i18n';
import { ToastContainer } from './components/ui/toast';
import { ErrorBoundary } from './components/ui/error-boundary';

// Protected route wrapper - redirects to login if not authenticated
const ProtectedRoute: React.FC = () => {
  const { isAuthenticated, isLoading } = useAuthStore();

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background" aria-busy="true" role="status">
        <Loader2 className="w-8 h-8 text-muted-foreground animate-spin" />
        <span className="sr-only">Authenticating...</span>
      </div>
    );
  }

  if (!isAuthenticated) {
    return <Navigate to="/login" replace />;
  }

  return <Outlet />;
};

// Public route wrapper - redirects to dashboard if already authenticated
const PublicRoute: React.FC = () => {
  const { isAuthenticated, isLoading } = useAuthStore();

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background" aria-busy="true" role="status">
        <Loader2 className="w-8 h-8 text-muted-foreground animate-spin" />
        <span className="sr-only">Authenticating...</span>
      </div>
    );
  }

  if (isAuthenticated) {
    return <Navigate to="/" replace />;
  }

  return <Outlet />;
};

const router = createBrowserRouter(
  [
    // Public routes (login)
    {
      element: <PublicRoute />,
      children: [
        { path: '/login', element: <Login /> },
      ],
    },
    // Protected routes (app)
    {
      element: <ProtectedRoute />,
      children: [
        {
          path: '/',
          element: <Layout />,
          children: [
            { index: true, element: <Dashboard /> },
            { path: 'poses', element: <PoseGallery /> },
            { path: 'poses/:id', element: <PoseDetail /> },
            { path: 'upload', element: <Upload /> },
            { path: 'generate', element: <Generate /> },
            { path: 'compare', element: <ComparePage /> },
            { path: 'analytics', element: <AnalyticsDashboard /> },
            { path: 'sequences', element: <SequenceListPage /> },
            { path: 'sequences/new', element: <SequenceNew /> },
            { path: 'sequences/:id', element: <SequenceDetail /> },
            { path: 'settings', element: <Settings /> },
          ],
        },
      ],
    },
    // Catch-all redirect
    {
      path: '*',
      element: <Navigate to="/" replace />,
    },
  ],
  {
    future: {
      v7_relativeSplatPath: true,
      v7_fetcherPersist: true,
      v7_normalizeFormMethod: true,
      v7_partialHydration: true,
      v7_skipActionErrorRevalidation: true,
    },
  }
);

const GlobalAppErrorFallback: React.FC = () => {
  return (
    <div className="min-h-screen bg-background flex items-center justify-center p-6">
      <div className="max-w-md w-full rounded-xl border border-red-200 bg-red-50 p-6 text-center">
        <AlertTriangle className="mx-auto h-10 w-10 text-red-500 mb-3" />
        <h1 className="text-lg font-semibold text-foreground mb-2">Page failed to render</h1>
        <p className="text-sm text-muted-foreground mb-4">
          A runtime error interrupted rendering. Reload the page to recover.
        </p>
        <button
          type="button"
          onClick={() => window.location.reload()}
          className="inline-flex items-center justify-center rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:opacity-90 transition-opacity"
        >
          Reload page
        </button>
      </div>
    </div>
  );
};

const App: React.FC = () => {
  const accessToken = useAuthStore((state) => state.accessToken);
  const _hasHydrated = useAuthStore((state) => state._hasHydrated);
  const isLoading = useAuthStore((state) => state.isLoading);
  const isAuthenticated = useAuthStore((state) => state.isAuthenticated);
  const setAuth = useAuthStore((state) => state.setAuth);
  const logout = useAuthStore((state) => state.logout);
  const setLoading = useAuthStore((state) => state.setLoading);

  // Token validation and refresh on app startup
  useEffect(() => {
    // Wait for zustand to hydrate from localStorage
    if (!_hasHydrated) {
      return;
    }

    // Only validate once - if we're not loading anymore, validation already happened
    if (!isLoading) {
      return;
    }

    let cancelled = false;

    const validateAndRefreshToken = async () => {
      if (!accessToken) {
        setLoading(false);
        return;
      }

      // Get current tokenExpiresAt from store (not from closure to avoid stale values)
      const currentTokenExpiresAt = useAuthStore.getState().tokenExpiresAt;
      const isExpired = currentTokenExpiresAt ? Date.now() >= currentTokenExpiresAt : false;

      if (isExpired) {
        // Token is expired - use TokenManager to attempt silent refresh
        // NOTE: We don't check refreshToken from store because it's always null
        // (stored in httpOnly cookie for XSS protection). The cookie is sent
        // automatically with the refresh request.
        try {
          const success = await tokenManager.silentRefresh();
          if (!cancelled) {
            if (!success) {
              // Refresh failed - logout user
              logout();
            }
            // If success, silentRefresh already updated the store
          }
        } catch {
          if (!cancelled) {
            logout();
          }
        }
        return;
      }

      // Token not expired - validate with backend to ensure it's still valid
      try {
        const currentUser = await authApi.getMe();
        if (!cancelled) {
          // Preserve expiry when validating
          setAuth(
            currentUser,
            accessToken,
            undefined,
            currentTokenExpiresAt ? Math.floor((currentTokenExpiresAt - Date.now()) / 1000) : undefined
          );
        }
      } catch (error) {
        if (!cancelled) {
          if (axios.isAxiosError(error)) {
            const status = error.response?.status;
            if (status === 401 || status === 403) {
              logout();
              return;
            }
          }
          setLoading(false);
        }
      }
    };

    validateAndRefreshToken();

    return () => {
      cancelled = true;
    };
  }, [_hasHydrated, isLoading, accessToken, setAuth, logout, setLoading]);

  // Start/stop TokenManager based on authentication state
  useEffect(() => {
    if (!_hasHydrated) {
      return;
    }

    if (isAuthenticated) {
      tokenManager.start();
    } else {
      tokenManager.stop();
    }

    // Cleanup on unmount
    return () => {
      tokenManager.stop();
    };
  }, [_hasHydrated, isAuthenticated]);

  return (
    <ErrorBoundary fallback={<GlobalAppErrorFallback />}>
      <MotionConfig reducedMotion="always" transition={{ duration: 0, delay: 0 }}>
        <I18nProvider>
          <RouterProvider router={router} future={{ v7_startTransition: true }} />
          <ToastContainer />
        </I18nProvider>
      </MotionConfig>
    </ErrorBoundary>
  );
};

export default App;
