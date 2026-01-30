import { useState, useEffect, useCallback, useRef } from "react";
import { useAppStore } from "../store/useAppStore";
import { useAuthStore } from "../store/useAuthStore";
import { categoriesApi } from "../services/api";

export interface UseCategoriesReturn {
  isLoading: boolean;
  error: string | null;
  refetch: () => Promise<void>;
}

/**
 * Hook for fetching and managing categories data.
 * Stores categories in the global app store.
 *
 * Handles React Strict Mode double-mount by using a ref to track
 * if a fetch is already in progress.
 */
export function useCategories(): UseCategoriesReturn {
  const { categories, setCategories, categoriesFetchedAt } = useAppStore();
  const { isAuthenticated } = useAuthStore();

  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Track if fetch is in progress to prevent double-fetches in Strict Mode
  const isFetchingRef = useRef(false);

  const fetchCategories = useCallback(async () => {
    // Prevent concurrent fetches
    if (isFetchingRef.current) {
      return;
    }

    isFetchingRef.current = true;
    setIsLoading(true);
    setError(null);

    try {
      const data = await categoriesApi.getAll();
      setCategories(data);
    } catch (err) {
      // Ignore abort errors
      if (err instanceof Error && err.name === "AbortError") {
        return;
      }
      const errorMessage =
        err instanceof Error ? err.message : "Failed to fetch categories";
      setError(errorMessage);
      console.error("Failed to fetch categories:", err);
    } finally {
      setIsLoading(false);
      isFetchingRef.current = false;
    }
  }, [setCategories]);

  // Fetch on mount if needed and authenticated
  useEffect(() => {
    // Don't fetch if not authenticated
    if (!isAuthenticated) {
      return;
    }

    // Check if we need to fetch
    const isStale = !categoriesFetchedAt || Date.now() - categoriesFetchedAt > 30000;
    const needsFetch = categories.length === 0 || isStale;

    if (needsFetch) {
      fetchCategories();
    }
  }, [categories.length, categoriesFetchedAt, fetchCategories, isAuthenticated]);

  // Refetch when tab becomes visible and data is stale
  useEffect(() => {
    const handleVisibilityChange = () => {
      if (!isAuthenticated) return;

      const isStale = !categoriesFetchedAt || Date.now() - categoriesFetchedAt > 30000;
      if (document.visibilityState === "visible" && isStale) {
        fetchCategories();
      }
    };

    document.addEventListener("visibilitychange", handleVisibilityChange);
    return () => {
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, [categoriesFetchedAt, fetchCategories, isAuthenticated]);

  return {
    isLoading,
    error,
    refetch: fetchCategories,
  };
}
