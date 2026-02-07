import { useState, useEffect, useCallback, useRef } from "react";
import { useAppStore } from "../store/useAppStore";
import { useAuthStore } from "../store/useAuthStore";
import { categoriesApi, isAbortRequestError } from "../services/api";

export interface UseCategoriesReturn {
  isLoading: boolean;
  error: string | null;
  refetch: () => Promise<void>;
}

/**
 * Hook for fetching and managing categories data.
 * Stores categories in the global app store.
 *
 * Handles React Strict Mode and visibility refetches by canceling stale requests.
 */
export function useCategories(): UseCategoriesReturn {
  const { setCategories, categoriesFetchedAt } = useAppStore();
  const { isAuthenticated } = useAuthStore();

  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const abortControllerRef = useRef<AbortController | null>(null);

  const fetchCategories = useCallback(async () => {
    // Cancel any in-flight request before starting a new one.
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
    }

    const abortController = new AbortController();
    abortControllerRef.current = abortController;

    setIsLoading(true);
    setError(null);

    try {
      const data = await categoriesApi.getAll(abortController.signal);
      if (!abortController.signal.aborted) {
        setCategories(data);
      }
    } catch (err) {
      // Ignore abort errors
      if (isAbortRequestError(err)) {
        return;
      }

      const errorMessage =
        err instanceof Error
          ? err.message === "Network Error"
            ? "Network error. Please check your connection and try again."
            : err.message
          : "Failed to fetch categories";
      if (!abortController.signal.aborted) {
        setError(errorMessage);
        console.error("Failed to fetch categories:", err);
      }
    } finally {
      // Ignore stale completion from older aborted request.
      if (abortControllerRef.current === abortController) {
        setIsLoading(false);
      }
    }
  }, [setCategories]);

  // Fetch on mount if needed and authenticated
  useEffect(() => {
    // Don't fetch if not authenticated
    if (!isAuthenticated) {
      return;
    }

    // Check if we need to fetch. Note: an empty categories list can be a valid,
    // stable state (e.g. brand-new user). Do not refetch just because length===0.
    const isStale = !categoriesFetchedAt || Date.now() - categoriesFetchedAt > 30000;
    const needsFetch = !categoriesFetchedAt || isStale;

    if (needsFetch) {
      void fetchCategories();
    }
  }, [categoriesFetchedAt, fetchCategories, isAuthenticated]);

  // Refetch when tab becomes visible and data is stale
  useEffect(() => {
    const handleVisibilityChange = () => {
      if (!isAuthenticated) return;

      const isStale = !categoriesFetchedAt || Date.now() - categoriesFetchedAt > 30000;
      if (document.visibilityState === "visible" && isStale) {
        void fetchCategories();
      }
    };

    document.addEventListener("visibilitychange", handleVisibilityChange);

    const handleOnline = () => {
      if (!isAuthenticated) return;
      void fetchCategories();
    };
    window.addEventListener("online", handleOnline);

    return () => {
      document.removeEventListener("visibilitychange", handleVisibilityChange);
      window.removeEventListener("online", handleOnline);
      if (abortControllerRef.current) {
        abortControllerRef.current.abort();
      }
    };
  }, [categoriesFetchedAt, fetchCategories, isAuthenticated]);

  return {
    isLoading,
    error,
    refetch: fetchCategories,
  };
}
