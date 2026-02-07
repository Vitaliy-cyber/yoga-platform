import React, { useEffect, useMemo, useState, useCallback, useRef } from "react";
import { Link } from "react-router-dom";
import { Button } from "../components/ui/button";
import { PoseCard, PoseFilters, PoseViewer, GenerateModal, PoseImage } from "../components/Pose";
import { SkeletonGrid, SkeletonList, PoseCardSkeleton, ListItemSkeleton } from "../components/ui/skeleton";
import { categoriesApi, posesApi } from "../services/api";
import { Plus, Grid3X3, List, Image, Globe, AlertCircle, RefreshCw } from "lucide-react";
import type { Category, PoseListItem, Pose } from "../types";
import { useI18n } from "../i18n";
import { useAuthStore } from "../store/useAuthStore";
import { useGenerationStore } from "../store/useGenerationStore";

const DASHBOARD_CACHE_TTL_MS = 30_000;

type DashboardCacheEntry = {
  poses: PoseListItem[];
  categories: Category[];
  cachedAt: number;
};

let dashboardCacheEntry: DashboardCacheEntry | null = null;

const getDashboardCacheEntry = (): DashboardCacheEntry | null => {
  if (!dashboardCacheEntry) return null;
  if (Date.now() - dashboardCacheEntry.cachedAt > DASHBOARD_CACHE_TTL_MS) {
    dashboardCacheEntry = null;
    return null;
  }
  return dashboardCacheEntry;
};

const setDashboardCacheEntry = (
  poses: PoseListItem[],
  categories: Category[],
) => {
  dashboardCacheEntry = {
    poses,
    categories,
    cachedAt: Date.now(),
  };
};

const AnimatedCounter: React.FC<{
  value: number;
  durationMs?: number;
  delayMs?: number;
}> = ({
  value,
  durationMs = 750,
  delayMs = 0,
}) => {
  const [displayValue, setDisplayValue] = useState(0);
  const displayRef = useRef(0);
  const rafRef = useRef<number | null>(null);
  const timerRef = useRef<number | null>(null);

  useEffect(() => {
    const startValue = displayRef.current;
    const endValue = value;

    if (startValue === endValue) {
      return;
    }

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

    const start = () => {
      rafRef.current = window.requestAnimationFrame(tick);
    };

    if (delayMs > 0) {
      timerRef.current = window.setTimeout(() => {
        timerRef.current = null;
        start();
      }, delayMs);
    } else {
      start();
    }

    return () => {
      if (timerRef.current !== null) {
        window.clearTimeout(timerRef.current);
        timerRef.current = null;
      }
      if (rafRef.current !== null) {
        window.cancelAnimationFrame(rafRef.current);
        rafRef.current = null;
      }
    };
  }, [value, durationMs, delayMs]);

  return <>{displayValue}</>;
};

