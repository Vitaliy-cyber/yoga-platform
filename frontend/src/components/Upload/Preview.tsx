import React from 'react';
import { Loader2, SadFace, Palette } from '../icons';
import { clsx } from 'clsx';
import { useI18n } from '../../i18n';

interface PreviewProps {
  imageUrl: string | null;
  isLoading?: boolean;
  progress?: number;
  error?: string | null;
  placeholder?: React.ReactNode;
  className?: string;
}

export const Preview: React.FC<PreviewProps> = ({
  imageUrl,
  isLoading = false,
  progress = 0,
  error = null,
  placeholder,
  className,
}) => {
  const { t } = useI18n();
  if (error) {
    return (
      <div
        className={clsx(
          'aspect-pose bg-red-50 rounded-xl flex flex-col items-center justify-center p-8 text-center',
          className
        )}
      >
        <SadFace size={56} className="mb-4 text-red-400" />
        <p className="text-red-600 font-medium">{t("preview.error")}</p>
        <p className="text-sm text-red-500 mt-2">{error}</p>
      </div>
    );
  }

  if (isLoading) {
    return (
      <div
        className={clsx(
          'aspect-pose bg-gray-100 rounded-xl flex flex-col items-center justify-center p-8',
          className
        )}
      >
        <Loader2 className="w-12 h-12 text-yoga-sage animate-spin mb-4" />
        <p className="text-gray-600 font-medium">{t("preview.loading")}</p>
        {progress > 0 && (
          <div className="w-48 mt-4">
            <div className="h-2 bg-gray-200 rounded-full overflow-hidden">
              <div
                className="h-full bg-yoga-sage transition-all duration-300"
                style={{ width: `${progress}%` }}
              />
            </div>
            <p className="text-sm text-gray-500 text-center mt-2">{progress}%</p>
          </div>
        )}
      </div>
    );
  }

  if (imageUrl) {
    return (
      <div className={clsx('aspect-pose bg-gray-100 rounded-xl overflow-hidden', className)}>
        <img
          src={imageUrl}
          alt={t("preview.generated")}
          className="w-full h-full object-contain"
        />
      </div>
    );
  }

  return (
    <div
      className={clsx(
        'aspect-pose bg-gray-100 rounded-xl flex flex-col items-center justify-center p-8 text-gray-400',
        className
      )}
    >
      {placeholder || (
        <>
          <Palette size={64} className="mb-4" />
          <p>{t("preview.placeholder")}</p>
        </>
      )}
    </div>
  );
};
