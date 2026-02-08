import { useState, useCallback, useRef } from 'react';
import { posesApi } from '../services/api';
import { useAppStore } from '../store/useAppStore';
import type { PoseListItem } from '../types';
import { useI18n } from '../i18n';

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