export const Dashboard: React.FC = () => {
  const initialCache = useMemo(() => getDashboardCacheEntry(), []);
  const [poses, setPoses] = useState<PoseListItem[]>(
    () => initialCache?.poses ?? [],
  );
  const [categories, setCategories] = useState<Category[]>(
    () => initialCache?.categories ?? [],
  );
  const [isLoading, setIsLoading] = useState(() => !initialCache);
  const [error, setError] = useState<string | null>(null);
  const { t, locale, setLocale } = useI18n();
  const isAuthenticated = useAuthStore((state) => state.isAuthenticated);
  const hasRenderableDataRef = useRef(Boolean(initialCache));
  const [filters, setFilters] = useState({
    search: "",
    category: "all",
    status: "all",
  });
  const [isLanguageIconFlipped, setIsLanguageIconFlipped] = useState(false);
  const [selectedPose, setSelectedPose] = useState<Pose | null>(null);
  const [generatePose, setGeneratePose] = useState<PoseListItem | null>(null);
  const [viewMode, setViewMode] = useState<"grid" | "list">("grid");
  const generationStats = useGenerationStore(
    useCallback((state) => {
      let active = 0;
      let latestAppliedAt = 0;

      for (const taskId of state.taskOrder) {
        const task = state.tasks[taskId];
        if (!task || task.dismissedAt) continue;
        if (
          task.status === "pending" ||
          task.status === "processing" ||
          task.autoApplyStatus === "applying"
        ) {
          active += 1;
        }
        if (task.appliedAt && task.appliedAt > latestAppliedAt) {
          latestAppliedAt = task.appliedAt;
        }
      }

      return { active, latestAppliedAt };
    }, []),
  );

  const fetchData = useCallback(async (options?: { background?: boolean }) => {
    const hadRenderableData = hasRenderableDataRef.current;
    const useBackgroundLoading = options?.background ?? hadRenderableData;
    if (!useBackgroundLoading) {
      setIsLoading(true);
    }
    setError(null);
    try {
      const [posesData, categoriesData] = await Promise.all([
        posesApi.getAll(undefined, 0, 100),
        categoriesApi.getAll(),
      ]);
      setPoses(posesData);
      setCategories(categoriesData);
      hasRenderableDataRef.current = true;
      setDashboardCacheEntry(posesData, categoriesData);
      // Always end visible loading once we have renderable data.
      setIsLoading(false);
    } catch (err) {
      console.error("Failed to fetch dashboard data", err);
      if (!hadRenderableData) {
        const message =
          err instanceof Error ? err.message : "Failed to fetch dashboard data";
        setError(message);
      }
      setIsLoading(false);
    } finally {
      if (!useBackgroundLoading) {
        setIsLoading(false);
      }
    }
  }, []);

  useEffect(() => {
    // Only fetch data if authenticated - prevents errors during redirect to login
    if (isAuthenticated) {
      void fetchData({ background: hasRenderableDataRef.current });
    } else {
      // Not authenticated - will redirect soon, don't show loading
      setIsLoading(false);
    }
  }, [fetchData, isAuthenticated]);

  useEffect(() => {
    if (!generationStats.latestAppliedAt) return;
    if (!isAuthenticated) return;
    void fetchData({ background: true });
  }, [fetchData, generationStats.latestAppliedAt, isAuthenticated]);

  const poseStatus = useCallback((pose: PoseListItem) => (pose.photo_path ? "complete" : "draft"), []);

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

  const stats = {
    total: poses.length,
    complete: poses.filter((pose) => pose.photo_path).length,
    draft: poses.filter((pose) => !pose.photo_path).length,
    processing: generationStats.active,
  };

  const handleViewPose = useCallback(async (pose: PoseListItem) => {
    try {
      const fullPose = await posesApi.getById(pose.id);
      setSelectedPose(fullPose);
    } catch (error) {
      console.error("Failed to load pose", error);
    }
  }, []);

  // Memoize callbacks passed to child components
  const handleCloseViewer = useCallback(() => setSelectedPose(null), []);
  const handleCloseGenerateModal = useCallback(() => setGeneratePose(null), []);
  const handleLanguageToggle = useCallback(() => {
    setIsLanguageIconFlipped((prev) => !prev);
    setLocale(locale === "ua" ? "en" : "ua");
  }, [locale, setLocale]);

  return (
    <div className="min-h-screen bg-background">
      <header className="bg-card border-b sticky top-0 z-40">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 py-3 sm:py-4">
          <div className="flex items-center justify-between gap-3">
            <div className="min-w-0 flex-1">
              <h1 className="text-xl sm:text-2xl font-semibold text-foreground truncate">{t("app.name")}</h1>
              <p className="text-muted-foreground text-xs sm:text-sm mt-0.5 truncate">
                {t("app.tagline")}
              </p>
            </div>
            <div className="flex items-center gap-2 sm:gap-3 flex-shrink-0">
              <button
                onClick={handleLanguageToggle}
                className="flex items-center justify-center gap-1.5 sm:gap-2 px-2.5 sm:px-3 py-2 text-sm text-muted-foreground hover:text-foreground hover:bg-accent active:bg-accent/80 rounded-lg transition-colors min-h-[44px] min-w-[44px] touch-manipulation"
                title={t("app.language_toggle")}
                aria-label={t("app.language_toggle")}
              >
                <span
                  className={`inline-flex transition-transform duration-300 ease-out ${
                    isLanguageIconFlipped
                      ? "rotate-180 scale-110"
                      : "rotate-0 scale-100"
                  }`}
                >
                  <Globe className="w-4 h-4" />
                </span>
                <span
                  key={`locale-${locale}`}
                  className="font-medium hidden sm:inline tabular-nums animate-language-toggle-label"
                >
                  {locale === "ua" ? "UA" : "EN"}
                </span>
              </button>
              <Link to="/upload">
                <Button className="bg-primary hover:bg-primary/90 active:bg-primary/80 text-primary-foreground rounded-xl h-10 sm:h-11 px-3 sm:px-5 min-h-[44px] touch-manipulation">
                  <Plus className="w-4 h-4 sm:mr-2" />
                  <span className="hidden sm:inline">{t("dashboard.new_pose")}</span>
                </Button>
              </Link>
            </div>
          </div>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-4 sm:px-6 py-4 sm:py-8">
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 sm:gap-4 mb-6 sm:mb-8">
          {[
            {
              id: "total",
              label: t("dashboard.total"),
              value: stats.total,
              color: "bg-muted text-foreground",
            },
            {
              id: "complete",
              label: t("dashboard.complete"),
              value: stats.complete,
              color:
                "bg-emerald-50 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-400",
            },
            {
              id: "draft",
              label: t("dashboard.drafts"),
              value: stats.draft,
              color:
                "bg-amber-50 text-amber-700 dark:bg-amber-950 dark:text-amber-400",
            },
            {
              id: "processing",
              label: t("dashboard.processing"),
              value: stats.processing,
              color:
                "bg-blue-50 text-blue-700 dark:bg-blue-950 dark:text-blue-400",
            },
          ].map((stat, idx) => (
            <div
              key={stat.id}
              className={`${stat.color} rounded-xl sm:rounded-2xl p-3 sm:p-5`}
              style={{ animationDelay: `${idx * 50}ms` }}
            >
              <p className="text-2xl sm:text-3xl font-semibold tabular-nums">
                <AnimatedCounter value={stat.value} delayMs={idx * 90} />
              </p>
              <p className="text-xs sm:text-sm opacity-80 mt-0.5 sm:mt-1">{stat.label}</p>
            </div>
          ))}
        </div>

        <div className="mb-4 sm:mb-6">
          <PoseFilters
            filters={filters}
            categories={categories}
            onFilterChange={setFilters}
          />
        </div>

        <div className="flex items-center justify-between mb-4 sm:mb-6 gap-2">
          <p className="text-muted-foreground text-xs sm:text-sm truncate">
            {t("dashboard.showing", { shown: filteredPoses.length, total: poses.length })}
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
              data-testid="dashboard-view-grid"
              onClick={() => setViewMode("grid")}
              className={`relative z-10 p-2.5 rounded-md transition-[color,transform] duration-200 ease-out min-h-[40px] min-w-[40px] flex items-center justify-center touch-manipulation ${
                viewMode === "grid"
                  ? "text-foreground scale-100"
                  : "text-muted-foreground hover:text-foreground active:scale-95"
              }`}
              aria-label={t("dashboard.grid_view")}
              aria-pressed={viewMode === "grid"}
            >
              <Grid3X3
                className={`w-4 h-4 transition-transform duration-200 ease-out ${
                  viewMode === "grid" ? "scale-100" : "scale-95"
                }`}
              />
            </button>
            <button
              data-testid="dashboard-view-list"
              onClick={() => setViewMode("list")}
              className={`relative z-10 p-2.5 rounded-md transition-[color,transform] duration-200 ease-out min-h-[40px] min-w-[40px] flex items-center justify-center touch-manipulation ${
                viewMode === "list"
                  ? "text-foreground scale-100"
                  : "text-muted-foreground hover:text-foreground active:scale-95"
              }`}
              aria-label={t("dashboard.list_view")}
              aria-pressed={viewMode === "list"}
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
        ) : error ? (
          <div className="text-center py-20">
            <div className="w-20 h-20 rounded-full bg-red-50 dark:bg-red-950 flex items-center justify-center mx-auto mb-4">
              <AlertCircle className="w-10 h-10 text-red-400" />
            </div>
            <h3 className="text-lg font-medium text-foreground mb-2">{t("dashboard.error_title")}</h3>
            <p className="text-muted-foreground mb-6 max-w-md mx-auto">{error}</p>
            <Button
              onClick={() => void fetchData({ background: false })}
              className="bg-primary hover:bg-primary/90"
              data-testid="dashboard-retry"
            >
              <RefreshCw className="w-4 h-4 mr-2" />
              {t("dashboard.retry")}
            </Button>
          </div>
        ) : filteredPoses.length === 0 ? (
          <div className="text-center py-20">
            <div className="w-20 h-20 rounded-full bg-muted flex items-center justify-center mx-auto mb-4">
              <Image className="w-10 h-10 text-muted-foreground" />
            </div>
            <h3 className="text-lg font-medium text-foreground mb-2">{t("dashboard.no_poses")}</h3>
            <p className="text-muted-foreground mb-6">
              {poses.length === 0 ? t("dashboard.no_poses_hint") : t("dashboard.adjust_filters")}
            </p>
            {poses.length === 0 && (
              <Link to="/upload">
                <Button className="bg-primary hover:bg-primary/90">
                  <Plus className="w-4 h-4 mr-2" />
                  {t("dashboard.create_first")}
                </Button>
              </Link>
            )}
          </div>
        ) : (
          <>
            {viewMode === "grid" ? (
              // TODO: Performance - For lists with 100+ items, consider implementing virtualization
              // using react-window or @tanstack/react-virtual to render only visible items.
              // Current implementation renders all items which can cause slowdown with large datasets.
              // Alternative: Implement server-side pagination with infinite scroll.
              <div
                key="grid"
                className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4 sm:gap-6"
              >
                {filteredPoses.map((pose) => (
                  <div
                    key={pose.id}
                  >
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
                  </div>
                ))}
              </div>
            )}
          </>
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
          onComplete={() => void fetchData({ background: true })}
        />
      )}
    </div>
  );
};
