import React, { useEffect, useRef } from "react";
import { Link } from "react-router-dom";
import { Plus, Layers, Loader2 } from "lucide-react";
import { Button } from "../ui/button";
import { SkeletonGrid, SequenceCardSkeleton } from "../ui/skeleton";
import { SequenceCard } from "./SequenceCard";
import { useSequenceStore } from "../../store/useSequenceStore";
import { useI18n } from "../../i18n";
import { cn } from "../../lib/utils";

export const SequenceList: React.FC = () => {
  const { t } = useI18n();
  const {
    sequences,
    total,
    skip,
    limit,
    isLoading,
    error,
    fetchSequences,
    setPage,
  } = useSequenceStore();

  // Use ref to track if initial fetch has been done to prevent infinite loop
  // fetchSequences is stable from zustand, but we use a ref for extra safety
  const hasFetchedRef = useRef(false);

  useEffect(() => {
    // Only fetch on initial mount, and only if store has no usable list yet.
    // This prevents visible reload flicker when navigating back to this page.
    if (!hasFetchedRef.current) {
      hasFetchedRef.current = true;
      if (sequences.length === 0) {
        void fetchSequences();
      }
    }
  }, [fetchSequences, sequences.length]);

  const currentPage = Math.floor(skip / limit) + 1;
  const totalPages = Math.ceil(total / limit);

  const handlePrevPage = () => {
    if (skip > 0) {
      setPage(skip - limit);
    }
  };

  const handleNextPage = () => {
    if (skip + limit < total) {
      setPage(skip + limit);
    }
  };

  const showInitialLoader = isLoading && sequences.length === 0;

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <header className="bg-card border-b border-border sticky top-0 z-40">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 py-3 sm:py-4 flex items-center justify-between gap-3">
          <div>
            <h1 className="text-xl sm:text-2xl font-semibold text-foreground">
              {t("sequences.title")}
            </h1>
            <div className="flex items-center gap-2 mt-0.5">
              <p className="text-muted-foreground text-xs sm:text-sm">
                {t("sequences.subtitle", { count: total })}
              </p>
              {isLoading && sequences.length > 0 && (
                <Loader2 className="h-3.5 w-3.5 text-muted-foreground animate-spin" />
              )}
            </div>
          </div>
          <Link to="/sequences/new" className="flex-shrink-0">
            <Button
              className="bg-primary hover:bg-primary/90 text-primary-foreground rounded-xl h-10 sm:h-11 px-3 sm:px-5"
              data-testid="sequence-new"
            >
              <Plus className="w-4 h-4 sm:mr-2" />
              <span className="hidden sm:inline">{t("sequences.new")}</span>
            </Button>
          </Link>
        </div>
      </header>

      {/* Content */}
      <main className="max-w-7xl mx-auto px-4 sm:px-6 py-5 sm:py-8">
        {showInitialLoader ? (
          <SkeletonGrid count={8} ItemSkeleton={SequenceCardSkeleton} />
        ) : error && sequences.length === 0 ? (
          <div className="text-center py-20">
            <div className="w-20 h-20 rounded-full bg-rose-100 flex items-center justify-center mx-auto mb-4">
              <Layers className="w-10 h-10 text-rose-400" />
            </div>
            <h3 className="text-lg font-medium text-foreground mb-2">
              {t("sequences.error_fetch")}
            </h3>
            <p className="text-muted-foreground mb-4">{error}</p>
            <Button onClick={() => void fetchSequences()}>{t("dashboard.retry")}</Button>
          </div>
        ) : sequences.length === 0 ? (
          <div className="text-center py-20">
            <div className="w-20 h-20 rounded-full bg-muted flex items-center justify-center mx-auto mb-4">
              <Layers className="w-10 h-10 text-muted-foreground/70" />
            </div>
            <h3 className="text-lg font-medium text-foreground mb-2">
              {t("sequences.empty")}
            </h3>
            <p className="text-muted-foreground mb-6">
              {t("sequences.empty_hint")}
            </p>
            <Link to="/sequences/new">
              <Button className="bg-primary hover:bg-primary/90 text-primary-foreground">
                <Plus className="w-4 h-4 mr-2" />
                {t("sequences.create_first")}
              </Button>
            </Link>
          </div>
        ) : (
          <>
            {/* Grid */}
            <div
              className={cn(
                "grid gap-5 sm:gap-6",
                sequences.length === 1
                  ? "grid-cols-1 max-w-sm"
                  : "grid-cols-1 md:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4",
              )}
            >
              {sequences.map((sequence) => (
                <div key={sequence.id}>
                  <SequenceCard sequence={sequence} />
                </div>
              ))}
            </div>

            {/* Pagination */}
            {totalPages > 1 && (
              <div className="flex items-center justify-center gap-4 mt-8">
                <Button
                  variant="outline"
                  onClick={handlePrevPage}
                  disabled={skip === 0}
                >
                  {t("app.previous")}
                </Button>
                <span className="text-sm text-muted-foreground">
                  {t("app.page_of", {
                    current: currentPage,
                    total: totalPages,
                  })}
                </span>
                <Button
                  variant="outline"
                  onClick={handleNextPage}
                  disabled={skip + limit >= total}
                >
                  {t("app.next")}
                </Button>
              </div>
            )}
          </>
        )}
      </main>
    </div>
  );
};
