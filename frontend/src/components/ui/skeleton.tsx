import React from "react";
import { cn } from "../../lib/utils";

interface SkeletonProps extends React.HTMLAttributes<HTMLDivElement> {}

export const Skeleton: React.FC<SkeletonProps> = ({ className, ...props }) => {
  return (
    <div
      className={cn(
        "animate-pulse rounded-lg bg-muted",
        className
      )}
      {...props}
    />
  );
};

// Skeleton for pose cards in grid view
export const PoseCardSkeleton: React.FC = () => {
  return (
    <div className="bg-card rounded-2xl border overflow-hidden">
      {/* Image area */}
      <div className="aspect-[4/3] relative overflow-hidden">
        <Skeleton className="absolute inset-0 rounded-none" />
        {/* Badge skeleton */}
        <div className="absolute top-3 left-3">
          <Skeleton className="h-6 w-16 rounded-full" />
        </div>
      </div>
      {/* Content area */}
      <div className="p-3 sm:p-4">
        <div className="flex items-center justify-between gap-2">
          <Skeleton className="h-6 w-3/4" />
          <Skeleton className="h-10 w-10 rounded-lg" />
        </div>
        <div className="flex flex-wrap gap-1.5 sm:gap-2 mt-2">
          <Skeleton className="h-5 w-20 rounded-full" />
        </div>
      </div>
    </div>
  );
};

// Skeleton for sequence cards
export const SequenceCardSkeleton: React.FC = () => {
  return (
    <div className="bg-card rounded-2xl border overflow-hidden">
      {/* Header gradient */}
      <Skeleton className="h-24 rounded-none" />
      {/* Content */}
      <div className="p-4 pt-2">
        <Skeleton className="h-4 w-full mb-3" />
        {/* Stats row */}
        <div className="flex items-center gap-4 mb-3">
          <Skeleton className="h-4 w-16" />
          <Skeleton className="h-4 w-12" />
        </div>
        {/* Footer */}
        <div className="flex items-center justify-between">
          <Skeleton className="h-6 w-24 rounded-full" />
          <Skeleton className="h-5 w-5 rounded" />
        </div>
      </div>
    </div>
  );
};

// Skeleton for list view items
export const ListItemSkeleton: React.FC = () => {
  return (
    <div className="flex items-center gap-3 sm:gap-4 p-3 sm:p-4 rounded-xl border bg-card">
      <Skeleton className="w-14 h-14 sm:w-16 sm:h-16 rounded-lg flex-shrink-0" />
      <div className="flex-1 min-w-0">
        <Skeleton className="h-5 w-3/4 mb-2" />
        <Skeleton className="h-4 w-1/2" />
      </div>
      <Skeleton className="h-10 w-20 rounded-xl flex-shrink-0" />
    </div>
  );
};

// Skeleton for table rows
export const TableRowSkeleton: React.FC<{ columns?: number }> = ({ columns = 4 }) => {
  return (
    <tr className="border-b border-border">
      {Array.from({ length: columns }).map((_, i) => (
        <td key={i} className="py-4 px-4">
          <Skeleton className="h-4 w-full" />
        </td>
      ))}
    </tr>
  );
};

// Generic loading grid
export const SkeletonGrid: React.FC<{
  count?: number;
  ItemSkeleton?: React.FC;
  className?: string;
}> = ({ count = 8, ItemSkeleton = PoseCardSkeleton, className }) => {
  return (
    <div className={cn(
      "grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4 sm:gap-6",
      className
    )}>
      {Array.from({ length: count }).map((_, i) => (
        <ItemSkeleton key={i} />
      ))}
    </div>
  );
};

// Generic loading list
export const SkeletonList: React.FC<{
  count?: number;
  ItemSkeleton?: React.FC;
  className?: string;
}> = ({ count = 5, ItemSkeleton = ListItemSkeleton, className }) => {
  return (
    <div className={cn("space-y-3 sm:space-y-4", className)}>
      {Array.from({ length: count }).map((_, i) => (
        <ItemSkeleton key={i} />
      ))}
    </div>
  );
};

export default Skeleton;
