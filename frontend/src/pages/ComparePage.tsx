import React, { useEffect, useState, useRef } from "react";
import { useSearchParams, useNavigate, Link } from "react-router-dom";
import { motion, AnimatePresence } from "framer-motion";
import {
  ArrowLeft,
  Loader2,
  AlertCircle,
  GitCompareArrows,
  Layers,
  Image as ImageIcon,
  X,
  ChevronLeft,
  ChevronRight,
} from "lucide-react";
import { Button } from "../components/ui/button";
import { Badge } from "../components/ui/badge";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "../components/ui/tabs";
import { ErrorBoundary } from "../components/ui/error-boundary";
import { MuscleComparisonChart } from "../components/Compare/MuscleComparisonChart";
import { useCompareStore } from "../store/useCompareStore";
import { compareApi, getImageUrl } from "../services/api";
import { useViewTransition } from "../hooks/useViewTransition";
import { useI18n } from "../i18n";
import type { ComparisonResult, PoseComparisonItem } from "../types";

// Color palette matching MuscleComparisonChart
const POSE_COLORS = [
  { ring: "ring-indigo-500", bg: "bg-indigo-500", text: "text-indigo-600", badge: "bg-indigo-100 text-indigo-700" },
  { ring: "ring-emerald-500", bg: "bg-emerald-500", text: "text-emerald-600", badge: "bg-emerald-100 text-emerald-700" },
  { ring: "ring-amber-500", bg: "bg-amber-500", text: "text-amber-600", badge: "bg-amber-100 text-amber-700" },
  { ring: "ring-rose-500", bg: "bg-rose-500", text: "text-rose-600", badge: "bg-rose-100 text-rose-700" },
];

// Image comparison slider component
interface ImageComparisonSliderProps {
  leftImage: string;
  rightImage: string;
  leftLabel?: string;
  rightLabel?: string;
}

const ImageComparisonSlider: React.FC<ImageComparisonSliderProps> = ({
  leftImage,
  rightImage,
  leftLabel,
  rightLabel,
}) => {
  const { t } = useI18n();
  const [sliderPosition, setSliderPosition] = useState(50);
  const containerRef = useRef<HTMLDivElement>(null);
  const isDragging = useRef(false);

  const handleMouseDown = () => {
    isDragging.current = true;
  };

  const handleMouseMove = (e: React.MouseEvent) => {
    if (!isDragging.current || !containerRef.current) return;

    const rect = containerRef.current.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const percentage = Math.max(0, Math.min(100, (x / rect.width) * 100));
    setSliderPosition(percentage);
  };

  const handleTouchMove = (e: React.TouchEvent) => {
    if (!containerRef.current) return;

    const rect = containerRef.current.getBoundingClientRect();
    const x = e.touches[0].clientX - rect.left;
    const percentage = Math.max(0, Math.min(100, (x / rect.width) * 100));
    setSliderPosition(percentage);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    const step = e.shiftKey ? 10 : 1;
    switch (e.key) {
      case "ArrowLeft":
        e.preventDefault();
        setSliderPosition((prev) => Math.max(0, prev - step));
        break;
      case "ArrowRight":
        e.preventDefault();
        setSliderPosition((prev) => Math.min(100, prev + step));
        break;
      case "Home":
        e.preventDefault();
        setSliderPosition(0);
        break;
      case "End":
        e.preventDefault();
        setSliderPosition(100);
        break;
    }
  };

  useEffect(() => {
    const handleGlobalMouseUp = () => {
      isDragging.current = false;
    };

    window.addEventListener("mouseup", handleGlobalMouseUp);
    return () => window.removeEventListener("mouseup", handleGlobalMouseUp);
  }, []);

  return (
    <div
      ref={containerRef}
      className="relative w-full aspect-[4/3] overflow-hidden rounded-xl bg-muted select-none cursor-ew-resize"
      onMouseMove={handleMouseMove}
      onTouchMove={handleTouchMove}
      tabIndex={0}
      role="slider"
      aria-label={t("compare.slider_aria_label")}
      aria-valuenow={Math.round(sliderPosition)}
      aria-valuemin={0}
      aria-valuemax={100}
      onKeyDown={handleKeyDown}
    >
      {/* Right image (full width) */}
      <img
        src={rightImage}
        alt={rightLabel || "Right"}
        className="absolute inset-0 w-full h-full object-cover"
        draggable={false}
      />

      {/* Left image (clipped) */}
      <div
        className="absolute inset-0 overflow-hidden"
        style={{ width: `${sliderPosition}%` }}
      >
        <img
          src={leftImage}
          alt={leftLabel || "Left"}
          className="absolute inset-0 w-full h-full object-cover"
          style={{ width: `${100 / (sliderPosition / 100)}%`, maxWidth: "none" }}
          draggable={false}
        />
      </div>

      {/* Slider handle */}
      <div
        className="absolute top-0 bottom-0 w-1 bg-white shadow-lg cursor-ew-resize"
        style={{ left: `${sliderPosition}%`, transform: "translateX(-50%)" }}
        onMouseDown={handleMouseDown}
        onTouchStart={handleMouseDown}
      >
        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-8 h-8 bg-white rounded-full shadow-lg flex items-center justify-center">
          <ChevronLeft className="w-3 h-3 text-muted-foreground -mr-1" />
          <ChevronRight className="w-3 h-3 text-muted-foreground -ml-1" />
        </div>
      </div>

      {/* Labels */}
      {leftLabel && (
        <div className="absolute top-3 left-3 px-2 py-1 bg-black/60 text-white text-xs rounded">
          {leftLabel}
        </div>
      )}
      {rightLabel && (
        <div className="absolute top-3 right-3 px-2 py-1 bg-black/60 text-white text-xs rounded">
          {rightLabel}
        </div>
      )}
    </div>
  );
};

