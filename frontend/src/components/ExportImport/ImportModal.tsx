import React, { useState, useCallback } from 'react';
import { useDropzone } from 'react-dropzone';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Upload,
  FileJson,
  FileSpreadsheet,
  Archive,
  AlertCircle,
  CheckCircle2,
  XCircle,
  Loader2,
  ChevronDown,
} from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '../ui/dialog';
import { Button } from '../ui/button';
import { importApi } from '../../services/api';
import { useI18n } from '../../i18n';
import { slideHorizontalSwap, normalTransition } from '../../lib/animation-variants';
import type { DuplicateHandling, ImportResult, ImportPreviewResult } from '../../types';
import ImportPreview from './ImportPreview';

interface ImportModalProps {
  isOpen: boolean;
  onClose: () => void;
  onImportComplete?: (result: ImportResult) => void;
}

type ImportType = 'json' | 'csv' | 'backup';

const ACCEPTED_FILES: Record<ImportType, Record<string, string[]>> = {
  // NOTE: Browser-provided File.type can be empty or 'text/plain' for .json/.csv,
  // especially in tests or when OS MIME mappings are missing. Accept by extension too.
  json: { 'application/json': ['.json'], 'text/plain': ['.json'] },
  csv: { 'text/csv': ['.csv'], 'text/plain': ['.csv'], 'application/vnd.ms-excel': ['.csv'] },
  backup: { 'application/json': ['.json'], 'text/plain': ['.json'] },
};

