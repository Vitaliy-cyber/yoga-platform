import React, { useEffect } from 'react';
import { createBrowserRouter, RouterProvider, Navigate, Outlet } from 'react-router-dom';
import { Layout } from './components/Layout';
import { Dashboard, PoseGallery, PoseDetail, Upload, Generate, Login } from './pages';
import { authApi } from './services/api';
import { useAuthStore } from './store/useAuthStore';
import { Loader2 } from 'lucide-react';
import { I18nProvider } from './i18n';

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
  const setAuth = useAuthStore((state) => state.setAuth);
  const logout = useAuthStore((state) => state.logout);
  const setLoading = useAuthStore((state) => state.setLoading);

  useEffect(() => {
    // Wait for zustand to hydrate from localStorage
    if (!_hasHydrated) {
      return;
    }

    let cancelled = false;

    const validateToken = async () => {
      if (!accessToken) {
        setLoading(false);
        return;
      }

      try {
        const currentUser = await authApi.getMe();
        if (!cancelled) {
          setAuth(currentUser, accessToken);
        }
      } catch {
        if (!cancelled) {
          logout();
        }
      }
    };

    validateToken();

    return () => {
      cancelled = true;
    };
  }, [_hasHydrated, accessToken, setAuth, logout, setLoading]);

  return (
    <I18nProvider>
      <RouterProvider router={router} future={{ v7_startTransition: true }} />
    </I18nProvider>
  );
};

export default App;
