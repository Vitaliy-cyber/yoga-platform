import React, { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { versionsApi } from '../../services/api';
import { Button } from '../ui/button';
import { Textarea } from '../ui/textarea';
import { Label } from '../ui/label';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '../ui/dialog';
import { Loader2, RotateCcw, AlertTriangle } from 'lucide-react';
import { useViewTransition } from '../../hooks/useViewTransition';
import { useI18n } from '../../i18n';

interface RestoreResponse {
  success: boolean;
  message: string;
  pose_id: number;
  warnings?: string[];
  missing_muscles?: Array<{
    muscle_id: number;
    muscle_name: string | null;
    activation_level: number;
  }>;
}

interface VersionRestoreModalProps {
  poseId: number;
  versionId: number;
  versionNumber: number;
  isOpen: boolean;
  onClose: () => void;
  /**
   * Called after successful restore.
   * Parent component should use this to:
   * 1. Refetch the version list
   * 2. Refetch the pose data
   * 3. Invalidate any cached data
   */
  onRestored: (warnings?: string[]) => void;
}

export const VersionRestoreModal: React.FC<VersionRestoreModalProps> = ({
  poseId,
  versionId,
  versionNumber,
  isOpen,
  onClose,
  onRestored,
}) => {
  const { t } = useI18n();
  const { startTransition } = useViewTransition();
  const [changeNote, setChangeNote] = useState('');
  const [isRestoring, setIsRestoring] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleRestore = async () => {
    void startTransition(() => setIsRestoring(true));
    setError(null);
    try {
      const response: RestoreResponse = await versionsApi.restore(poseId, versionId, {
        change_note: changeNote || undefined,
      });

      // Extract any warnings from the response
      const restoreWarnings = response.warnings || [];
      if (response.missing_muscles && response.missing_muscles.length > 0) {
        // Add missing muscles info to warnings for user visibility
        response.missing_muscles.forEach((m) => {
          if (!restoreWarnings.some(w => w.includes(m.muscle_name || String(m.muscle_id)))) {
            restoreWarnings.push(
              `Muscle '${m.muscle_name || m.muscle_id}' no longer exists`
            );
          }
        });
      }

      // Pass warnings to parent so they can be displayed
      // Parent MUST refetch version list and pose data after this callback
      onRestored(restoreWarnings.length > 0 ? restoreWarnings : undefined);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : t('versions.restore_error'));
    } finally {
      setIsRestoring(false);
    }
  };

  const handleClose = () => {
    if (!isRestoring) {
      setChangeNote('');
      setError(null);
      onClose();
    }
  };

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && handleClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <RotateCcw className="w-5 h-5 text-amber-600" />
            {t('versions.restore_title')}
          </DialogTitle>
          <DialogDescription>
            {t('versions.restore_description', { version: versionNumber.toString() })}
          </DialogDescription>
        </DialogHeader>

        <div className="py-4">
          <div className="flex items-start gap-3 p-4 bg-amber-50 dark:bg-amber-900/30 border border-amber-200 dark:border-amber-800 rounded-lg mb-4">
            <AlertTriangle className="w-5 h-5 text-amber-600 dark:text-amber-400 flex-shrink-0 mt-0.5" />
            <div className="text-sm text-amber-800 dark:text-amber-300">
              <p className="font-medium mb-1">{t('versions.restore_warning_title')}</p>
              <p>{t('versions.restore_warning_text')}</p>
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="changeNote">{t('versions.restore_note_label')}</Label>
            <Textarea
              id="changeNote"
              value={changeNote}
              onChange={(e) => setChangeNote(e.target.value)}
              placeholder={t('versions.restore_note_placeholder')}
              rows={3}
              maxLength={500}
              disabled={isRestoring}
            />
            <p className="text-xs text-muted-foreground">
              {t('versions.restore_note_hint')}
            </p>
          </div>

          <AnimatePresence>
            {error && (
              <motion.div
                initial={{ opacity: 0, y: -10, height: 0 }}
                animate={{ opacity: 1, y: 0, height: "auto" }}
                exit={{ opacity: 0, y: -10, height: 0 }}
                transition={{ duration: 0.2 }}
                className="mt-4 p-3 bg-red-50 dark:bg-red-900/30 border border-red-200 dark:border-red-800 rounded-lg text-sm text-red-700 dark:text-red-400 overflow-hidden"
              >
                {error}
              </motion.div>
            )}
          </AnimatePresence>
        </div>

        <DialogFooter className="gap-2 sm:gap-0">
          <Button
            variant="outline"
            onClick={handleClose}
            disabled={isRestoring}
          >
            {t('versions.cancel')}
          </Button>
          <Button
            onClick={handleRestore}
            disabled={isRestoring}
            className="bg-amber-600 hover:bg-amber-700"
          >
            {isRestoring ? (
              <>
                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                {t('versions.restoring')}
              </>
            ) : (
              <>
                <RotateCcw className="w-4 h-4 mr-2" />
                {t('versions.restore_confirm')}
              </>
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};