export const ImportModal: React.FC<ImportModalProps> = ({
  isOpen,
  onClose,
  onImportComplete,
}) => {
  const { t } = useI18n();
  const [importType, setImportType] = useState<ImportType>('json');
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [duplicateHandling, setDuplicateHandling] = useState<DuplicateHandling>('skip');
  const [isUploading, setIsUploading] = useState(false);
  const [isPreviewing, setIsPreviewing] = useState(false);
  const [preview, setPreview] = useState<ImportPreviewResult | null>(null);
  const [result, setResult] = useState<ImportResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  const resetState = () => {
    setSelectedFile(null);
    setPreview(null);
    setResult(null);
    setError(null);
  };

  const onDrop = useCallback((acceptedFiles: File[]) => {
    if (acceptedFiles.length > 0) {
      setSelectedFile(acceptedFiles[0]);
      setPreview(null);
      setResult(null);
      setError(null);
    }
  }, []);

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop,
    accept: ACCEPTED_FILES[importType],
    maxFiles: 1,
    maxSize: 10 * 1024 * 1024, // 10MB
  });

  const handlePreview = async () => {
    if (!selectedFile) return;

    setIsPreviewing(true);
    setError(null);

    try {
      const previewResult = await importApi.previewJson(selectedFile, duplicateHandling);
      setPreview(previewResult);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Preview failed');
    } finally {
      setIsPreviewing(false);
    }
  };

  const handleImport = async () => {
    if (!selectedFile) return;

    setIsUploading(true);
    setError(null);

    try {
      let importResult: ImportResult;

      switch (importType) {
        case 'json':
          importResult = await importApi.posesJson(selectedFile, duplicateHandling);
          break;
        case 'csv':
          importResult = await importApi.posesCsv(selectedFile, duplicateHandling);
          break;
        case 'backup':
          importResult = await importApi.backup(selectedFile, duplicateHandling);
          break;
        default:
          throw new Error('Unknown import type');
      }

      setResult(importResult);
      onImportComplete?.(importResult);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Import failed');
    } finally {
      setIsUploading(false);
    }
  };

  const handleClose = () => {
    resetState();
    onClose();
  };

  const importTypes: { type: ImportType; label: string; icon: React.ElementType }[] = [
    { type: 'json', label: 'JSON', icon: FileJson },
    { type: 'csv', label: 'CSV', icon: FileSpreadsheet },
    { type: 'backup', label: t('import.backup'), icon: Archive },
  ];

  const duplicateOptions: { value: DuplicateHandling; label: string }[] = [
    { value: 'skip', label: t('import.duplicate_skip') },
    { value: 'overwrite', label: t('import.duplicate_overwrite') },
    { value: 'rename', label: t('import.duplicate_rename') },
  ];

  return (
    <Dialog
      open={isOpen}
      onOpenChange={(open) => {
        if (!open) handleClose();
      }}
    >
      <DialogContent className="sm:max-w-xl" data-testid="import-dialog">
        <DialogHeader>
          <DialogTitle>{t('import.title')}</DialogTitle>
          <DialogDescription>{t('import.description')}</DialogDescription>
        </DialogHeader>

        <AnimatePresence mode="wait">
          {!result ? (
          <motion.div
            key="upload"
            className="space-y-6 py-4"
            variants={slideHorizontalSwap}
            initial="initial"
            animate="animate"
            exit="exit"
            transition={normalTransition}
          >
            {/* Import type selector */}
            <div>
              <label className="block text-sm font-medium text-foreground mb-2">
                {t('import.file_type')}
              </label>
              <div className="flex gap-2">
                {importTypes.map(({ type, label, icon: Icon }) => (
                  <button
                    key={type}
                    onClick={() => {
                      // and cause flakey interactions (e.g., file selection + preview) under load.
                      setImportType(type);
                      resetState();
                    }}
                    data-testid={`import-type-${type}`}
                    className={`flex items-center gap-2 px-4 py-2 rounded-lg border transition-colors ${
                      importType === type
                        ? 'border-primary bg-primary text-primary-foreground'
                        : 'border-input bg-background text-muted-foreground hover:bg-accent'
                    }`}
                  >
                    <Icon className="h-4 w-4" />
                    {label}
                  </button>
                ))}
              </div>
            </div>

            {/* Dropzone */}
            <div
              {...getRootProps()}
              data-testid="import-dropzone"
              className={`relative border-2 border-dashed rounded-xl p-8 text-center cursor-pointer transition-colors ${
                isDragActive
                  ? 'border-primary/50 bg-accent'
                  : selectedFile
                  ? 'border-green-400 dark:border-green-600 bg-green-50 dark:bg-green-900/30'
                  : 'border-border hover:border-border/80 hover:bg-muted'
              }`}
            >
              <input {...getInputProps()} data-testid="import-file-input" />

              {selectedFile ? (
                <div className="space-y-2">
                  <CheckCircle2 className="h-10 w-10 text-green-500 mx-auto" />
                  <p className="text-sm font-medium text-foreground">{selectedFile.name}</p>
                  <p className="text-xs text-muted-foreground">
                    {(selectedFile.size / 1024).toFixed(1)} KB
                  </p>
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      resetState();
                    }}
                    className="text-xs text-muted-foreground hover:text-foreground underline"
                  >
                    {t('import.choose_different')}
                  </button>
                </div>
              ) : (
                <div className="space-y-2">
                  <Upload className="h-10 w-10 text-muted-foreground/70 mx-auto" />
                  <p className="text-sm text-muted-foreground">
                    {isDragActive ? t('import.drop_here') : t('import.drag_drop')}
                  </p>
                  <p className="text-xs text-muted-foreground/70">{t('import.max_size')}</p>
                </div>
              )}
            </div>

            {/* Duplicate handling */}
            <div>
              <label className="block text-sm font-medium text-foreground mb-2">
                {t('import.duplicate_handling')}
              </label>
              <div className="relative">
                <select
                  value={duplicateHandling}
                  onChange={(e) => setDuplicateHandling(e.target.value as DuplicateHandling)}
                  data-testid="import-duplicate-select"
                  className="w-full appearance-none rounded-lg border border-input bg-background px-4 py-2 pr-10 text-foreground focus:border-ring focus:outline-none focus:ring-2 focus:ring-ring/20"
                >
                  {duplicateOptions.map(({ value, label }) => (
                    <option key={value} value={value}>
                      {label}
                    </option>
                  ))}
                </select>
                <ChevronDown className="absolute right-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground/70 pointer-events-none" />
              </div>
            </div>

            {/* Preview section */}
            {preview && (
              <div data-testid="import-preview-result">
                <ImportPreview preview={preview} />
              </div>
            )}

            {/* Error message */}
            {error && (
              <div
                data-testid="import-error"
                className="flex items-start gap-3 p-4 bg-red-50 dark:bg-red-900/30 rounded-lg text-red-700 dark:text-red-400"
              >
                <AlertCircle className="h-5 w-5 flex-shrink-0 mt-0.5" />
                <div className="text-sm">{error}</div>
              </div>
            )}
          </motion.div>
        ) : (
          /* Results view */
          <motion.div
            key="result"
            className="py-6"
            data-testid="import-result"
            variants={slideHorizontalSwap}
            initial="initial"
            animate="animate"
            exit="exit"
            transition={normalTransition}
          >
            <div className="text-center mb-6">
              {result.success ? (
                <CheckCircle2 className="h-16 w-16 text-green-500 mx-auto mb-4" />
              ) : (
                <XCircle className="h-16 w-16 text-red-500 mx-auto mb-4" />
              )}
              <h3 className="text-lg font-semibold text-foreground">
                {result.success ? t('import.success') : t('import.partial_success')}
              </h3>
            </div>

            <div className="grid grid-cols-4 gap-4 text-center">
              <div className="p-3 bg-muted rounded-lg">
                <div className="text-2xl font-bold text-foreground">{result.total_items}</div>
                <div className="text-xs text-muted-foreground">{t('import.total')}</div>
              </div>
              <div className="p-3 bg-green-50 dark:bg-green-900/30 rounded-lg">
                <div className="text-2xl font-bold text-green-600 dark:text-green-400">{result.created}</div>
                <div className="text-xs text-green-600 dark:text-green-400">{t('import.created')}</div>
              </div>
              <div className="p-3 bg-blue-50 dark:bg-blue-900/30 rounded-lg">
                <div className="text-2xl font-bold text-blue-600 dark:text-blue-400">{result.updated}</div>
                <div className="text-xs text-blue-600 dark:text-blue-400">{t('import.updated')}</div>
              </div>
              <div className="p-3 bg-amber-50 dark:bg-amber-900/30 rounded-lg">
                <div className="text-2xl font-bold text-amber-600 dark:text-amber-400">{result.skipped}</div>
                <div className="text-xs text-amber-600 dark:text-amber-400">{t('import.skipped')}</div>
              </div>
            </div>

            {result.errors > 0 && (
              <div className="mt-4 p-3 bg-red-50 dark:bg-red-900/30 rounded-lg text-red-700 dark:text-red-400">
                <div className="font-medium">{result.errors} {t('import.errors')}</div>
                {result.items
                  .filter((item) => item.status === 'error')
                  .slice(0, 3)
                  .map((item, i) => (
                    <div key={i} className="text-sm mt-1">
                      {item.name}: {item.message}
                    </div>
                  ))}
              </div>
            )}
          </motion.div>
        )}
        </AnimatePresence>

        <DialogFooter>
          {!result ? (
            <>
              <Button
                variant="outline"
                onClick={handleClose}
                disabled={isUploading}
                data-testid="import-cancel"
              >
                {t('import.cancel')}
              </Button>

              {importType === 'json' && selectedFile && !preview && (
                <Button
                  variant="secondary"
                  onClick={handlePreview}
                  disabled={isPreviewing}
                  data-testid="import-preview"
                >
                  {isPreviewing ? (
                    <>
                      <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                      {t('import.previewing')}
                    </>
                  ) : (
                    t('import.preview')
                  )}
                </Button>
              )}

              <Button
                onClick={handleImport}
                disabled={!selectedFile || isUploading}
                data-testid="import-submit"
              >
                {isUploading ? (
                  <>
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                    {t('import.importing')}
                  </>
                ) : (
                  t('import.import_btn')
                )}
              </Button>
            </>
          ) : (
            <Button onClick={handleClose} data-testid="import-close">
              {t('import.close')}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

export default ImportModal;
