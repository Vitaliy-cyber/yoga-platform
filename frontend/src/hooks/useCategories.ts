import { useState, useEffect, useRef, useCallback } from "react";
import { useAppStore } from "../store/useAppStore";
import { categoriesApi } from "../services/api";

export interface UseCategoriesReturn {
  isLoading: boolean;
  error: string | null;
  refetch: () => Promise<void>;
}

/**
 * Hook for fetching and managing categories data.
 * Uses AbortController for proper cleanup to prevent memory leaks.
 * Stores categories in the global app store to prevent duplicate API calls.
 * Includes staleness detection for multi-tab scenarios.
 *
 * @returns Object containing loading and error states, plus refetch function
 *
 * @example
 * ```tsx
 * const { isLoading, error, refetch } = useCategories();
 * const { categories } = useAppStore();
 *
 * if (isLoading) return <LoadingSpinner />;
 * if (error) return <ErrorMessage message={error} />;
 * return <CategoryList categories={categories} />;
 * ```
 */
export function useCategories(): UseCategoriesReturn {
  const { categories, setCategories, isCategoriesStale } = useAppStore();
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const isFetchingRef = useRef(false);
  const abortControllerRef = useRef<AbortController | null>(null);

  const fetchCategories = useCallback(async (signal?: AbortSignal) => {
    // Prevent duplicate requests
    if (isFetchingRef.current) {
      return;
    }

    isFetchingRef.current = true;
    setIsLoading(true);
    setError(null);

    try {
      const data = await categoriesApi.getAll(signal);

      // Only update state if not aborted
      if (!signal?.aborted) {
        setCategories(data);
        setIsLoading(false);
      }
    } catch (err) {
      // Ignore abort errors, they're expected during cleanup
      if (err instanceof Error && err.name === "AbortError") {
        // Still need to reset loading state and fetching ref
        setIsLoading(false);
        isFetchingRef.current = false;
        return;
      }

      // Only update state if not aborted
      if (!signal?.aborted) {
        const errorMessage = err instanceof Error ? err.message : "Failed to fetch categories";
        setError(errorMessage);
        setIsLoading(false);
        console.error("Failed to fetch categories:", err);
      }
    } finally {
      isFetchingRef.current = false;
    }
  }, [setCategories]);

  useEffect(() => {
    // Check if we need to fetch:
    // 1. No categories loaded yet
    // 2. OR data is stale (supports multi-tab scenarios)
    const needsFetch = categories.length === 0 || isCategoriesStale();

    if (!needsFetch) {
      return;
    }

    // Cancel previous request if any
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
    }

    const abortController = new AbortController();
    abortControllerRef.current = abortController;

    fetchCategories(abortController.signal);

    return () => {
      abortController.abort();
    };
  }, [categories.length, isCategoriesStale, fetchCategories]);

  // Also refetch when tab becomes visible and data is stale
  useEffect(() => {
    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible' && isCategoriesStale()) {
        // Cancel any in-flight request
        if (abortControllerRef.current) {
          abortControllerRef.current.abort();
        }
        const abortController = new AbortController();
        abortControllerRef.current = abortController;
        fetchCategories(abortController.signal);
      }
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);
    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, [isCategoriesStale, fetchCategories]);

  // Manual refetch function for components that need it
  const refetch = useCallback(async () => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
    }
    const abortController = new AbortController();
    abortControllerRef.current = abortController;
    await fetchCategories(abortController.signal);
  }, [fetchCategories]);

  return {
    isLoading,
    error,
    refetch,
  };
}