// Venn diagram component for common/unique muscles
interface VennDiagramProps {
  poses: PoseComparisonItem[];
  commonMuscles: string[];
  uniqueMuscles: Record<number, string[]>;
}

const VennDiagram: React.FC<VennDiagramProps> = ({
  poses,
  commonMuscles,
  uniqueMuscles,
}) => {
  const { t } = useI18n();

  // Check if ALL poses have zero muscles (empty data state)
  const totalUniqueCount = Object.values(uniqueMuscles).flat().length;
  const hasNoMuscleData = commonMuscles.length === 0 && totalUniqueCount === 0;

  if (hasNoMuscleData) {
    return (
      <div className="text-center py-12">
        <div className="w-16 h-16 mx-auto mb-4 rounded-full bg-muted flex items-center justify-center">
          <AlertCircle className="w-8 h-8 text-muted-foreground" />
        </div>
        <h4 className="text-lg font-medium text-foreground mb-2">
          {t("compare.no_muscle_data_title")}
        </h4>
        <p className="text-sm text-muted-foreground max-w-md mx-auto">
          {t("compare.no_muscle_data_description")}
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Common muscles */}
      <div className="p-4 bg-muted rounded-lg border border-border">
        <h4 className="text-sm font-semibold text-foreground mb-2 flex items-center gap-2">
          <div className="w-3 h-3 rounded-full bg-gradient-to-r from-indigo-500 to-emerald-500" />
          {t("compare.common_muscles")} ({commonMuscles.length})
        </h4>
        {commonMuscles.length > 0 ? (
          <div className="flex flex-wrap gap-1.5">
            {commonMuscles.map((muscle) => (
              <Badge key={muscle} variant="secondary" className="text-xs">
                {muscle}
              </Badge>
            ))}
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">{t("compare.no_common_muscles")}</p>
        )}
      </div>

      {/* Unique muscles per pose */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        {poses.map((pose, idx) => {
          const unique = uniqueMuscles[pose.id] || [];
          const colors = POSE_COLORS[idx % POSE_COLORS.length];

          return (
            <div
              key={pose.id}
              className={`p-4 rounded-lg border-2 ${colors.ring.replace("ring", "border")}`}
            >
              <h4 className={`text-sm font-semibold ${colors.text} mb-2`}>
                {pose.name} {t("compare.unique_label")} ({unique.length})
              </h4>
              {unique.length > 0 ? (
                <div className="flex flex-wrap gap-1.5">
                  {unique.map((muscle) => (
                    <Badge key={muscle} className={`text-xs ${colors.badge}`}>
                      {muscle}
                    </Badge>
                  ))}
                </div>
              ) : (
                <p className="text-sm text-muted-foreground">{t("compare.no_unique_muscles")}</p>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
};

// Pose card in comparison grid
interface PoseComparisonCardProps {
  pose: PoseComparisonItem;
  colorIndex: number;
  onRemove: () => void;
}

const PoseComparisonCard: React.FC<PoseComparisonCardProps> = ({
  pose,
  colorIndex,
  onRemove,
}) => {
  const { t } = useI18n();
  const { startTransition } = useViewTransition();
  const colors = POSE_COLORS[colorIndex % POSE_COLORS.length];
  const [showMuscleLayer, setShowMuscleLayer] = useState(false);

  const hasPhoto = Boolean(pose.photo_path);
  const hasMuscleLayer = Boolean(pose.muscle_layer_path);

  return (
    <div className={`bg-card rounded-xl border-2 ${colors.ring.replace("ring", "border")} overflow-hidden`}>
      {/* Image section */}
      <div className="aspect-[4/3] relative bg-muted">
        {hasPhoto ? (
          <>
            <AnimatePresence mode="wait">
              <motion.img
                key={showMuscleLayer ? "muscle" : "photo"}
                src={getImageUrl(
                  showMuscleLayer && hasMuscleLayer ? pose.muscle_layer_path : pose.photo_path,
                  pose.id,
                  showMuscleLayer && hasMuscleLayer ? "muscle_layer" : "photo"
                )}
                alt={pose.name}
                className="w-full h-full object-cover"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.2 }}
              />
            </AnimatePresence>

            {/* Layer toggle */}
            {hasMuscleLayer && (
              <div className="absolute bottom-3 right-3 flex gap-1">
                <Button
                  size="sm"
                  variant={!showMuscleLayer ? "default" : "outline"}
                  className="h-7 text-xs"
                  onClick={() => startTransition(() => setShowMuscleLayer(false))}
                >
                  <ImageIcon className="w-3 h-3 mr-1" />
                  {t("compare.photo")}
                </Button>
                <Button
                  size="sm"
                  variant={showMuscleLayer ? "default" : "outline"}
                  className="h-7 text-xs"
                  onClick={() => startTransition(() => setShowMuscleLayer(true))}
                >
                  <Layers className="w-3 h-3 mr-1" />
                  {t("compare.muscles")}
                </Button>
              </div>
            )}
          </>
        ) : (
          <div className="w-full h-full flex items-center justify-center">
            <div className="text-center text-muted-foreground">
              <ImageIcon className="w-12 h-12 mx-auto mb-2" />
              <p className="text-sm">{t("compare.no_photo")}</p>
            </div>
          </div>
        )}

        {/* Remove button */}
        <button
          onClick={onRemove}
          className="absolute top-3 right-3 w-7 h-7 rounded-full bg-card/90 hover:bg-red-50 dark:hover:bg-red-900/30 text-muted-foreground hover:text-red-600 dark:hover:text-red-400 flex items-center justify-center transition-colors"
          title={t("compare.remove")}
        >
          <X className="w-4 h-4" />
        </button>

        {/* Color indicator */}
        <div className={`absolute top-3 left-3 w-4 h-4 rounded-full ${colors.bg}`} />
      </div>

      {/* Info section */}
      <div className="p-4">
        <Link to={`/poses/${pose.id}`}>
          <h3 className="font-semibold text-foreground hover:text-indigo-600 transition-colors">
            {pose.name}
          </h3>
        </Link>
        {pose.name_en && (
          <p className="text-sm text-muted-foreground">{pose.name_en}</p>
        )}
        {pose.category_name && (
          <Badge variant="outline" className="mt-2 text-xs">
            {pose.category_name}
          </Badge>
        )}

        {/* Muscle count */}
        <div className="mt-3 pt-3 border-t border-border">
          <p className="text-xs text-muted-foreground">
            {t("compare.active_muscles")}: <span className="font-medium text-foreground">{pose.muscles.length}</span>
          </p>
        </div>
      </div>
    </div>
  );
};

// Main compare page
export const ComparePage: React.FC = () => {
  const { t } = useI18n();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const { startTransition } = useViewTransition();
  const [activeTab, setActiveTab] = useState<string>("muscles");

  const [comparisonData, setComparisonData] = useState<ComparisonResult | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Compare store for managing selection
  const removePose = useCompareStore((state) => state.removePose);
  const clearAll = useCompareStore((state) => state.clearAll);

  // Get pose IDs from URL
  const poseIdsParam = searchParams.get("poses") || "";
  const poseIds = poseIdsParam
    .split(",")
    .map((id) => parseInt(id.trim(), 10))
    .filter((id) => !isNaN(id));

  // Fetch comparison data with AbortController for cleanup
  useEffect(() => {
    const abortController = new AbortController();

    const fetchComparison = async () => {
      if (poseIds.length < 2) {
        setError(t("compare.min_poses_required"));
        setIsLoading(false);
        return;
      }

      setIsLoading(true);
      setError(null);

      try {
        const data = await compareApi.poses(poseIds, abortController.signal);
        if (!abortController.signal.aborted) {
          setComparisonData(data);
        }
      } catch (err) {
        // Ignore aborted requests
        if (err instanceof Error && err.name === "AbortError") {
          return;
        }
        if (!abortController.signal.aborted) {
          setError(err instanceof Error ? err.message : t("compare.fetch_error"));
        }
      } finally {
        if (!abortController.signal.aborted) {
          setIsLoading(false);
        }
      }
    };

    fetchComparison();

    // Cleanup: abort request on unmount or when dependencies change
    return () => {
      abortController.abort();
    };
  }, [poseIdsParam, t]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleRemovePose = (poseId: number) => {
    const newIds = poseIds.filter((id) => id !== poseId);

    // Update store first to keep it in sync
    removePose(poseId);

    // Use replace: true to prevent creating history entries for each removal
    // and to make the URL the single source of truth, avoiding race conditions
    if (newIds.length < 2) {
      navigate("/poses", { replace: true });
    } else {
      navigate(`/compare?poses=${newIds.join(",")}`, { replace: true });
    }
  };

  const handleClearAll = () => {
    clearAll();
    navigate("/poses", { replace: true });
  };

  // Loading state
  if (isLoading) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="text-center">
          <Loader2 className="w-8 h-8 text-indigo-600 animate-spin mx-auto mb-3" />
          <p className="text-muted-foreground">{t("compare.loading")}</p>
        </div>
      </div>
    );
  }

  // Error state
  if (error || !comparisonData) {
    return (
      <div className="min-h-screen bg-background p-6">
        <div className="max-w-2xl mx-auto">
          <Button
            variant="ghost"
            onClick={() => navigate(-1)}
            className="mb-6"
          >
            <ArrowLeft className="w-4 h-4 mr-2" />
            {t("compare.back")}
          </Button>

          <div className="bg-card rounded-xl p-8 text-center">
            <AlertCircle className="w-12 h-12 text-red-500 mx-auto mb-4" />
            <h2 className="text-xl font-semibold text-foreground mb-2">
              {t("compare.error_title")}
            </h2>
            <p className="text-muted-foreground mb-6">{error || t("compare.fetch_error")}</p>
            <div className="flex justify-center gap-3">
              <Button variant="outline" onClick={() => navigate("/poses")}>
                {t("compare.go_to_gallery")}
              </Button>
              <Button onClick={() => window.location.reload()}>
                {t("compare.try_again")}
              </Button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  const { poses, muscle_comparison, common_muscles, unique_muscles } = comparisonData;

  // For image comparison slider (only if 2 poses)
  const canShowSlider = poses.length === 2 && poses[0].photo_path && poses[1].photo_path;

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <div className="bg-card border-b border-border">
        <div className="max-w-7xl mx-auto px-4 py-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-4">
              <Button
                variant="ghost"
                onClick={() => navigate(-1)}
                className="text-muted-foreground"
              >
                <ArrowLeft className="w-4 h-4 mr-2" />
                {t("compare.back")}
              </Button>

              <div>
                <h1 className="text-xl font-semibold text-foreground flex items-center gap-2">
                  <GitCompareArrows className="w-5 h-5 text-indigo-600" />
                  {t("compare.title")}
                </h1>
                <p className="text-sm text-muted-foreground">
                  {t("compare.comparing_poses", { count: poses.length })}
                </p>
              </div>
            </div>

            <Button variant="outline" onClick={handleClearAll}>
              {t("compare.clear_all")}
            </Button>
          </div>
        </div>
      </div>

      {/* Main content */}
      <div className="max-w-7xl mx-auto px-4 py-6">
        <ErrorBoundary
          errorTitle={t("compare.error_title")}
          errorDescription={t("compare.render_error")}
          resetButtonText={t("compare.try_again")}
        >
          {/* Pose cards grid */}
          <div className={`grid gap-4 mb-8 ${
            poses.length === 2 ? "grid-cols-1 md:grid-cols-2" :
            poses.length === 3 ? "grid-cols-1 md:grid-cols-3" :
            "grid-cols-1 md:grid-cols-2 lg:grid-cols-4"
          }`}>
            {poses.map((pose, idx) => (
              <PoseComparisonCard
                key={pose.id}
                pose={pose}
                colorIndex={idx}
                onRemove={() => handleRemovePose(pose.id)}
              />
            ))}
          </div>

          {/* Comparison tabs */}
          <Tabs value={activeTab} onValueChange={(value) => startTransition(() => setActiveTab(value))} className="w-full">
            <TabsList className="grid w-full max-w-md grid-cols-3 mb-6">
              <TabsTrigger value="muscles">{t("compare.tab_muscles")}</TabsTrigger>
              <TabsTrigger value="overlap">{t("compare.tab_overlap")}</TabsTrigger>
              {canShowSlider && (
                <TabsTrigger value="slider">{t("compare.tab_slider")}</TabsTrigger>
              )}
            </TabsList>

            {/* Muscle comparison tab */}
            <AnimatePresence mode="wait">
              <TabsContent value="muscles" forceMount={activeTab === "muscles" ? true : undefined}>
                <motion.div
                  key="muscles"
                  className="bg-card rounded-xl p-6 border border-border view-transition-tab-content"
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -10 }}
                  transition={{ duration: 0.2 }}
                >
                  <h3 className="text-lg font-semibold text-foreground mb-4">
                    {t("compare.muscle_comparison")}
                  </h3>
                  <MuscleComparisonChart
                    muscles={muscle_comparison}
                    poses={poses}
                  />
                </motion.div>
              </TabsContent>
            </AnimatePresence>

            {/* Muscle overlap tab */}
            <AnimatePresence mode="wait">
              <TabsContent value="overlap" forceMount={activeTab === "overlap" ? true : undefined}>
                <motion.div
                  key="overlap"
                  className="bg-card rounded-xl p-6 border border-border view-transition-tab-content"
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -10 }}
                  transition={{ duration: 0.2 }}
                >
                  <h3 className="text-lg font-semibold text-foreground mb-4">
                    {t("compare.muscle_overlap")}
                  </h3>
                  <VennDiagram
                    poses={poses}
                    commonMuscles={common_muscles}
                    uniqueMuscles={unique_muscles}
                  />
                </motion.div>
              </TabsContent>
            </AnimatePresence>

            {/* Image slider tab (only for 2 poses with photos) */}
            {canShowSlider && (
              <AnimatePresence mode="wait">
                <TabsContent value="slider" forceMount={activeTab === "slider" ? true : undefined}>
                  <motion.div
                    key="slider"
                    className="bg-card rounded-xl p-6 border border-border view-transition-tab-content"
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: -10 }}
                    transition={{ duration: 0.2 }}
                  >
                    <h3 className="text-lg font-semibold text-foreground mb-4">
                      {t("compare.visual_comparison")}
                    </h3>
                    <p className="text-sm text-muted-foreground mb-4">
                      {t("compare.slider_hint")}
                    </p>
                    <div className="max-w-2xl mx-auto">
                      <ImageComparisonSlider
                        leftImage={getImageUrl(poses[0].photo_path, poses[0].id, "photo")}
                        rightImage={getImageUrl(poses[1].photo_path, poses[1].id, "photo")}
                        leftLabel={poses[0].name}
                        rightLabel={poses[1].name}
                      />
                    </div>
                  </motion.div>
                </TabsContent>
              </AnimatePresence>
            )}
          </Tabs>

          {/* Summary stats */}
          <div className="mt-8 grid grid-cols-2 md:grid-cols-4 gap-4">
            <div className="bg-card rounded-lg p-4 border border-border text-center">
              <div className="text-2xl font-bold text-indigo-600">
                {poses.length}
              </div>
              <div className="text-sm text-muted-foreground">{t("compare.stat_poses")}</div>
            </div>
            <div className="bg-card rounded-lg p-4 border border-border text-center">
              <div className="text-2xl font-bold text-emerald-600">
                {muscle_comparison.length}
              </div>
              <div className="text-sm text-muted-foreground">{t("compare.stat_total_muscles")}</div>
            </div>
            <div className="bg-card rounded-lg p-4 border border-border text-center">
              <div className="text-2xl font-bold text-amber-600">
                {common_muscles.length}
              </div>
              <div className="text-sm text-muted-foreground">{t("compare.stat_common")}</div>
            </div>
            <div className="bg-card rounded-lg p-4 border border-border text-center">
              <div className="text-2xl font-bold text-rose-600">
                {Object.values(unique_muscles).flat().length}
              </div>
              <div className="text-sm text-muted-foreground">{t("compare.stat_unique")}</div>
            </div>
          </div>
        </ErrorBoundary>
      </div>
    </div>
  );
};
