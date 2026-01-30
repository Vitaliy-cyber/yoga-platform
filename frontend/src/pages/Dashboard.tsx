import React, { useEffect, useMemo, useState, useCallback } from "react";
import { Link } from "react-router-dom";
import { motion, AnimatePresence } from "framer-motion";
import { Button } from "../components/ui/button";
import { PoseCard, PoseFilters, PoseViewer, GenerateModal, PoseImage } from "../components/Pose";
import { categoriesApi, posesApi } from "../services/api";
import { useViewTransition } from "../hooks/useViewTransition";
import { Plus, Grid3X3, List, Image, Loader2, Globe, AlertCircle, RefreshCw } from "lucide-react";
import type { Category, PoseListItem, Pose } from "../types";
import { useI18n } from "../i18n";
import { useAuthStore } from "../store/useAuthStore";

export const Dashboard: React.FC = () => {
  const [poses, setPoses] = useState<PoseListItem[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const { t, locale, setLocale } = useI18n();
  const { startTransition } = useViewTransition();
  const isAuthenticated = useAuthStore((state) => state.isAuthenticated);
  const [filters, setFilters] = useState({
    search: "",
    category: "all",
    status: "all",
  });
  const [selectedPose, setSelectedPose] = useState<Pose | null>(null);
  const [generatePose, setGeneratePose] = useState<PoseListItem | null>(null);
  const [viewMode, setViewMode] = useState<"grid" | "list">("grid");

  const fetchData = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const [posesData, categoriesData] = await Promise.all([
        posesApi.getAll(undefined, 0, 100),
        categoriesApi.getAll(),
      ]);
      setPoses(posesData);
      setCategories(categoriesData);
    } catch (err) {
      console.error(t("dashboard.fetch_failed"), err);
      const message = err instanceof Error ? err.message : t("dashboard.fetch_failed");
      setError(message);
    } finally {
      setIsLoading(false);
    }
  }, [t]);

  useEffect(() => {
    // Only fetch data if authenticated - prevents errors during redirect to login
    if (isAuthenticated) {
      fetchData();
    } else {
      // Not authenticated - will redirect soon, don't show loading
      setIsLoading(false);
    }
  }, [fetchData, isAuthenticated]);

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
    processing: 0,
  };

  const handleViewPose = useCallback(async (pose: PoseListItem) => {
    try {
      const fullPose = await posesApi.getById(pose.id);
      setSelectedPose(fullPose);
    } catch (error) {
      console.error(t("pose.load_failed"), error);
    }
  }, [t]);

  // Memoize callbacks passed to child components
  const handleCloseViewer = useCallback(() => setSelectedPose(null), []);
  const handleCloseGenerateModal = useCallback(() => setGeneratePose(null), []);

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
                onClick={() => void startTransition(() => setLocale(locale === "ua" ? "en" : "ua"))}
                className="flex items-center justify-center gap-1.5 sm:gap-2 px-2.5 sm:px-3 py-2 text-sm text-muted-foreground hover:text-foreground hover:bg-accent active:bg-accent/80 rounded-lg transition-colors min-h-[44px] min-w-[44px] touch-manipulation"
                title={t("app.language_toggle")}
                aria-label={t("app.language_toggle")}
              >
                <Globe className="w-4 h-4" />
                <span className="font-medium hidden sm:inline">{locale === "ua" ? "UA" : "EN"}</span>
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
            { label: t("dashboard.total"), value: stats.total, color: "bg-muted text-foreground" },
            { label: t("dashboard.complete"), value: stats.complete, color: "bg-emerald-50 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-400" },
            { label: t("dashboard.drafts"), value: stats.draft, color: "bg-amber-50 text-amber-700 dark:bg-amber-950 dark:text-amber-400" },
            { label: t("dashboard.processing"), value: stats.processing, color: "bg-blue-50 text-blue-700 dark:bg-blue-950 dark:text-blue-400" },
          ].map((stat, idx) => (
            <div
              key={stat.label}
              className={`${stat.color} rounded-xl sm:rounded-2xl p-3 sm:p-5 animate-fade-in`}
              style={{ animationDelay: `${idx * 50}ms` }}
            >
              <p className="text-2xl sm:text-3xl font-semibold">{stat.value}</p>
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
          <div className="flex items-center gap-1 bg-card rounded-lg border p-1 flex-shrink-0" role="group" aria-label={t("dashboard.view_mode")}>
            <button
              onClick={() => void startTransition(() => setViewMode("grid"))}
              className={`p-2.5 rounded-md transition-colors min-h-[40px] min-w-[40px] flex items-center justify-center touch-manipulation ${
                viewMode === "grid" ? "bg-accent text-foreground" : "text-muted-foreground hover:text-foreground active:bg-accent/50"
              }`}
              aria-label={t("dashboard.grid_view")}
              aria-pressed={viewMode === "grid"}
            >
              <Grid3X3 className="w-4 h-4" />
            </button>
            <button
              onClick={() => void startTransition(() => setViewMode("list"))}
              className={`p-2.5 rounded-md transition-colors min-h-[40px] min-w-[40px] flex items-center justify-center touch-manipulation ${
                viewMode === "list" ? "bg-accent text-foreground" : "text-muted-foreground hover:text-foreground active:bg-accent/50"
              }`}
              aria-label={t("dashboard.list_view")}
              aria-pressed={viewMode === "list"}
            >
              <List className="w-4 h-4" />
            </button>
          </div>
        </div>

        {isLoading ? (
          <div className="flex items-center justify-center py-20">
            <Loader2 className="w-8 h-8 text-muted-foreground animate-spin" />
          </div>
        ) : error ? (
          <div className="text-center py-20">
            <div className="w-20 h-20 rounded-full bg-red-50 dark:bg-red-950 flex items-center justify-center mx-auto mb-4">
              <AlertCircle className="w-10 h-10 text-red-400" />
            </div>
            <h3 className="text-lg font-medium text-foreground mb-2">{t("dashboard.error_title")}</h3>
            <p className="text-muted-foreground mb-6 max-w-md mx-auto">{error}</p>
            <Button onClick={fetchData} className="bg-primary hover:bg-primary/90">
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
          <AnimatePresence mode="wait">
            {viewMode === "grid" ? (
              // TODO: Performance - For lists with 100+ items, consider implementing virtualization
              // using react-window or @tanstack/react-virtual to render only visible items.
              // Current implementation renders all items which can cause slowdown with large datasets.
              // Alternative: Implement server-side pagination with infinite scroll.
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
    </div>
  );
};
