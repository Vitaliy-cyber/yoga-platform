import React, { useEffect, useMemo, useState, useRef, useCallback } from "react";
import { useSearchParams, Link } from "react-router-dom";
import { motion, AnimatePresence } from "framer-motion";
import { PoseCard, PoseFilters, PoseViewer, GenerateModal, PoseImage } from "../components/Pose";
import { categoriesApi, posesApi } from "../services/api";
import { useViewTransition } from "../hooks/useViewTransition";
import { Button } from "../components/ui/button";
import { Grid3X3, List, Plus, Upload } from "lucide-react";
import type { Category, PoseListItem, Pose, ImportResult } from "../types";
import { useI18n } from "../i18n";
import { ExportMenu, ImportModal } from "../components/ExportImport";
import { SkeletonGrid, SkeletonList, PoseCardSkeleton, ListItemSkeleton } from "../components/ui/skeleton";
import { EmptyState } from "../components/ui/empty-state";
import { logger } from "../lib/logger";
import { MAX_POSES_PER_REQUEST } from "../lib/constants";

export const PoseGallery: React.FC = () => {
  const [searchParams, setSearchParams] = useSearchParams();
  const categoryIdParam = searchParams.get("category");
  const categoryId = categoryIdParam ? parseInt(categoryIdParam, 10) : undefined;

  const [poses, setPoses] = useState<PoseListItem[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const { t } = useI18n();
  const { startTransition } = useViewTransition();
  const [viewMode, setViewMode] = useState<"grid" | "list">("grid");
  const [filters, setFilters] = useState({
    search: "",
    category: categoryId ? String(categoryId) : "all",
    status: "all",
  });
  const [selectedPose, setSelectedPose] = useState<Pose | null>(null);
  const [generatePose, setGeneratePose] = useState<PoseListItem | null>(null);
  const [isImportModalOpen, setIsImportModalOpen] = useState(false);

  // AbortController ref for request cancellation
  const abortControllerRef = useRef<AbortController | null>(null);

  const fetchData = useCallback(async () => {
    // Cancel any in-flight request
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
    }

    // Create new abort controller for this request
    const abortController = new AbortController();
    abortControllerRef.current = abortController;

    setIsLoading(true);
    try {
      const [posesData, categoriesData] = await Promise.all([
        posesApi.getAll(categoryId, 0, MAX_POSES_PER_REQUEST, abortController.signal),
        categoriesApi.getAll(abortController.signal),
      ]);
      if (!abortController.signal.aborted) {
        setPoses(posesData);
        setCategories(categoriesData);
      }
    } catch (error) {
      // Ignore aborted requests
      if (error instanceof Error && error.name === "AbortError") {
        return;
      }
      if (!abortController.signal.aborted) {
        logger.error("Failed to fetch poses data:", error);
      }
    } finally {
      if (!abortController.signal.aborted) {
        setIsLoading(false);
      }
    }
  }, [categoryId]);

  useEffect(() => {
    fetchData();

    // Cleanup: abort request on unmount or when categoryId changes
    return () => {
      if (abortControllerRef.current) {
        abortControllerRef.current.abort();
      }
    };
  }, [fetchData]);

  useEffect(() => {
    if (categoryId) {
      setFilters((prev) => ({ ...prev, category: String(categoryId) }));
    }
  }, [categoryId]);

  const poseStatus = (pose: PoseListItem) => (pose.photo_path ? "complete" : "draft");

  const filteredPoses = useMemo(() => {
    return poses.filter((pose) => {
      const matchesSearch =
        !filters.search ||
        pose.name.toLowerCase().includes(filters.search.toLowerCase()) ||
        pose.name_en?.toLowerCase().includes(filters.search.toLowerCase());
      const matchesCategory =
        filters.category === "all" ||
        String(pose.category_id || "") === filters.category;
      const matchesStatus =
        filters.status === "all" || poseStatus(pose) === filters.status;
      return matchesSearch && matchesCategory && matchesStatus;
    });
  }, [poses, filters]);

  const handleCategoryFilter = (nextFilters: typeof filters) => {
    setFilters(nextFilters);
    if (nextFilters.category === "all") {
      setSearchParams({});
    } else {
      setSearchParams({ category: nextFilters.category });
    }
  };

  const handleViewPose = useCallback(async (pose: PoseListItem) => {
    try {
      const fullPose = await posesApi.getById(pose.id);
      setSelectedPose(fullPose);
    } catch (error) {
      logger.error(t("pose.load_failed"), error);
    }
  }, [t]);

  const handleImportComplete = useCallback((result: ImportResult) => {
    if (result.created > 0 || result.updated > 0) {
      fetchData(); // Refresh data after successful import
    }
  }, [fetchData]);

  // Memoize callbacks passed to child components
  const handleCloseViewer = useCallback(() => setSelectedPose(null), []);
  const handleCloseGenerateModal = useCallback(() => setGeneratePose(null), []);
  const handleCloseImportModal = useCallback(() => setIsImportModalOpen(false), []);
  const handleOpenImportModal = useCallback(() => setIsImportModalOpen(true), []);

  return (
    <div className="min-h-screen bg-background">
      <header className="bg-card border-b sticky top-0 z-40">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 py-3 sm:py-4 flex items-center justify-between gap-3">
          <div className="min-w-0 flex-1">
            <h1 className="text-xl sm:text-2xl font-semibold text-foreground truncate">{t("gallery.title")}</h1>
            <p className="text-muted-foreground text-xs sm:text-sm mt-0.5 truncate">
              {t("gallery.summary", { poses: filteredPoses.length, categories: categories.length })}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <ExportMenu
              categoryId={categoryId}
              onError={(err) => logger.error('Export failed:', err)}
            />
            <Button
              variant="outline"
              size="sm"
              onClick={handleOpenImportModal}
              className="gap-2"
            >
              <Upload className="h-4 w-4" />
              <span className="hidden sm:inline">{t("import.title")}</span>
            </Button>
            <Link to="/upload">
              <Button className="bg-primary hover:bg-primary/90 active:bg-primary/80 text-primary-foreground rounded-xl h-10 sm:h-11 px-3 sm:px-5 min-h-[44px] touch-manipulation flex-shrink-0">
                <Plus className="w-4 h-4 sm:mr-2" />
                <span className="hidden sm:inline">{t("gallery.new_pose")}</span>
              </Button>
            </Link>
          </div>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-4 sm:px-6 py-4 sm:py-8">
        <div className="mb-4 sm:mb-6">
          <PoseFilters filters={filters} categories={categories} onFilterChange={handleCategoryFilter} />
        </div>

        <div className="flex items-center justify-between mb-4 sm:mb-6 gap-2">
          <p className="text-muted-foreground text-xs sm:text-sm truncate">
            {t("gallery.showing", { shown: filteredPoses.length, total: poses.length })}
          </p>
          <div className="flex items-center gap-1 bg-card rounded-lg border p-1 flex-shrink-0">
            <button
              onClick={() => void startTransition(() => setViewMode("grid"))}
              className={`p-2.5 rounded-md transition-colors min-h-[40px] min-w-[40px] flex items-center justify-center touch-manipulation ${
                viewMode === "grid" ? "bg-accent text-foreground" : "text-muted-foreground hover:text-foreground active:bg-accent/50"
              }`}
            >
              <Grid3X3 className="w-4 h-4" />
            </button>
            <button
              onClick={() => void startTransition(() => setViewMode("list"))}
              className={`p-2.5 rounded-md transition-colors min-h-[40px] min-w-[40px] flex items-center justify-center touch-manipulation ${
                viewMode === "list" ? "bg-accent text-foreground" : "text-muted-foreground hover:text-foreground active:bg-accent/50"
              }`}
            >
              <List className="w-4 h-4" />
            </button>
          </div>
        </div>

        {isLoading ? (
          viewMode === "grid" ? (
            <SkeletonGrid count={8} ItemSkeleton={PoseCardSkeleton} />
          ) : (
            <SkeletonList count={5} ItemSkeleton={ListItemSkeleton} />
          )
        ) : filteredPoses.length === 0 ? (
          <EmptyState
            variant={filters.search || filters.category !== "all" || filters.status !== "all" ? "search" : "poses"}
            title={t("gallery.no_poses")}
            description={t("gallery.adjust_filters")}
            action={
              poses.length === 0 ? (
                <Link to="/upload">
                  <Button className="bg-primary hover:bg-primary/90 text-primary-foreground">
                    <Plus className="w-4 h-4 mr-2" />
                    {t("gallery.new_pose")}
                  </Button>
                </Link>
              ) : undefined
            }
          />
        ) : (
          <AnimatePresence mode="wait">
            {viewMode === "grid" ? (
              /**
               * NOTE: Performance Consideration
               * For lists with 100+ items, consider implementing virtualization
               * using react-window or @tanstack/react-virtual to render only visible items.
               * Current implementation renders all items which can cause slowdown with large datasets.
               * Alternative: Implement server-side pagination with infinite scroll.
               * See: https://tanstack.com/virtual/latest
               */
              <motion.div
                key="grid"
                className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4 sm:gap-6 view-transition-results"
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -20 }}
                transition={{ duration: 0.3 }}
              >
                {filteredPoses.map((pose, index) => (
                  <motion.div
                    key={pose.id}
                    initial={{ opacity: 0, scale: 0.9 }}
                    animate={{ opacity: 1, scale: 1 }}
                    transition={{ delay: Math.min(index * 0.05, 0.3), duration: 0.2 }}
                  >
                    <PoseCard
                      pose={pose}
                      onView={handleViewPose}
                      onGenerate={() => setGeneratePose(pose)}
                    />
                  </motion.div>
                ))}
              </motion.div>
            ) : (
              <motion.div
                key="list"
                className="space-y-3 sm:space-y-4 view-transition-results"
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -20 }}
                transition={{ duration: 0.3 }}
              >
                {filteredPoses.map((pose, index) => (
                  <motion.div
                    key={pose.id}
                    className="flex items-center gap-3 sm:gap-4 p-3 sm:p-4 rounded-xl border bg-card hover:bg-accent active:bg-accent/80 transition-colors touch-manipulation"
                    initial={{ opacity: 0, x: -20 }}
                    animate={{ opacity: 1, x: 0 }}
                    transition={{ delay: Math.min(index * 0.03, 0.2), duration: 0.2 }}
                  >
                    <PoseImage
                      poseId={pose.id}
                      imageType={pose.photo_path ? "photo" : "schema"}
                      directPath={pose.photo_path || pose.schema_path}
                      alt={pose.name}
                      className="w-14 h-14 sm:w-16 sm:h-16 rounded-lg object-cover bg-muted flex-shrink-0"
                      fallbackSrc="/placeholder.jpg"
                      enabled={Boolean(pose.photo_path || pose.schema_path)}
                    />
                    <div className="flex-1 min-w-0">
                      <h3 className="font-semibold text-base sm:text-lg text-foreground truncate">{pose.name}</h3>
                      <p className="text-muted-foreground text-xs sm:text-sm truncate">#{pose.code} • {pose.category_name || t("pose.uncategorized")}</p>
                    </div>
                    <Button
                      variant="outline"
                      onClick={() => handleViewPose(pose)}
                      className="min-h-[44px] px-3 sm:px-4 text-sm touch-manipulation flex-shrink-0"
                    >
                      {t("pose.view")}
                    </Button>
                  </motion.div>
                ))}
              </motion.div>
            )}
          </AnimatePresence>
        )}
      </main>

      {selectedPose && (
        <PoseViewer pose={selectedPose} isOpen={!!selectedPose} onClose={handleCloseViewer} />
      )}

      {generatePose && (
        <GenerateModal
          pose={generatePose}
          isOpen={!!generatePose}
          onClose={handleCloseGenerateModal}
          onComplete={fetchData}
        />
      )}

      <ImportModal
        isOpen={isImportModalOpen}
        onClose={handleCloseImportModal}
        onImportComplete={handleImportComplete}
      />
    </div>
  );
};
