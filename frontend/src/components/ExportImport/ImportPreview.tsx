import React from 'react';
import { FileText, FolderOpen, Plus, RefreshCw, SkipForward, AlertTriangle } from 'lucide-react';
import { useI18n } from '../../i18n';
import type { ImportPreviewResult, ImportPreviewItem } from '../../types';

interface ImportPreviewProps {
  preview: ImportPreviewResult;
}

export const ImportPreview: React.FC<ImportPreviewProps> = ({ preview }) => {
  const { t } = useI18n();

  if (!preview.valid && preview.validation_errors.length > 0) {
    return (
      <div className="border border-red-200 dark:border-red-800 bg-red-50 dark:bg-red-900/30 rounded-xl p-4">
        <div className="flex items-center gap-2 text-red-700 dark:text-red-400 font-medium mb-2">
          <AlertTriangle className="h-5 w-5" />
          {t('import.validation_errors')}
        </div>
        <ul className="space-y-1 text-sm text-red-600 dark:text-red-400">
          {preview.validation_errors.slice(0, 5).map((error, i) => (
            <li key={i}>{error}</li>
          ))}
          {preview.validation_errors.length > 5 && (
            <li className="text-red-500 dark:text-red-500">
              +{preview.validation_errors.length - 5} {t('import.more_errors')}
            </li>
          )}
        </ul>
      </div>
    );
  }

  const getStatusIcon = (willBe: ImportPreviewItem['will_be']) => {
    switch (willBe) {
      case 'created':
        return <Plus className="h-4 w-4 text-green-500" />;
      case 'updated':
        return <RefreshCw className="h-4 w-4 text-blue-500" />;
      case 'skipped':
        return <SkipForward className="h-4 w-4 text-amber-500" />;
    }
  };

  const getStatusClass = (willBe: ImportPreviewItem['will_be']) => {
    switch (willBe) {
      case 'created':
        return 'bg-green-50 dark:bg-green-900/30 text-green-700 dark:text-green-400';
      case 'updated':
        return 'bg-blue-50 dark:bg-blue-900/30 text-blue-700 dark:text-blue-400';
      case 'skipped':
        return 'bg-amber-50 dark:bg-amber-900/30 text-amber-700 dark:text-amber-400';
    }
  };

  return (
    <div className="border border-border rounded-xl overflow-hidden">
      {/* Summary header */}
      <div className="bg-muted px-4 py-3 border-b border-border">
        <h4 className="font-medium text-foreground">{t('import.preview_title')}</h4>
        <div className="flex gap-4 mt-2 text-sm">
          <span className="flex items-center gap-1 text-muted-foreground">
            <FileText className="h-4 w-4" />
            {preview.poses_count} {t('import.poses')}
          </span>
          <span className="flex items-center gap-1 text-muted-foreground">
            <FolderOpen className="h-4 w-4" />
            {preview.categories_count} {t('import.categories')}
          </span>
        </div>
      </div>

      {/* Summary counts */}
      <div className="grid grid-cols-3 gap-px bg-border">
        <div className="bg-green-50 dark:bg-green-900/30 px-4 py-3 text-center">
          <div className="text-lg font-bold text-green-600 dark:text-green-400">{preview.will_create}</div>
          <div className="text-xs text-green-600 dark:text-green-400">{t('import.will_create')}</div>
        </div>
        <div className="bg-blue-50 dark:bg-blue-900/30 px-4 py-3 text-center">
          <div className="text-lg font-bold text-blue-600 dark:text-blue-400">{preview.will_update}</div>
          <div className="text-xs text-blue-600 dark:text-blue-400">{t('import.will_update')}</div>
        </div>
        <div className="bg-amber-50 dark:bg-amber-900/30 px-4 py-3 text-center">
          <div className="text-lg font-bold text-amber-600 dark:text-amber-400">{preview.will_skip}</div>
          <div className="text-xs text-amber-600 dark:text-amber-400">{t('import.will_skip')}</div>
        </div>
      </div>

      {/* Items list */}
      {preview.items.length > 0 && (
        <div className="max-h-48 overflow-y-auto">
          <table className="w-full text-sm">
            <thead className="bg-muted sticky top-0">
              <tr>
                <th className="text-left px-4 py-2 text-muted-foreground font-medium">
                  {t('import.item')}
                </th>
                <th className="text-left px-4 py-2 text-muted-foreground font-medium">
                  {t('import.type')}
                </th>
                <th className="text-left px-4 py-2 text-muted-foreground font-medium">
                  {t('import.action')}
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {preview.items.map((item, i) => (
                <tr key={i} className="hover:bg-muted">
                  <td className="px-4 py-2">
                    <div className="font-medium text-foreground">{item.name}</div>
                    {item.code && (
                      <div className="text-xs text-muted-foreground/70">{item.code}</div>
                    )}
                  </td>
                  <td className="px-4 py-2 text-muted-foreground">
                    {item.type === 'pose' ? t('import.pose') : t('import.category')}
                  </td>
                  <td className="px-4 py-2">
                    <span
                      className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs font-medium ${getStatusClass(
                        item.will_be
                      )}`}
                    >
                      {getStatusIcon(item.will_be)}
                      {t(`import.${item.will_be}`)}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
};

export default ImportPreview;
