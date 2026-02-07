import React, {
  useEffect,
  useMemo,
  useState,
  useRef,
  useCallback,
} from "react";
import { useSearchParams, Link } from "react-router-dom";
import {
  PoseCard,
  PoseFilters,
  PoseViewer,
  GenerateModal,
  PoseImage,
} from "../components/Pose";
import { categoriesApi, posesApi } from "../services/api";
import { Button } from "../components/ui/button";
import { Grid3X3, List, Plus, Upload } from "lucide-react";
import type { Category, PoseListItem, Pose, ImportResult } from "../types";
import { useI18n } from "../i18n";
import { ExportMenu, ImportModal } from "../components/ExportImport";
import {
  SkeletonGrid,
  SkeletonList,
  PoseCardSkeleton,
  ListItemSkeleton,
} from "../components/ui/skeleton";
import { EmptyState } from "../components/ui/empty-state";
import { logger } from "../lib/logger";
import { MAX_POSES_PER_REQUEST } from "../lib/constants";
import { useGenerationStore } from "../store/useGenerationStore";

const POSE_GALLERY_CACHE_TTL_MS = 30_000;

type PoseGalleryCacheEntry = {
  poses: PoseListItem[];
  categories: Category[];
  cachedAt: number;
};

const poseGalleryCache = new Map<string, PoseGalleryCacheEntry>();

const getPoseGalleryCacheKey = (categoryId?: number): string =>
  categoryId ? `category:${categoryId}` : "category:all";

const getPoseGalleryCacheEntry = (
  cacheKey: string,
): PoseGalleryCacheEntry | null => {
  const entry = poseGalleryCache.get(cacheKey);
  if (!entry) return null;
  if (Date.now() - entry.cachedAt > POSE_GALLERY_CACHE_TTL_MS) {
    poseGalleryCache.delete(cacheKey);
    return null;
  }
  return entry;
};

const setPoseGalleryCacheEntry = (
  cacheKey: string,
  poses: PoseListItem[],
  categories: Category[],
) => {
  poseGalleryCache.set(cacheKey, {
    poses,
    categories,
    cachedAt: Date.now(),
  });
};

const useAnimatedInteger = (value: number, durationMs = 700): number => {
  const [displayValue, setDisplayValue] = useState(0);
  const displayRef = useRef(0);
  const rafRef = useRef<number | null>(null);

  useEffect(() => {
    const startValue = displayRef.current;
    const endValue = value;

    if (startValue === endValue) return;

    if (durationMs <= 0) {
      displayRef.current = endValue;
      setDisplayValue(endValue);
      return;
    }

    const startTime = performance.now();
    const delta = endValue - startValue;

    const tick = (now: number) => {
      const progress = Math.min((now - startTime) / durationMs, 1);
      const eased = 1 - Math.pow(1 - progress, 3);
      const next = startValue + delta * eased;
      const rounded = delta >= 0 ? Math.floor(next) : Math.ceil(next);
      const finalValue = progress >= 1 ? endValue : rounded;

      if (displayRef.current !== finalValue) {
        displayRef.current = finalValue;
        setDisplayValue(finalValue);
      }

      if (progress < 1) {
        rafRef.current = window.requestAnimationFrame(tick);
      } else {
        rafRef.current = null;
      }
    };

    rafRef.current = window.requestAnimationFrame(tick);

    return () => {
      if (rafRef.current !== null) {
        window.cancelAnimationFrame(rafRef.current);
        rafRef.current = null;
      }
    };
  }, [value, durationMs]);

  return displayValue;
};

