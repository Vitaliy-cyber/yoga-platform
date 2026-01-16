import { useState, useEffect, useCallback } from 'react';
import { posesApi } from '../services/api';
import { useAppStore } from '../store/useAppStore';
import type { Pose, PoseListItem } from '../types';
import { useI18n } from '../i18n';

export function usePoses(categoryId?: number) {
  const { poses, setPoses, setIsLoading, addToast } = useAppStore();
  const [error, setError] = useState<string | null>(null);
  const { t } = useI18n();

  const fetchPoses = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const data = await posesApi.getAll(categoryId);
      setPoses(data);
    } catch (err) {
      const message = err instanceof Error ? err.message : t("poses.error_fetch");
      setError(message);
      addToast({ type: 'error', message });
    } finally {
      setIsLoading(false);
    }
  }, [categoryId, setPoses, setIsLoading, addToast, t]);

  useEffect(() => {
    fetchPoses();
  }, [fetchPoses]);

  return { poses, error, refetch: fetchPoses };
}

export function usePose(id: number | null) {
  const [pose, setPose] = useState<Pose | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { addToast } = useAppStore();
  const { t } = useI18n();

  const fetchPose = useCallback(async () => {
    if (id === null) return;

    setIsLoading(true);
    setError(null);
    try {
      const data = await posesApi.getById(id);
      setPose(data);
    } catch (err) {
      const message = err instanceof Error ? err.message : t("poses.error_fetch_single");
      setError(message);
      addToast({ type: 'error', message });
    } finally {
      setIsLoading(false);
    }
  }, [id, addToast, t]);

  useEffect(() => {
    fetchPose();
  }, [fetchPose]);

  return { pose, isLoading, error, refetch: fetchPose };
}

export function useSearchPoses() {
  const [results, setResults] = useState<PoseListItem[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const { addToast } = useAppStore();
  const { t } = useI18n();

  const search = useCallback(async (query: string) => {
    if (!query.trim()) {
      setResults([]);
      return;
    }

    setIsSearching(true);
    try {
      const data = await posesApi.search(query);
      setResults(data);
    } catch (err) {
      const message = err instanceof Error ? err.message : t("poses.error_search");
      addToast({ type: 'error', message });
      setResults([]);
    } finally {
      setIsSearching(false);
    }
  }, [addToast, t]);

  return { results, isSearching, search };
}
