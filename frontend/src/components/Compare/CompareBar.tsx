import React, { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { AnimatePresence, motion } from "framer-motion";
import { Loader2, X, GitCompareArrows, Trash2 } from "lucide-react";
import { Button } from "../ui/button";
import {
  useCompareStore,
  useSelectedPoseCount,
} from "../../store/useCompareStore";
import { useI18n } from "../../i18n";
import { PoseImage } from "../Pose";

export const CompareBar: React.FC = () => {
  const { t } = useI18n();
  const navigate = useNavigate();
  const [isNavigating, setIsNavigating] = useState(false);
  const navigationTimeoutRef = useRef<number | null>(null);

  const selectedPoses = useCompareStore((state) => state.selectedPoses);
  const selectedPoseData = useCompareStore((state) => state.selectedPoseData);
  const removePose = useCompareStore((state) => state.removePose);
  const clearAll = useCompareStore((state) => state.clearAll);
  const canCompare = useCompareStore((state) => state.canCompare);
  const count = useSelectedPoseCount();

  useEffect(() => {
    return () => {
      if (navigationTimeoutRef.current) {
        window.clearTimeout(navigationTimeoutRef.current);
      }
    };
  }, []);

  const handleCompare = () => {
    if (!canCompare() || isNavigating) return;

    setIsNavigating(true);
    const params = new URLSearchParams({ poses: selectedPoses.join(",") });

    navigationTimeoutRef.current = window.setTimeout(() => {
      navigate(`/compare?${params.toString()}`, {
        state: { fromCompareBar: true },
      });
    }, 170);
  };

  const handleRemove = (id: number, e: React.MouseEvent) => {
    e.stopPropagation();
    if (isNavigating) return;
    removePose(id);
  };

  return (
    <motion.div
      initial={{ y: "100%" }}
      animate={
        isNavigating
          ? { y: "105%", opacity: 0, scale: 0.995 }
          : { y: 0, opacity: 1, scale: 1 }
      }
      exit={{ y: "100%" }}
      transition={{
        y: { duration: 0.24, ease: [0.22, 1, 0.36, 1] },
        opacity: { duration: 0.16, ease: "easeOut" },
        scale: { duration: 0.2, ease: "easeOut" },
      }}
      className={`fixed bottom-0 left-0 right-0 z-50 will-change-transform ${
        isNavigating ? "pointer-events-none" : ""
      }`}
      data-testid="compare-bar"
    >
      <div className="bg-card/95 backdrop-blur-sm border-t shadow-lg">
        <div className="max-w-7xl mx-auto px-4 py-3">
          <div className="flex items-center justify-between gap-4">
            {/* Left side - Selected poses */}
            <div className="flex items-center gap-3 flex-1 min-w-0">
              <div className="flex items-center gap-2 text-sm text-muted-foreground shrink-0">
                <GitCompareArrows className="w-4 h-4 text-indigo-600" />
                <span className="font-medium">
                  {t("compare.selected", { count })}
                </span>
              </div>

              {/* Pose thumbnails */}
              <div className="flex items-center gap-2 overflow-x-auto pb-1 -mb-1 scrollbar-hide">
                <AnimatePresence initial={false}>
                  {selectedPoses.map((poseId) => {
                    // Access pose data from Record (may be undefined if data wasn't cached or is stale)
                    // The actual comparison always fetches fresh data from server,
                    // this is just for display purposes in the bar
                    const poseData = selectedPoseData[poseId];
                    const hasPhoto = poseData?.photo_path;

                    return (
                      <motion.div
                        key={poseId}
                        layout="position"
                        initial={{ opacity: 0, x: 12, scale: 0.94 }}
                        animate={{ opacity: 1, x: 0, scale: 1 }}
                        exit={{ opacity: 0, x: 10, scale: 0.9 }}
                        transition={{ duration: 0.2, ease: [0.22, 1, 0.36, 1] }}
                        className="relative group shrink-0"
                        data-testid={`compare-bar-pose-${poseId}`}
                      >
                        <div className="w-12 h-12 rounded-lg overflow-hidden bg-muted border-2 border-border hover:border-primary/50 transition-colors duration-200">
                          {hasPhoto ? (
                            <PoseImage
                              poseId={poseId}
                              imageType="photo"
                              directPath={poseData?.photo_path}
                              alt={poseData?.name || `Pose ${poseId}`}
                              className="w-full h-full object-cover"
                            />
                          ) : (
                            <div className="w-full h-full flex items-center justify-center text-muted-foreground text-xs font-medium">
                              {poseData?.name?.charAt(0) || poseId}
                            </div>
                          )}
                        </div>

                        {/* Remove button - touch target size fix (issue 8): min-w-[44px] min-h-[44px] */}
                        <button
                          onClick={(e) => handleRemove(poseId, e)}
                          data-testid={`compare-bar-remove-${poseId}`}
                          className="absolute -top-2 -right-2 min-w-[44px] min-h-[44px] flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity touch-manipulation"
                          title={t("compare.remove")}
                          aria-label={t("compare.remove_pose", {
                            name: poseData?.name || poseId,
                          })}
                        >
                          {/* Visual indicator smaller than touch target */}
                          <span className="w-5 h-5 rounded-full bg-primary text-primary-foreground flex items-center justify-center hover:bg-destructive transition-colors">
                            <X className="w-3 h-3" />
                          </span>
                        </button>

                        {/* Pose name tooltip */}
                        {poseData?.name && (
                          <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 px-2 py-1 bg-popover text-popover-foreground text-xs rounded whitespace-nowrap opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none shadow-lg border">
                            {poseData.name}
                          </div>
                        )}
                      </motion.div>
                    );
                  })}
                </AnimatePresence>

                {/* Empty slots */}
                {Array.from({ length: 4 - count }).map((_, idx) => (
                  <div
                    key={`empty-${idx}`}
                    className="w-12 h-12 rounded-lg border-2 border-dashed border-border bg-muted/50 shrink-0"
                  />
                ))}
              </div>
            </div>

            {/* Right side - Actions */}
            <div className="flex items-center gap-2 shrink-0">
              <Button
                variant="ghost"
                size="sm"
                onClick={clearAll}
                disabled={isNavigating}
                data-testid="compare-bar-clear"
                className="text-muted-foreground hover:text-destructive"
              >
                <Trash2 className="w-4 h-4 mr-1.5" />
                {t("compare.clear")}
              </Button>

              <Button
                onClick={handleCompare}
                disabled={!canCompare() || isNavigating}
                data-testid="compare-bar-compare"
                className="bg-indigo-600 hover:bg-indigo-700 text-white disabled:opacity-50"
              >
                {isNavigating ? (
                  <Loader2 className="w-4 h-4 mr-1.5 animate-spin" />
                ) : (
                  <GitCompareArrows className="w-4 h-4 mr-1.5" />
                )}
                {t("compare.compare")}
              </Button>
            </div>
          </div>
        </div>
      </div>
    </motion.div>
  );
};