export const PoseGallery: React.FC = () => {
  const [searchParams, setSearchParams] = useSearchParams();
  const categoryIdParam = searchParams.get("category");
  const categoryId = categoryIdParam
    ? parseInt(categoryIdParam, 10)
    : undefined;
  const cacheKey = useMemo(
    () => getPoseGalleryCacheKey(categoryId),
    [categoryId],
  );
  const initialCache = useMemo(
    () => getPoseGalleryCacheEntry(cacheKey),
    [cacheKey],
  );

  const [poses, setPoses] = useState<PoseListItem[]>(
    () => initialCache?.poses ?? [],
  );
  const [categories, setCategories] = useState<Category[]>(
    () => initialCache?.categories ?? [],
  );
  const [isLoading, setIsLoading] = useState(() => !initialCache);
  const { t } = useI18n();
  const hasRenderableDataRef = useRef(Boolean(initialCache));
  const [viewMode, setViewMode] = useState<"grid" | "list">("grid");
  const [filters, setFilters] = useState({
    search: "",
    category: categoryId ? String(categoryId) : "all",
    status: "all",
  });
  const [selectedPose, setSelectedPose] = useState<Pose | null>(null);
  const [generatePose, setGeneratePose] = useState<PoseListItem | null>(null);
  const [isImportModalOpen, setIsImportModalOpen] = useState(false);
  const lastAppliedAt = useGenerationStore(
    useCallback((state) => {
      let latest = 0;
      for (const taskId of state.taskOrder) {
        const task = state.tasks[taskId];
        if (!task || task.dismissedAt || !task.appliedAt) continue;
        if (task.appliedAt > latest) {
          latest = task.appliedAt;
        }
      }
      return latest;
    }, []),
  );

  // AbortController ref for request cancellation
  const abortControllerRef = useRef<AbortController | null>(null);

  const fetchData = useCallback(async (options?: { background?: boolean }) => {
    // Cancel any in-flight request
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
    }

    // Create new abort controller for this request
    const abortController = new AbortController();
    abortControllerRef.current = abortController;

    const hadRenderableData = hasRenderableDataRef.current;
    const useBackgroundLoading = options?.background ?? hadRenderableData;
    if (!useBackgroundLoading) {
      setIsLoading(true);
    }
    try {
      const [posesData, categoriesData] = await Promise.all([
        posesApi.getAll(
          categoryId,
          0,
          MAX_POSES_PER_REQUEST,
          abortController.signal,
        ),
        categoriesApi.getAll(abortController.signal),
      ]);
      if (!abortController.signal.aborted) {
        setPoses(posesData);
        setCategories(categoriesData);
        hasRenderableDataRef.current = true;
        setPoseGalleryCacheEntry(cacheKey, posesData, categoriesData);
        // Ensure loader exits even when this request was started as background
        // after an aborted foreground request.
        setIsLoading(false);
      }
    } catch (error) {
      // Ignore aborted requests
      if (error instanceof Error && error.name === "AbortError") {
        return;
      }
      if (!abortController.signal.aborted) {
        logger.error("Failed to fetch poses data:", error);
        // Avoid permanent skeleton state on non-aborted failures.
        setIsLoading(false);
      }
    } finally {
      if (!abortController.signal.aborted && !useBackgroundLoading) {
        setIsLoading(false);
      }
    }
  }, [cacheKey, categoryId]);

  useEffect(() => {
    const cached = getPoseGalleryCacheEntry(cacheKey);
    if (cached) {
      setPoses(cached.poses);
      setCategories(cached.categories);
      setIsLoading(false);
      hasRenderableDataRef.current = true;
    }

    void fetchData({ background: hasRenderableDataRef.current });

    // Cleanup: abort request on unmount or when categoryId changes
    return () => {
      if (abortControllerRef.current) {
        abortControllerRef.current.abort();
      }
    };
  }, [cacheKey, fetchData]);

  useEffect(() => {
    if (!lastAppliedAt) return;
    void fetchData({ background: true });
  }, [lastAppliedAt, fetchData]);

  useEffect(() => {
    if (categoryId) {
      setFilters((prev) => ({ ...prev, category: String(categoryId) }));
    }
  }, [categoryId]);

  const poseStatus = (pose: PoseListItem) =>
    pose.photo_path ? "complete" : "draft";

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

  const totalPoses = poses.length;
  const totalCategories = categories.length;
  const animatedPoseCount = useAnimatedInteger(totalPoses);
  const animatedCategoryCount = useAnimatedInteger(totalCategories);

  const handleCategoryFilter = (nextFilters: typeof filters) => {
    setFilters(nextFilters);
    if (nextFilters.category === "all") {
      setSearchParams({});
    } else {
      setSearchParams({ category: nextFilters.category });
    }
  };

  const handleViewPose = useCallback(
    async (pose: PoseListItem) => {
      try {
        const fullPose = await posesApi.getById(pose.id);
        setSelectedPose(fullPose);
      } catch (error) {
        logger.error(t("pose.load_failed"), error);
      }
    },
    [t],
  );

  const handleImportComplete = useCallback(
    (result: ImportResult) => {
      if (result.created > 0 || result.updated > 0) {
        void fetchData({ background: true }); // Refresh data after successful import
      }
    },
    [fetchData],
  );

  // Memoize callbacks passed to child components
  const handleCloseViewer = useCallback(() => setSelectedPose(null), []);
  const handleCloseGenerateModal = useCallback(() => setGeneratePose(null), []);
  const handleCloseImportModal = useCallback(
    () => setIsImportModalOpen(false),
    [],
  );
  const handleOpenImportModal = useCallback(
    () => setIsImportModalOpen(true),
    [],
  );

  return (
    <div className="min-h-screen bg-background">
      <header className="bg-card border-b sticky top-0 z-40">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 py-3 sm:py-4 flex items-center justify-between gap-3">
          <div className="min-w-0 flex-1">
            <h1 className="text-xl sm:text-2xl font-semibold text-foreground truncate">
              {t("gallery.title")}
            </h1>
            <p className="text-muted-foreground text-xs sm:text-sm mt-0.5 truncate tabular-nums">
              {t("gallery.summary", {
                poses: animatedPoseCount,
                categories: animatedCategoryCount,
              })}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <ExportMenu
              categoryId={categoryId}
              onError={(err) => logger.error("Export failed:", err)}
            />
            <Button
              variant="outline"
              size="sm"
              onClick={handleOpenImportModal}
              className="gap-2"
              data-testid="import-open"
            >
              <Upload className="h-4 w-4" />
              <span className="hidden sm:inline">{t("import.title")}</span>
            </Button>
            <Link to="/upload">
              <Button className="bg-primary hover:bg-primary/90 active:bg-primary/80 text-primary-foreground rounded-xl h-10 sm:h-11 px-3 sm:px-5 min-h-[44px] touch-manipulation flex-shrink-0">
                <Plus className="w-4 h-4 sm:mr-2" />
                <span className="hidden sm:inline">
                  {t("gallery.new_pose")}
                </span>
              </Button>
            </Link>
          </div>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-4 sm:px-6 py-4 sm:py-8">
        <div className="mb-4 sm:mb-6">
          <PoseFilters
            filters={filters}
            categories={categories}
            onFilterChange={handleCategoryFilter}
          />
        </div>

        <div className="flex items-center justify-between mb-4 sm:mb-6 gap-2">
          <p
            className="text-muted-foreground text-xs sm:text-sm truncate"
            data-testid="pose-gallery-count"
          >
            {t("gallery.showing", {
              shown: filteredPoses.length,
              total: poses.length,
            })}
          </p>
          <div
            className="relative grid grid-cols-2 items-center gap-1 bg-card rounded-lg border p-1 flex-shrink-0"
            role="group"
            aria-label={t("dashboard.view_mode")}
          >
            <span
              aria-hidden="true"
              className={`pointer-events-none absolute top-1 bottom-1 left-1 w-[calc(50%-0.375rem)] rounded-md bg-accent shadow-sm transition-transform duration-200 ease-out ${
                viewMode === "list"
                  ? "translate-x-[calc(100%+0.25rem)]"
                  : "translate-x-0"
              }`}
            />
            <button
              data-testid="pose-gallery-view-grid"
              onClick={() => setViewMode("grid")}
              className={`relative z-10 p-2.5 rounded-md transition-[color,transform] duration-200 ease-out min-h-[40px] min-w-[40px] flex items-center justify-center touch-manipulation ${
                viewMode === "grid"
                  ? "text-foreground scale-100"
                  : "text-muted-foreground hover:text-foreground active:scale-95"
              }`}
              aria-pressed={viewMode === "grid"}
              aria-label={t("dashboard.grid_view")}
            >
              <Grid3X3
                className={`w-4 h-4 transition-transform duration-200 ease-out ${
                  viewMode === "grid" ? "scale-100" : "scale-95"
                }`}
              />
            </button>
            <button
              data-testid="pose-gallery-view-list"
              onClick={() => setViewMode("list")}
              className={`relative z-10 p-2.5 rounded-md transition-[color,transform] duration-200 ease-out min-h-[40px] min-w-[40px] flex items-center justify-center touch-manipulation ${
                viewMode === "list"
                  ? "text-foreground scale-100"
                  : "text-muted-foreground hover:text-foreground active:scale-95"
              }`}
              aria-pressed={viewMode === "list"}
              aria-label={t("dashboard.list_view")}
            >
              <List
                className={`w-4 h-4 transition-transform duration-200 ease-out ${
                  viewMode === "list" ? "scale-100" : "scale-95"
                }`}
              />
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
            variant={
              filters.search ||
              filters.category !== "all" ||
              filters.status !== "all"
                ? "search"
                : "poses"
            }
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
          <>
            {viewMode === "grid" ? (
              /**
               * NOTE: Performance Consideration
               * For lists with 100+ items, consider implementing virtualization
               * using react-window or @tanstack/react-virtual to render only visible items.
               * Current implementation renders all items which can cause slowdown with large datasets.
               * Alternative: Implement server-side pagination with infinite scroll.
               * See: https://tanstack.com/virtual/latest
               */
              <div
                key="grid"
                className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4 sm:gap-6"
              >
                {filteredPoses.map((pose) => (
                  <div key={pose.id}>
                    <PoseCard
                      pose={pose}
                      onView={handleViewPose}
                      onGenerate={() => setGeneratePose(pose)}
                    />
                  </div>
                ))}
              </div>
            ) : (
              <div
                key="list"
                className="space-y-3 sm:space-y-4"
              >
                {filteredPoses.map((pose) => (
                  <div
                    key={pose.id}
                    className="flex items-center gap-3 sm:gap-4 p-3 sm:p-4 rounded-xl border bg-card hover:bg-accent active:bg-accent/80 transition-colors touch-manipulation"
                  >
                    <PoseImage
                      poseId={pose.id}
                      imageType={pose.photo_path ? "photo" : "schema"}
                      directPath={pose.photo_path || pose.schema_path}
                      alt=""
                      className="w-14 h-14 sm:w-16 sm:h-16 rounded-lg object-cover bg-muted flex-shrink-0"
                      fallbackSrc="/placeholder.jpg"
                      enabled={Boolean(pose.photo_path || pose.schema_path)}
                    />
                    <div className="flex-1 min-w-0">
                      <h3 className="font-semibold text-base sm:text-lg text-foreground truncate">
                        {pose.name}
                      </h3>
                      <p className="text-muted-foreground text-xs sm:text-sm truncate">
                        #{pose.code} •{" "}
                        {pose.category_name || t("pose.uncategorized")}
                      </p>
                    </div>
                    <Button
                      variant="outline"
                      onClick={() => handleViewPose(pose)}
                      className="min-h-[44px] px-3 sm:px-4 text-sm touch-manipulation flex-shrink-0"
                    >
                      {t("pose.view")}
                    </Button>
                  </div>
                ))}
              </div>
            )}
          </>
        )}
      </main>

      {selectedPose && (
        <PoseViewer
          pose={selectedPose}
          isOpen={!!selectedPose}
          onClose={handleCloseViewer}
        />
      )}

      {generatePose && (
        <GenerateModal
          pose={generatePose}
          isOpen={!!generatePose}
          onClose={handleCloseGenerateModal}
          onComplete={() => void fetchData({ background: true })}
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
