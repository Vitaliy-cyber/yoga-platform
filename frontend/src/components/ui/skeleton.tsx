import React from "react";
import { cn } from "../../lib/utils";

interface SkeletonProps extends React.HTMLAttributes<HTMLDivElement> {}

export const Skeleton: React.FC<SkeletonProps> = ({ className, ...props }) => {
  return (
    <div
      className={cn(
        "bg-muted rounded-lg",
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

// Skeleton for pose detail page
export const PoseDetailSkeleton: React.FC = () => {
  return (
    <div className="min-h-screen bg-background" aria-busy="true" aria-live="polite" role="status">
      <span className="sr-only">Loading pose details...</span>
      {/* Header skeleton */}
      <div className="bg-card border-b border-border">
        <div className="max-w-7xl mx-auto px-6 py-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-4">
              <Skeleton className="w-10 h-10 rounded-lg" />
              <div>
                <Skeleton className="h-6 w-48 mb-2" />
                <div className="flex items-center gap-2">
                  <Skeleton className="h-5 w-20 rounded-full" />
                  <Skeleton className="h-5 w-24 rounded-full" />
                </div>
              </div>
            </div>
            <div className="flex items-center gap-3">
              <Skeleton className="h-10 w-28 rounded-lg" />
              <Skeleton className="h-10 w-28 rounded-lg" />
            </div>
          </div>
        </div>
      </div>
      {/* Content skeleton */}
      <div className="max-w-7xl mx-auto px-6 py-8">
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
          <div className="space-y-6">
            {/* Image area */}
            <div className="bg-card rounded-2xl border border-border overflow-hidden">
              <div className="p-4 border-b border-border">
                <Skeleton className="h-10 w-full rounded-lg" />
              </div>
              <div className="p-4">
                <Skeleton className="aspect-square rounded-xl" />
              </div>
            </div>
          </div>
          <div className="space-y-6">
            {/* Details card */}
            <div className="bg-card rounded-2xl border border-border p-6">
              <Skeleton className="h-6 w-32 mb-6" />
              <div className="space-y-4">
                <div className="space-y-2">
                  <Skeleton className="h-4 w-16" />
                  <Skeleton className="h-5 w-3/4" />
                </div>
                <div className="space-y-2">
                  <Skeleton className="h-4 w-20" />
                  <Skeleton className="h-5 w-1/2" />
                </div>
                <div className="space-y-2">
                  <Skeleton className="h-4 w-24" />
                  <Skeleton className="h-16 w-full" />
                </div>
              </div>
            </div>
            {/* Version history skeleton */}
            <div className="bg-card rounded-2xl border border-border p-6">
              <Skeleton className="h-6 w-36 mb-4" />
              <div className="space-y-3">
                <Skeleton className="h-16 w-full rounded-lg" />
                <Skeleton className="h-16 w-full rounded-lg" />
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

// Skeleton for analytics dashboard
export const AnalyticsDashboardSkeleton: React.FC = () => {
  return (
    <div aria-busy="true" aria-live="polite" role="status">
      <span className="sr-only">Loading analytics...</span>
      {/* Stats row */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-8">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="bg-card rounded-2xl border p-5">
            <Skeleton className="h-8 w-16 mb-2" />
            <Skeleton className="h-4 w-24" />
          </div>
        ))}
      </div>
      {/* Charts area */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="bg-card rounded-2xl border p-6">
          <Skeleton className="h-5 w-32 mb-4" />
          <Skeleton className="h-64 w-full rounded-lg" />
        </div>
        <div className="bg-card rounded-2xl border p-6">
          <Skeleton className="h-5 w-40 mb-4" />
          <Skeleton className="h-64 w-full rounded-lg" />
        </div>
      </div>
    </div>
  );
};

// Skeleton for compare page
export const ComparePageSkeleton: React.FC = () => {
  return (
    <div className="min-h-screen bg-background p-6" aria-busy="true" aria-live="polite" role="status">
      <span className="sr-only">Loading comparison...</span>
      <div className="max-w-7xl mx-auto">
        <Skeleton className="h-8 w-48 mb-6" />
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          {Array.from({ length: 2 }).map((_, i) => (
            <div key={i} className="bg-card rounded-2xl border overflow-hidden">
              <Skeleton className="aspect-square" />
              <div className="p-4 space-y-2">
                <Skeleton className="h-5 w-3/4" />
                <Skeleton className="h-4 w-1/2" />
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};

// Skeleton for sequence detail
export const SequenceDetailSkeleton: React.FC = () => {
  return (
    <div className="min-h-screen bg-background" aria-busy="true" aria-live="polite" role="status">
      <span className="sr-only">Loading sequence...</span>
      <div className="bg-card border-b border-border">
        <div className="max-w-6xl mx-auto px-6 py-4 flex items-center gap-4">
          <Skeleton className="w-10 h-10 rounded-lg" />
          <div>
            <Skeleton className="h-6 w-48 mb-2" />
            <Skeleton className="h-4 w-32" />
          </div>
        </div>
      </div>
      <div className="max-w-6xl mx-auto px-6 py-8 space-y-6">
        <Skeleton className="h-64 w-full rounded-2xl" />
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-24 rounded-xl" />
          ))}
        </div>
      </div>
    </div>
  );
};

// Generic loading grid
export const SkeletonGrid: React.FC<{
  count?: number;
  ItemSkeleton?: React.FC;
  className?: string;
}> = ({ count = 8, ItemSkeleton = PoseCardSkeleton, className }) => {
  return (
    <div
      className={cn(
        "grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4 sm:gap-6",
        className
      )}
      aria-busy="true"
      aria-live="polite"
      role="status"
    >
      <span className="sr-only">Loading content...</span>
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
    <div
      className={cn("space-y-3 sm:space-y-4", className)}
      aria-busy="true"
      aria-live="polite"
      role="status"
    >
      <span className="sr-only">Loading content...</span>
      {Array.from({ length: count }).map((_, i) => (
        <ItemSkeleton key={i} />
      ))}
    </div>
  );
};

export default Skeleton;
