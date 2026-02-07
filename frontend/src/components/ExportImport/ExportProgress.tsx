import React from 'react';
import { Loader2, CheckCircle2, XCircle, Download } from 'lucide-react';
import { useI18n } from '../../i18n';

export type ExportStatus = 'idle' | 'preparing' | 'generating' | 'downloading' | 'complete' | 'error';

interface ExportProgressProps {
  status: ExportStatus;
  progress?: number;
  error?: string;
  filename?: string;
  onRetry?: () => void;
  onClose?: () => void;
}

export const ExportProgress: React.FC<ExportProgressProps> = ({
  status,
  progress = 0,
  error,
  filename,
  onRetry,
  onClose,
}) => {
  const { t } = useI18n();

  if (status === 'idle') return null;

  const isProcessing = ['preparing', 'generating', 'downloading'].includes(status);

  const statusMessages: Record<ExportStatus, string> = {
    idle: '',
    preparing: t('export.status_preparing'),
    generating: t('export.status_generating'),
    downloading: t('export.status_downloading'),
    complete: t('export.status_complete'),
    error: t('export.status_error'),
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
      <div className="bg-card rounded-2xl shadow-xl w-full max-w-md mx-4 overflow-hidden">
        {/* Header */}
        <div className="px-6 py-4 border-b border-border">
          <h3 className="text-lg font-semibold text-foreground">{t('export.progress_title')}</h3>
        </div>

        {/* Content */}
        <div className="p-6">
          {/* Status icon */}
          <div className="flex justify-center mb-4">
            {isProcessing && (
              <div className="relative">
                <div className="absolute inset-0 animate-ping bg-muted rounded-full opacity-50" />
                <div className="relative bg-muted rounded-full p-4">
                  <Loader2 className="h-8 w-8 text-muted-foreground animate-spin" />
                </div>
              </div>
            )}
            {status === 'complete' && (
              <div className="bg-green-100 rounded-full p-4">
                <CheckCircle2 className="h-8 w-8 text-green-600" />
              </div>
            )}
            {status === 'error' && (
              <div className="bg-red-100 rounded-full p-4">
                <XCircle className="h-8 w-8 text-red-600" />
              </div>
            )}
          </div>

          {/* Status message */}
          <div className="text-center mb-4">
            <p className="text-foreground font-medium">{statusMessages[status]}</p>
            {filename && status === 'complete' && (
              <p className="text-sm text-muted-foreground mt-1 flex items-center justify-center gap-1">
                <Download className="h-4 w-4" />
                {filename}
              </p>
            )}
            {error && <p className="text-sm text-red-600 mt-2">{error}</p>}
          </div>

          {/* Progress bar */}
          {isProcessing && (
            <div className="relative pt-1">
              <div className="overflow-hidden h-2 text-xs flex rounded-full bg-muted">
                <div
                  style={{ width: `${progress}%` }}
                  className="shadow-none flex flex-col text-center whitespace-nowrap text-white justify-center bg-primary transition-[width] duration-300"
                />
              </div>
              {progress > 0 && (
                <p className="text-xs text-muted-foreground text-center mt-2">{progress}%</p>
              )}
            </div>
          )}
        </div>

        {/* Footer */}
        {(status === 'complete' || status === 'error') && (
          <div className="px-6 py-4 border-t border-border flex justify-end gap-2">
            {status === 'error' && onRetry && (
              <button
                onClick={onRetry}
                className="px-4 py-2 text-sm font-medium text-muted-foreground hover:text-foreground hover:bg-accent rounded-lg transition-colors"
              >
                {t('export.retry')}
              </button>
            )}
            {onClose && (
              <button
                onClick={onClose}
                className="px-4 py-2 text-sm font-medium bg-primary text-primary-foreground rounded-lg hover:bg-primary/90 transition-colors"
              >
                {status === 'complete' ? t('export.done') : t('export.close')}
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
};

export default ExportProgress;
