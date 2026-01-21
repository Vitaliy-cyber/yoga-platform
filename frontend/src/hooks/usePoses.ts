import { useState, useEffect, useCallback, useRef } from 'react';
import { posesApi } from '../services/api';
import { useAppStore } from '../store/useAppStore';
import type { Pose, PoseListItem } from '../types';
import { useI18n } from '../i18n';

export function usePoses(categoryId?: number) {
  const { poses, setPoses, setIsLoading, addToast } = useAppStore();
  const [error, setError] = useState<string | null>(null);
  const { t } = useI18n();
  const abortControllerRef = useRef<AbortController | null>(null);

  useEffect(() => {
    // Cancel previous request when categoryId changes
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
    }

    const abortController = new AbortController();
    abortControllerRef.current = abortController;

    const fetchPoses = async () => {
      setIsLoading(true);
      setError(null);
      try {
        const data = await posesApi.getAll(categoryId);
        // Only update state if not aborted
        if (!abortController.signal.aborted) {
          setPoses(data);
        }
      } catch (err) {
        // Ignore abort errors
        if (err instanceof Error && err.name === 'AbortError') {
          return;
        }
        if (!abortController.signal.aborted) {
          const message = err instanceof Error ? err.message : t("poses.error_fetch");
          setError(message);
          addToast({ type: 'error', message });
        }
      } finally {
        if (!abortController.signal.aborted) {
          setIsLoading(false);
        }
      }
    };

    fetchPoses();

    return () => {
      abortController.abort();
    };
  }, [categoryId, setPoses, setIsLoading, addToast, t]);

  const refetch = useCallback(async () => {
    // Cancel previous request
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
    }

    const abortController = new AbortController();
    abortControllerRef.current = abortController;

    setIsLoading(true);
    setError(null);
    try {
      const data = await posesApi.getAll(categoryId);
      if (!abortController.signal.aborted) {
        setPoses(data);
      }
    } catch (err) {
      if (err instanceof Error && err.name === 'AbortError') {
        return;
      }
      if (!abortController.signal.aborted) {
        const message = err instanceof Error ? err.message : t("poses.error_fetch");
        setError(message);
        addToast({ type: 'error', message });
      }
    } finally {
      if (!abortController.signal.aborted) {
        setIsLoading(false);
      }
    }
  }, [categoryId, setPoses, setIsLoading, addToast, t]);

  return { poses, error, refetch };
}

export function usePose(id: number | null) {
  const [pose, setPose] = useState<Pose | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { addToast } = useAppStore();
  const { t } = useI18n();
  const abortControllerRef = useRef<AbortController | null>(null);

  useEffect(() => {
    if (id === null) {
      setPose(null);
      return;
    }

    // Cancel previous request when id changes
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
    }

    const abortController = new AbortController();
    abortControllerRef.current = abortController;

    const fetchPose = async () => {
      setIsLoading(true);
      setError(null);
      try {
        const data = await posesApi.getById(id);
        if (!abortController.signal.aborted) {
          setPose(data);
        }
      } catch (err) {
        // Ignore abort errors
        if (err instanceof Error && err.name === 'AbortError') {
          return;
        }
        if (!abortController.signal.aborted) {
          const message = err instanceof Error ? err.message : t("poses.error_fetch_single");
          setError(message);
          addToast({ type: 'error', message });
        }
      } finally {
        if (!abortController.signal.aborted) {
          setIsLoading(false);
        }
      }
    };

    fetchPose();

    return () => {
      abortController.abort();
    };
  }, [id, addToast, t]);

  const refetch = useCallback(async () => {
    if (id === null) return;

    // Cancel previous request
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
    }

    const abortController = new AbortController();
    abortControllerRef.current = abortController;

    setIsLoading(true);
    setError(null);
    try {
      const data = await posesApi.getById(id);
      if (!abortController.signal.aborted) {
        setPose(data);
      }
    } catch (err) {
      if (err instanceof Error && err.name === 'AbortError') {
        return;
      }
      if (!abortController.signal.aborted) {
        const message = err instanceof Error ? err.message : t("poses.error_fetch_single");
        setError(message);
        addToast({ type: 'error', message });
      }
    } finally {
      if (!abortController.signal.aborted) {
        setIsLoading(false);
      }
    }
  }, [id, addToast, t]);

  return { pose, isLoading, error, refetch };
}

export function useSearchPoses() {
  const [results, setResults] = useState<PoseListItem[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const { addToast } = useAppStore();
  const { t } = useI18n();
  // Track request ID to ensure only latest result is used (race condition fix)
  const latestRequestRef = useRef(0);

  const search = useCallback(async (query: string) => {
    if (!query.trim()) {
      setResults([]);
      return;
    }

    // Increment request ID and capture current request
    const currentRequest = ++latestRequestRef.current;

    setIsSearching(true);
    try {
      const data = await posesApi.search(query);
      // Only update state if this is still the latest request
      if (currentRequest === latestRequestRef.current) {
        setResults(data);
      }
    } catch (err) {
      // Only update state if this is still the latest request
      if (currentRequest === latestRequestRef.current) {
        const message = err instanceof Error ? err.message : t("poses.error_search");
        addToast({ type: 'error', message });
        setResults([]);
      }
    } finally {
      // Only update isSearching if this is still the latest request
      if (currentRequest === latestRequestRef.current) {
        setIsSearching(false);
      }
    }
  }, [addToast, t]);

  return { results, isSearching, search };
}
