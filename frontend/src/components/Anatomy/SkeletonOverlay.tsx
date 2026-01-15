import React from 'react';
import { clsx } from 'clsx';

interface SkeletonOverlayProps {
  imagePath: string | null;
  className?: string;
}

export const SkeletonOverlay: React.FC<SkeletonOverlayProps> = ({
  imagePath,
  className,
}) => {
  if (!imagePath) {
    return (
      <div
        className={clsx(
          'flex items-center justify-center bg-gray-900 text-gray-400 rounded-lg',
          className
        )}
      >
        <div className="text-center p-8">
          <span className="text-6xl block mb-4">🦴</span>
          <p>Скелетне зображення недоступне</p>
        </div>
      </div>
    );
  }

  return (
    <div className={clsx('relative rounded-lg overflow-hidden bg-gray-900', className)}>
      <img
        src={imagePath}
        alt="Skeleton visualization"
        className="w-full h-full object-contain"
      />
    </div>
  );
};
