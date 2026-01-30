import React, { useEffect } from 'react';
import axios from 'axios';
import { createBrowserRouter, RouterProvider, Navigate, Outlet } from 'react-router-dom';
import { Layout } from './components/Layout';
import { Dashboard, PoseGallery, PoseDetail, Upload, Generate, Login, ComparePage, AnalyticsDashboard, SequenceListPage, SequenceNew, SequenceDetail, Settings } from './pages';
import { authApi, tokenManager } from './services/api';
import { useAuthStore } from './store/useAuthStore';
import { Loader2 } from 'lucide-react';
import { I18nProvider } from './i18n';
import { ToastContainer } from './components/ui/toast';

// Protected route wrapper - redirects to login if not authenticated
const ProtectedRoute: React.FC = () => {
  const { isAuthenticated, isLoading } = useAuthStore();

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-stone-50">
        <Loader2 className="w-8 h-8 text-stone-400 animate-spin" />
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
      <div className="min-h-screen flex items-center justify-center bg-stone-50">
        <Loader2 className="w-8 h-8 text-stone-400 animate-spin" />
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
    <I18nProvider>
      <RouterProvider router={router} future={{ v7_startTransition: true }} />
      <ToastContainer />
    </I18nProvider>
  );
};

export default App;
