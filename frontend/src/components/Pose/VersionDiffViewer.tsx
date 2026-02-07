import React, { useEffect, useState, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { versionsApi } from '../../services/api';
import { Button } from '../ui/button';
import { Badge } from '../ui/badge';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '../ui/dialog';
import { Loader2, ArrowRight, Plus, Minus, RefreshCw, X, Image as ImageIcon } from 'lucide-react';
import type { VersionComparisonResult, VersionDiff } from '../../types';
import { useI18n } from '../../i18n';

interface VersionDiffViewerProps {
  poseId: number;
  versionId1: number;
  versionId2: number;
  isOpen: boolean;
  onClose: () => void;
}

export const VersionDiffViewer: React.FC<VersionDiffViewerProps> = ({
  poseId,
  versionId1,
  versionId2,
  isOpen,
  onClose,
}) => {
  const { t } = useI18n();
  const [comparison, setComparison] = useState<VersionComparisonResult | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const loadComparison = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const data = await versionsApi.diff(poseId, versionId1, versionId2);
      setComparison(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : t('versions.diff_error'));
    } finally {
      setIsLoading(false);
    }
  }, [poseId, versionId1, versionId2, t]);

  useEffect(() => {
    if (isOpen) {
      loadComparison();
    }
  }, [isOpen, loadComparison]);

  const formatDate = (dateString: string | null) => {
    if (!dateString) return '-';
    const date = new Date(dateString);
    return date.toLocaleDateString(undefined, {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  };

  const getFieldLabel = (field: string): string => {
    const labels: Record<string, string> = {
      name: t('versions.field.name'),
      name_en: t('versions.field.name_en'),
      code: t('versions.field.code'),
      category_id: t('versions.field.category'),
      description: t('versions.field.description'),
      effect: t('versions.field.effect'),
      breathing: t('versions.field.breathing'),
      schema_path: t('versions.field.schema'),
      photo_path: t('versions.field.photo'),
      muscle_layer_path: t('versions.field.muscle_layer'),
      skeleton_layer_path: t('versions.field.skeleton_layer'),
      muscles: t('versions.field.muscles'),
    };
    return labels[field] || field;
  };

  const formatValue = (value: unknown): string => {
    // Handle null/undefined
    if (value === null || value === undefined) {
      return t('versions.value.empty');
    }

    // Handle strings with truncation for long content
    if (typeof value === 'string') {
      const maxLength = 100;
      if (value.length === 0) {
        return t('versions.value.empty');
      }
      if (value.length > maxLength) {
        return value.substring(0, maxLength) + '...';
      }
      return value;
    }

    // Handle numbers (including NaN and Infinity)
    if (typeof value === 'number') {
      if (Number.isNaN(value)) {
        return 'NaN';
      }
      if (!Number.isFinite(value)) {
        return value > 0 ? 'Infinity' : '-Infinity';
      }
      return String(value);
    }

    // Handle booleans
    if (typeof value === 'boolean') {
      return value ? 'true' : 'false';
    }

    // Handle arrays with item count
    if (Array.isArray(value)) {
      return `[${value.length} ${t('versions.value.items')}]`;
    }

    // Handle objects (Date, etc.)
    if (typeof value === 'object') {
      // Handle Date objects
      if (value instanceof Date) {
        return value.toISOString();
      }

      // For other objects, try to stringify with truncation
      try {
        const jsonStr = JSON.stringify(value);
        const maxJsonLength = 200;
        if (jsonStr.length > maxJsonLength) {
          return jsonStr.substring(0, maxJsonLength) + '...';
        }
        return jsonStr;
      } catch {
        // Circular reference or other JSON.stringify error
        return '[Object]';
      }
    }

    // Handle functions (shouldn't happen but be safe)
    if (typeof value === 'function') {
      return '[Function]';
    }

    // Handle symbols
    if (typeof value === 'symbol') {
      return value.toString();
    }

    // Handle bigint
    if (typeof value === 'bigint') {
      return value.toString();
    }

    // Fallback for any unknown types
    return String(value);
  };

  const isImageField = (field: string): boolean => {
    return ['schema_path', 'photo_path', 'muscle_layer_path', 'skeleton_layer_path'].includes(field);
  };

  const renderDiff = (diff: VersionDiff) => {
    const { field, old_value, new_value, changes } = diff;

    // Special handling for muscles field
    if (field === 'muscles' && changes) {
      return (
        <div key={field} className="border border-border rounded-lg overflow-hidden">
          <div className="px-4 py-2 bg-muted border-b border-border">
            <span className="font-medium text-foreground">{getFieldLabel(field)}</span>
          </div>
          <div className="divide-y divide-border/50">
            {changes.map((change, index) => (
              <div
                key={index}
                className={`px-4 py-2 flex items-center gap-3 ${
                  change.type === 'added'
                    ? 'bg-emerald-50 dark:bg-emerald-900/30'
                    : change.type === 'removed'
                    ? 'bg-red-50 dark:bg-red-900/30'
                    : 'bg-amber-50 dark:bg-amber-900/30'
                }`}
              >
                {change.type === 'added' && (
                  <Plus className="w-4 h-4 text-emerald-600 flex-shrink-0" />
                )}
                {change.type === 'removed' && (
                  <Minus className="w-4 h-4 text-red-600 flex-shrink-0" />
                )}
                {change.type === 'changed' && (
                  <RefreshCw className="w-4 h-4 text-amber-600 flex-shrink-0" />
                )}
                <span className="text-sm text-foreground flex-1">
                  {change.muscle_name || `Muscle #${change.muscle_id}`}
                </span>
                {change.type === 'added' && (
                  <Badge className="bg-emerald-100 dark:bg-emerald-900/50 text-emerald-700 dark:text-emerald-400">
                    {change.new_activation}%
                  </Badge>
                )}
                {change.type === 'removed' && (
                  <Badge className="bg-red-100 dark:bg-red-900/50 text-red-700 dark:text-red-400">
                    {change.old_activation}%
                  </Badge>
                )}
                {change.type === 'changed' && (
                  <div className="flex items-center gap-1">
                    <Badge className="bg-muted text-muted-foreground">
                      {change.old_activation}%
                    </Badge>
                    <ArrowRight className="w-3 h-3 text-muted-foreground" />
                    <Badge className="bg-amber-100 dark:bg-amber-900/50 text-amber-700 dark:text-amber-400">
                      {change.new_activation}%
                    </Badge>
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      );
    }

    // Image fields
    if (isImageField(field)) {
      const hasOld = old_value && typeof old_value === 'string';
      const hasNew = new_value && typeof new_value === 'string';

      return (
        <div key={field} className="border border-border rounded-lg overflow-hidden">
          <div className="px-4 py-2 bg-muted border-b border-border">
            <span className="font-medium text-foreground">{getFieldLabel(field)}</span>
          </div>
          <div className="p-4 grid grid-cols-2 gap-4">
            <div>
              <p className="text-xs text-muted-foreground mb-2">{t('versions.before')}</p>
              {hasOld ? (
                <div className="flex items-center gap-2 text-sm text-muted-foreground">
                  <ImageIcon className="w-4 h-4" />
                  <span className="truncate">{t('versions.image_present')}</span>
                </div>
              ) : (
                <span className="text-sm text-muted-foreground">{t('versions.value.empty')}</span>
              )}
            </div>
            <div>
              <p className="text-xs text-muted-foreground mb-2">{t('versions.after')}</p>
              {hasNew ? (
                <div className="flex items-center gap-2 text-sm text-muted-foreground">
                  <ImageIcon className="w-4 h-4" />
                  <span className="truncate">{t('versions.image_present')}</span>
                </div>
              ) : (
                <span className="text-sm text-muted-foreground">{t('versions.value.empty')}</span>
              )}
            </div>
          </div>
        </div>
      );
    }

    // Regular fields
    return (
      <div key={field} className="border border-border rounded-lg overflow-hidden">
        <div className="px-4 py-2 bg-muted border-b border-border">
          <span className="font-medium text-foreground">{getFieldLabel(field)}</span>
        </div>
        <div className="p-4 grid grid-cols-2 gap-4">
          <div>
            <p className="text-xs text-muted-foreground mb-1">{t('versions.before')}</p>
            <p className="text-sm text-muted-foreground bg-red-50 dark:bg-red-900/30 px-2 py-1 rounded">
              {formatValue(old_value)}
            </p>
          </div>
          <div>
            <p className="text-xs text-muted-foreground mb-1">{t('versions.after')}</p>
            <p className="text-sm text-muted-foreground bg-emerald-50 dark:bg-emerald-900/30 px-2 py-1 rounded">
              {formatValue(new_value)}
            </p>
          </div>
        </div>
      </div>
    );
  };

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-2xl max-h-[80vh] overflow-hidden flex flex-col">
        <DialogHeader>
          <DialogTitle className="flex items-center justify-between">
            <span>{t('versions.compare_title')}</span>
            <Button variant="ghost" size="sm" onClick={onClose} className="p-2">
              <X className="w-4 h-4" />
            </Button>
          </DialogTitle>
        </DialogHeader>

        <div className="flex-1 overflow-y-auto">
          <AnimatePresence mode="wait">
            {isLoading ? (
              <motion.div
                key="loading"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                className="flex items-center justify-center py-12"
              >
                <Loader2 className="w-8 h-8 text-muted-foreground animate-spin" />
              </motion.div>
            ) : error ? (
              <motion.div
                key="error"
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0 }}
                className="text-center py-12"
              >
                <p className="text-red-600 dark:text-red-400 mb-4">{error}</p>
                <Button variant="outline" onClick={loadComparison}>
                  {t('versions.retry')}
                </Button>
              </motion.div>
            ) : comparison ? (
              <motion.div
                key="content"
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.2 }}
                className="space-y-6 pb-4"
              >
              {/* Version headers */}
              <div className="grid grid-cols-2 gap-4">
                <div className="bg-muted rounded-lg p-4">
                  <div className="flex items-center gap-2 mb-2">
                    <Badge variant="outline">v{comparison.version_1.version_number}</Badge>
                    <span className="text-xs text-muted-foreground">{t('versions.older')}</span>
                  </div>
                  <p className="text-sm text-muted-foreground">
                    {formatDate(comparison.version_1.created_at)}
                  </p>
                  {comparison.version_1.change_note && (
                    <p className="text-xs text-muted-foreground mt-1 truncate">
                      {comparison.version_1.change_note}
                    </p>
                  )}
                </div>
                <div className="bg-muted rounded-lg p-4">
                  <div className="flex items-center gap-2 mb-2">
                    <Badge variant="outline">v{comparison.version_2.version_number}</Badge>
                    <span className="text-xs text-muted-foreground">{t('versions.newer')}</span>
                  </div>
                  <p className="text-sm text-muted-foreground">
                    {formatDate(comparison.version_2.created_at)}
                  </p>
                  {comparison.version_2.change_note && (
                    <p className="text-xs text-muted-foreground mt-1 truncate">
                      {comparison.version_2.change_note}
                    </p>
                  )}
                </div>
              </div>

              {/* Differences */}
              {comparison.differences.length === 0 ? (
                <div className="text-center py-8 text-muted-foreground">
                  <p>{t('versions.no_differences')}</p>
                </div>
              ) : (
                <div className="space-y-4">
                  <h4 className="font-medium text-foreground">
                    {t('versions.changes_count', { count: comparison.differences.length.toString() })}
                  </h4>
                  {comparison.differences.map(renderDiff)}
                </div>
              )}
            </motion.div>
            ) : null}
          </AnimatePresence>
        </div>
      </DialogContent>
    </Dialog>
  );
};
