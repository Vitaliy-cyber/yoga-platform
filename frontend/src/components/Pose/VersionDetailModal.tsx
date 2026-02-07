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
import { Loader2, X, User, Calendar, FileText, Image as ImageIcon } from 'lucide-react';
import type { PoseVersionDetail } from '../../types';
import { useI18n } from '../../i18n';
import { fadeIn, fadeSlideUpSmall, normalTransition } from '../../lib/animation-variants';

interface VersionDetailModalProps {
  poseId: number;
  versionId: number;
  isOpen: boolean;
  onClose: () => void;
  onRestore?: (versionId: number, versionNumber: number) => void;
}

export const VersionDetailModal: React.FC<VersionDetailModalProps> = ({
  poseId,
  versionId,
  isOpen,
  onClose,
  onRestore,
}) => {
  const { t } = useI18n();
  const [version, setVersion] = useState<PoseVersionDetail | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const loadVersion = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const data = await versionsApi.get(poseId, versionId);
      setVersion(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : t('versions.error_loading'));
    } finally {
      setIsLoading(false);
    }
  }, [poseId, versionId, t]);

  useEffect(() => {
    if (isOpen) {
      loadVersion();
    }
  }, [isOpen, loadVersion]);

  const formatDate = (dateString: string) => {
    const date = new Date(dateString);
    return date.toLocaleDateString(undefined, {
      year: 'numeric',
      month: 'long',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  };

  const getActivationColor = (level: number): string => {
    if (level >= 70) return 'bg-red-100 text-red-700 dark:bg-red-950 dark:text-red-400';
    if (level >= 40) return 'bg-amber-100 text-amber-700 dark:bg-amber-950 dark:text-amber-400';
    return 'bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-400';
  };

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-2xl max-h-[80vh] overflow-hidden flex flex-col">
        <DialogHeader>
          <DialogTitle className="flex items-center justify-between">
            <span>{t('versions.detail_title')}</span>
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
                variants={fadeIn}
                initial="initial"
                animate="animate"
                exit="exit"
                className="flex items-center justify-center py-12"
              >
                <Loader2 className="w-8 h-8 text-muted-foreground animate-spin" />
              </motion.div>
            ) : error ? (
              <motion.div
                key="error"
                variants={fadeSlideUpSmall}
                initial="initial"
                animate="animate"
                exit="exit"
                className="text-center py-12"
              >
                <p className="text-red-600 mb-4">{error}</p>
                <Button variant="outline" onClick={loadVersion}>
                  {t('versions.retry')}
                </Button>
              </motion.div>
            ) : version ? (
              <motion.div
                key="content"
                variants={fadeSlideUpSmall}
                initial="initial"
                animate="animate"
                exit="exit"
                transition={normalTransition}
                className="space-y-6 pb-4"
              >
              {/* Version header */}
              <div className="bg-muted rounded-lg p-4">
                <div className="flex items-center justify-between mb-3">
                  <div className="flex items-center gap-2">
                    <Badge className="bg-primary text-primary-foreground">
                      v{version.version_number}
                    </Badge>
                    <span className="font-medium text-foreground">{version.name}</span>
                  </div>
                  {onRestore && (
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => onRestore(version.id, version.version_number)}
                      className="text-amber-600 border-amber-300 hover:bg-amber-50 dark:hover:bg-amber-950"
                    >
                      {t('versions.restore')}
                    </Button>
                  )}
                </div>

                <div className="grid grid-cols-2 gap-4 text-sm">
                  <div className="flex items-center gap-2 text-muted-foreground">
                    <Calendar className="w-4 h-4" />
                    <span>{formatDate(version.created_at)}</span>
                  </div>
                  {version.changed_by_name && (
                    <div className="flex items-center gap-2 text-muted-foreground">
                      <User className="w-4 h-4" />
                      <span>{version.changed_by_name}</span>
                    </div>
                  )}
                </div>

                {version.change_note && (
                  <div className="mt-3 pt-3 border-t border-border">
                    <div className="flex items-start gap-2 text-muted-foreground">
                      <FileText className="w-4 h-4 mt-0.5" />
                      <p className="text-sm">{version.change_note}</p>
                    </div>
                  </div>
                )}
              </div>

              {/* Pose data */}
              <div className="space-y-4">
                <h4 className="font-medium text-foreground">{t('versions.snapshot_data')}</h4>

                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="text-xs text-muted-foreground">{t('versions.field.code')}</label>
                    <p className="text-sm text-foreground">{version.code}</p>
                  </div>
                  <div>
                    <label className="text-xs text-muted-foreground">{t('versions.field.name_en')}</label>
                    <p className="text-sm text-foreground">{version.name_en || '-'}</p>
                  </div>
                </div>

                {version.description && (
                  <div>
                    <label className="text-xs text-muted-foreground">{t('versions.field.description')}</label>
                    <p className="text-sm text-foreground">{version.description}</p>
                  </div>
                )}

                {version.effect && (
                  <div>
                    <label className="text-xs text-muted-foreground">{t('versions.field.effect')}</label>
                    <p className="text-sm text-foreground">{version.effect}</p>
                  </div>
                )}

                {version.breathing && (
                  <div>
                    <label className="text-xs text-muted-foreground">{t('versions.field.breathing')}</label>
                    <p className="text-sm text-foreground">{version.breathing}</p>
                  </div>
                )}

                {/* Images */}
                <div>
                  <label className="text-xs text-muted-foreground block mb-2">{t('versions.images')}</label>
                  <div className="flex flex-wrap gap-2">
                    {version.schema_path && (
                      <Badge variant="outline" className="flex items-center gap-1">
                        <ImageIcon className="w-3 h-3" />
                        {t('versions.field.schema')}
                      </Badge>
                    )}
                    {version.photo_path && (
                      <Badge variant="outline" className="flex items-center gap-1">
                        <ImageIcon className="w-3 h-3" />
                        {t('versions.field.photo')}
                      </Badge>
                    )}
                    {version.muscle_layer_path && (
                      <Badge variant="outline" className="flex items-center gap-1">
                        <ImageIcon className="w-3 h-3" />
                        {t('versions.field.muscle_layer')}
                      </Badge>
                    )}
                    {!version.schema_path && !version.photo_path && !version.muscle_layer_path && (
                      <span className="text-sm text-muted-foreground">{t('versions.no_images')}</span>
                    )}
                  </div>
                </div>

                {/* Muscles */}
                {version.muscles && version.muscles.length > 0 && (
                  <div>
                    <label className="text-xs text-muted-foreground block mb-2">
                      {t('versions.field.muscles')} ({version.muscles.length})
                    </label>
                    <div className="flex flex-wrap gap-2">
                      {version.muscles.map((muscle, index) => (
                        <Badge
                          key={index}
                          className={getActivationColor(muscle.activation_level)}
                        >
                          {muscle.muscle_name || `#${muscle.muscle_id}`}: {muscle.activation_level}%
                        </Badge>
                      ))}
                    </div>
                  </div>
                )}
              </div>
              </motion.div>
            ) : null}
          </AnimatePresence>
        </div>
      </DialogContent>
    </Dialog>
  );
};
