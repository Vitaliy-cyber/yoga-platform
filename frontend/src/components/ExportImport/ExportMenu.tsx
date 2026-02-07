import React, { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Download, FileJson, FileSpreadsheet, FileText, Archive, ChevronDown, Loader2 } from 'lucide-react';
import { Button } from '../ui/button';
import { exportApi, downloadBlob } from '../../services/api';
import { useI18n } from '../../i18n';
import { dropdownVariants, fastTransition } from '../../lib/animation-variants';

interface ExportMenuProps {
  /** Optional category ID to filter export */
  categoryId?: number;
  /** Optional pose ID for single pose PDF export */
  poseId?: number;
  /** Pose name for PDF filename */
  poseName?: string;
  /** Show only pose-specific options (PDF) */
  poseOnly?: boolean;
  /** Custom class name */
  className?: string;
  /** Callback when export starts */
  onExportStart?: () => void;
  /** Callback when export completes */
  onExportComplete?: () => void;
  /** Callback on error */
  onError?: (error: Error) => void;
}

type ExportType = 'json' | 'csv' | 'pdf' | 'pdf_all' | 'backup';

export const ExportMenu: React.FC<ExportMenuProps> = ({
  categoryId,
  poseId,
  poseName,
  poseOnly = false,
  className = '',
  onExportStart,
  onExportComplete,
  onError,
}) => {
  const { t } = useI18n();
  const [isOpen, setIsOpen] = useState(false);
  const [isExporting, setIsExporting] = useState(false);
  const [exportingType, setExportingType] = useState<ExportType | null>(null);

  const handleExport = async (type: ExportType) => {
    setIsExporting(true);
    setExportingType(type);
    onExportStart?.();

    try {
      let blob: Blob;
      let filename: string;
      const timestamp = new Date().toISOString().slice(0, 10);

      switch (type) {
        case 'json':
          blob = await exportApi.posesJson(categoryId);
          filename = `poses_export_${timestamp}.json`;
          break;
        case 'csv':
          blob = await exportApi.posesCsv(categoryId);
          filename = `poses_export_${timestamp}.csv`;
          break;
        case 'pdf':
          if (!poseId) throw new Error('Pose ID required for PDF export');
          blob = await exportApi.posePdf(poseId);
          const safeName = poseName?.replace(/[^a-zA-Z0-9-_]/g, '_') || 'pose';
          filename = `${safeName}.pdf`;
          break;
        case 'pdf_all':
          blob = await exportApi.allPosesPdf(categoryId);
          filename = `poses_collection_${timestamp}.pdf`;
          break;
        case 'backup':
          blob = await exportApi.backup();
          filename = `yoga_backup_${timestamp}.json`;
          break;
        default:
          throw new Error('Unknown export type');
      }

      downloadBlob(blob, filename);
      onExportComplete?.();
    } catch (error) {
      console.error('Export failed:', error);
      onError?.(error instanceof Error ? error : new Error('Export failed'));
    } finally {
      setIsExporting(false);
      setExportingType(null);
      setIsOpen(false);
    }
  };

  const exportOptions = poseOnly
    ? [
        {
          type: 'pdf' as ExportType,
          label: t('export.pdf'),
          description: t('export.pdf_single_desc'),
          icon: FileText,
        },
      ]
    : [
        {
          type: 'json' as ExportType,
          label: t('export.json'),
          description: t('export.json_desc'),
          icon: FileJson,
        },
        {
          type: 'csv' as ExportType,
          label: t('export.csv'),
          description: t('export.csv_desc'),
          icon: FileSpreadsheet,
        },
        {
          type: 'pdf_all' as ExportType,
          label: t('export.pdf_all'),
          description: t('export.pdf_all_desc'),
          icon: FileText,
        },
        {
          type: 'backup' as ExportType,
          label: t('export.backup'),
          description: t('export.backup_desc'),
          icon: Archive,
        },
      ];

  return (
    <div className={`relative ${className}`}>
      <Button
        variant="outline"
        size="sm"
        onClick={() => setIsOpen(!isOpen)}
        disabled={isExporting}
        className="gap-2"
        data-testid="export-menu-toggle"
      >
        {isExporting ? (
          <Loader2 className="h-4 w-4 animate-spin" />
        ) : (
          <Download className="h-4 w-4" />
        )}
        <span>{t('export.title')}</span>
        <motion.span animate={{ rotate: isOpen ? 180 : 0 }} transition={{ duration: 0.2 }}>
          <ChevronDown className="h-4 w-4" />
        </motion.span>
      </Button>

      <AnimatePresence>
        {isOpen && (
          <>
            {/* Backdrop */}
            <div
              className="fixed inset-0 z-40"
              onClick={() => setIsOpen(false)}
            />

            {/* Dropdown menu */}
            <motion.div
              variants={dropdownVariants}
              initial="initial"
              animate="animate"
              exit="exit"
              transition={fastTransition}
              className="absolute right-0 top-full mt-2 z-50 w-72 rounded-xl border bg-card shadow-lg"
            >
              <div className="p-2">
                <div className="px-3 py-2 text-xs font-medium text-muted-foreground uppercase tracking-wide">
                  {t('export.choose_format')}
                </div>

                {exportOptions.map((option) => {
                  const Icon = option.icon;
                  const isCurrentExporting = exportingType === option.type;

                  return (
                    <button
                      key={option.type}
                      onClick={() => handleExport(option.type)}
                      disabled={isExporting}
                      data-testid={`export-option-${option.type}`}
                      className="w-full flex items-start gap-3 px-3 py-2 rounded-lg hover:bg-accent disabled:opacity-50 disabled:cursor-not-allowed text-left transition-colors"
                    >
                      <div className="flex-shrink-0 mt-0.5">
                        {isCurrentExporting ? (
                          <Loader2 className="h-5 w-5 text-muted-foreground animate-spin" />
                        ) : (
                          <Icon className="h-5 w-5 text-muted-foreground" />
                        )}
                      </div>
                      <div>
                        <div className="font-medium text-foreground">{option.label}</div>
                        <div className="text-xs text-muted-foreground">{option.description}</div>
                      </div>
                    </button>
                  );
                })}
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>
    </div>
  );
};

export default ExportMenu;
