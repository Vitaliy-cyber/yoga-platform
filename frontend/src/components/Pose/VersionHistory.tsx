import React, { useEffect, useState, useRef, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { versionsApi } from '../../services/api';
import { Button } from '../ui/button';
import { Badge } from '../ui/badge';
import { Loader2, History, RotateCcw, GitCompare, Eye, ChevronDown, AlertCircle } from 'lucide-react';
import { useViewTransition } from '../../hooks/useViewTransition';
import type { PoseVersionListItem } from '../../types';
import { useI18n } from '../../i18n';

interface VersionHistoryProps {
  poseId: number;
  onViewVersion: (versionId: number) => void;
  onRestoreVersion: (versionId: number, versionNumber: number) => void;
  onCompareVersions: (v1: number, v2: number) => void;
  /**
   * Optional key to trigger a refresh of the version list.
   * Increment this value when you need to force a refetch
   * (e.g., after a restore operation).
   */
  refreshKey?: number;
}

export const VersionHistory: React.FC<VersionHistoryProps> = ({
  poseId,
  onViewVersion,
  onRestoreVersion,
  onCompareVersions,
  refreshKey = 0,
}) => {
  const { t } = useI18n();
  const { startTransition } = useViewTransition();
  const [versions, setVersions] = useState<PoseVersionListItem[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedForCompare, setSelectedForCompare] = useState<number[]>([]);
  const [isExpanded, setIsExpanded] = useState(true);

  // Ref to track AbortController for cancelling pending requests
  const abortControllerRef = useRef<AbortController | null>(null);

  const loadVersions = useCallback(async (signal?: AbortSignal) => {
    setIsLoading(true);
    setError(null);
    try {
      const data = await versionsApi.list(poseId, 0, 50, signal);
      // Only update state if the request wasn't aborted
      if (!signal?.aborted) {
        setVersions(data);
      }
    } catch (err) {
      // Ignore abort errors
      if (err instanceof Error && err.name === 'AbortError') {
        return;
      }
      if (!signal?.aborted) {
        setError(err instanceof Error ? err.message : t('versions.error_loading'));
      }
    } finally {
      if (!signal?.aborted) {
        setIsLoading(false);
      }
    }
  }, [poseId, t]);

  useEffect(() => {
    // Cancel any pending request when poseId or refreshKey changes
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
    }

    // Create a new AbortController for this request
    const abortController = new AbortController();
    abortControllerRef.current = abortController;

    loadVersions(abortController.signal);

    // Cleanup: cancel pending request on unmount or when dependencies change
    return () => {
      abortController.abort();
    };
  }, [poseId, refreshKey, loadVersions]);

  // Manual reload function for retry button (creates new AbortController)
  const handleRetry = useCallback(() => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
    }
    const abortController = new AbortController();
    abortControllerRef.current = abortController;
    loadVersions(abortController.signal);
  }, [loadVersions]);

  const formatDate = (dateString: string) => {
    const date = new Date(dateString);
    return date.toLocaleDateString(undefined, {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  };

  const toggleCompareSelection = (versionId: number) => {
    setSelectedForCompare(prev => {
      // Verify the version still exists in the current list
      const versionExists = versions.some(v => v.id === versionId);
      if (!versionExists) {
        // Version was deleted, don't add it
        return prev;
      }

      if (prev.includes(versionId)) {
        return prev.filter(id => id !== versionId);
      }
      // Max 2 versions for comparison
      if (prev.length >= 2) {
        return [prev[1], versionId];
      }
      return [...prev, versionId];
    });
  };

  // Clean up selected versions when the versions list changes
  // This handles the case where a selected version was deleted
  React.useEffect(() => {
    setSelectedForCompare(prev => {
      const validSelections = prev.filter(id =>
        versions.some(v => v.id === id)
      );
      // Only update if something changed to avoid unnecessary re-renders
      if (validSelections.length !== prev.length) {
        return validSelections;
      }
      return prev;
    });
  }, [versions]);

  const handleCompare = () => {
    if (selectedForCompare.length !== 2) {
      return;
    }

    // Verify both selected versions still exist in the current list
    const validVersions = selectedForCompare.filter(id =>
      versions.some(v => v.id === id)
    );

    if (validVersions.length !== 2) {
      // One or both versions were deleted, clear selection
      setSelectedForCompare(validVersions);
      return;
    }

    // Sort so older version is first
    const [v1, v2] = validVersions.sort((a, b) => {
      const ver1 = versions.find(v => v.id === a);
      const ver2 = versions.find(v => v.id === b);
      return (ver1?.version_number || 0) - (ver2?.version_number || 0);
    });
    onCompareVersions(v1, v2);
  };

  if (isLoading) {
    return (
      <div className="bg-card rounded-2xl border border-border p-6">
        <div className="flex items-center gap-3 mb-4">
          <History className="w-5 h-5 text-muted-foreground" />
          <h3 className="text-lg font-medium text-foreground">{t('versions.title')}</h3>
        </div>
        <div className="flex items-center justify-center py-8">
          <Loader2 className="w-6 h-6 text-muted-foreground animate-spin" />
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="bg-card rounded-2xl border border-border p-6">
        <div className="flex items-center gap-3 mb-4">
          <History className="w-5 h-5 text-muted-foreground" />
          <h3 className="text-lg font-medium text-foreground">{t('versions.title')}</h3>
        </div>
        <div className="flex items-center gap-2 text-red-600 py-4">
          <AlertCircle className="w-5 h-5" />
          <span>{error}</span>
        </div>
        <Button variant="outline" size="sm" onClick={handleRetry}>
          {t('versions.retry')}
        </Button>
      </div>
    );
  }

  return (
    <div className="bg-card rounded-2xl border border-border overflow-hidden">
      <button
        onClick={() => startTransition(() => setIsExpanded(!isExpanded))}
        className="w-full flex items-center justify-between p-4 hover:bg-accent transition-colors"
      >
        <div className="flex items-center gap-3">
          <History className="w-5 h-5 text-muted-foreground" />
          <h3 className="text-lg font-medium text-foreground">{t('versions.title')}</h3>
          <Badge variant="secondary" className="bg-muted">
            {versions.length}
          </Badge>
        </div>
        <motion.div
          animate={{ rotate: isExpanded ? 180 : 0 }}
          transition={{ duration: 0.2 }}
        >
          <ChevronDown className="w-5 h-5 text-muted-foreground" />
        </motion.div>
      </button>

      <AnimatePresence>
        {isExpanded && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="border-t border-border/50 overflow-hidden"
          >
          {/* Compare action bar */}
          {selectedForCompare.length > 0 && (
            <div className="px-4 py-3 bg-blue-50 border-b border-blue-100 flex items-center justify-between">
              <span className="text-sm text-blue-700">
                {t('versions.compare_selected', { count: selectedForCompare.length.toString() })}
              </span>
              <div className="flex gap-2">
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setSelectedForCompare([])}
                  className="text-blue-700"
                >
                  {t('versions.clear_selection')}
                </Button>
                <Button
                  size="sm"
                  onClick={handleCompare}
                  disabled={selectedForCompare.length !== 2}
                  className="bg-blue-600 hover:bg-blue-700"
                >
                  <GitCompare className="w-4 h-4 mr-1" />
                  {t('versions.compare')}
                </Button>
              </div>
            </div>
          )}

          {versions.length === 0 ? (
            <div className="px-4 py-8 text-center text-muted-foreground">
              <History className="w-8 h-8 mx-auto mb-2 opacity-50" />
              <p>{t('versions.no_history')}</p>
              <p className="text-sm mt-1">{t('versions.no_history_hint')}</p>
            </div>
          ) : (
            <div className="divide-y divide-stone-100 max-h-96 overflow-y-auto">
              {versions.map((version, index) => (
                <div
                  key={version.id}
                  className={`px-4 py-3 hover:bg-accent transition-colors ${
                    selectedForCompare.includes(version.id) ? 'bg-blue-50' : ''
                  }`}
                >
                  <div className="flex items-start justify-between gap-4">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-1">
                        <span className="font-medium text-foreground">
                          v{version.version_number}
                        </span>
                        {index === 0 && (
                          <Badge className="bg-emerald-100 text-emerald-700 text-xs">
                            {t('versions.current')}
                          </Badge>
                        )}
                      </div>
                      <p className="text-sm text-muted-foreground">
                        {formatDate(version.created_at)}
                        {version.changed_by_name && (
                          <span className="ml-2">
                            {t('versions.by')} {version.changed_by_name}
                          </span>
                        )}
                      </p>
                      {version.change_note && (
                        <p className="text-sm text-muted-foreground mt-1 truncate">
                          {version.change_note}
                        </p>
                      )}
                    </div>

                    <div className="flex items-center gap-1">
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => toggleCompareSelection(version.id)}
                        className={`p-2 ${
                          selectedForCompare.includes(version.id)
                            ? 'text-blue-600 bg-blue-100'
                            : 'text-muted-foreground hover:text-muted-foreground'
                        }`}
                        title={t('versions.select_for_compare')}
                      >
                        <GitCompare className="w-4 h-4" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => onViewVersion(version.id)}
                        className="p-2 text-muted-foreground hover:text-muted-foreground"
                        title={t('versions.view')}
                      >
                        <Eye className="w-4 h-4" />
                      </Button>
                      {index > 0 && (
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => onRestoreVersion(version.id, version.version_number)}
                          className="p-2 text-muted-foreground hover:text-amber-600"
                          title={t('versions.restore')}
                        >
                          <RotateCcw className="w-4 h-4" />
                        </Button>
                      )}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </motion.div>
      )}
      </AnimatePresence>
    </div>
  );
};
