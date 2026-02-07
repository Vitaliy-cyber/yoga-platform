import React, { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Button } from "../ui/button";
import { Badge } from "../ui/badge";
import { Dialog, DialogContent, DialogTitle } from "../ui/dialog";
import { VisuallyHidden } from "../ui/visually-hidden";
import { Activity, Download, Eye, Layers, Loader2, X } from "lucide-react";
import type { Pose } from "../../types";
import { useI18n } from "../../i18n";
import { useAppStore } from "../../store/useAppStore";
import { MuscleOverlay } from "../Anatomy/MuscleOverlay";
import { cn } from "../../lib/utils";
import { logger } from "../../lib/logger";
import { DEFAULT_OVERLAY_OPACITY } from "../../lib/constants";
import { usePoseImageSrc } from "../../hooks/usePoseImageSrc";
import { fadeScale, smoothTransition } from "../../lib/animation-variants";

interface PoseViewerProps {
  pose: Pose;
  isOpen: boolean;
  onClose: () => void;
}

const overlayTypes = [
  { id: "photo", labelKey: "pose.viewer.photo", icon: Eye },
  { id: "muscles", labelKey: "pose.viewer.muscles", icon: Activity },
] as const;

export const PoseViewer: React.FC<PoseViewerProps> = ({ pose, isOpen, onClose }) => {
  const [activeOverlay, setActiveOverlay] = useState<"photo" | "muscles">("photo");
  const [overlayOpacity, setOverlayOpacity] = useState(DEFAULT_OVERLAY_OPACITY);
  const [isDownloading, setIsDownloading] = useState(false);
  const { t } = useI18n();
  const addToast = useAppStore((state) => state.addToast);
  const overlayLabel = activeOverlay === "photo" ? t("pose.viewer.photo") : t("pose.viewer.muscles");

  const { src: photoSrc, refresh: refreshPhoto } = usePoseImageSrc(
    pose.photo_path,
    pose.id,
    "photo",
    { enabled: Boolean(pose.photo_path), version: pose.version }
  );
  const { src: muscleSrc, refresh: refreshMuscle } = usePoseImageSrc(
    pose.muscle_layer_path,
    pose.id,
    "muscle_layer",
    { enabled: activeOverlay === "muscles" && Boolean(pose.muscle_layer_path), version: pose.version }
  );

  const hasOverlay = (type: string) => {
    if (type === "muscles") return !!pose.muscle_layer_path;
    return true;
  };

  const handleDownload = async () => {
    const imageUrl = activeOverlay === "muscles" ? muscleSrc : photoSrc;
    logger.debug("Starting download, URL:", imageUrl);
    if (!imageUrl) {
      logger.warn("No image URL available for download");
      addToast({
        type: "error",
        message: t("generate.download_failed"),
      });
      return;
    }

    setIsDownloading(true);
    let objectUrl: string | null = null;
    try {
      logger.debug("Fetching image...");
      const response = await fetch(imageUrl);
      logger.debug("Response status:", response.status, response.ok);
      if (!response.ok) {
        throw new Error(`HTTP error: ${response.status}`);
      }
      const blob = await response.blob();
      logger.debug("Blob size:", blob.size, "type:", blob.type);
      objectUrl = window.URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = objectUrl;
      a.download = `${pose.name.replace(/\s+/g, "_")}_${activeOverlay}.jpg`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      logger.debug("Download triggered successfully");
    } catch (error) {
      logger.error("Download failed:", error);
      addToast({
        type: "error",
        message: t("generate.download_failed"),
      });
    } finally {
      if (objectUrl) {
        window.URL.revokeObjectURL(objectUrl);
      }
      setIsDownloading(false);
    }
  };

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <DialogContent
        className="max-w-6xl w-full sm:w-[95vw] h-full sm:h-[90vh] p-0 bg-stone-950 border-0 overflow-hidden"
        aria-describedby={undefined}
        hideCloseButton
        mobileFullscreen
      >
        <VisuallyHidden>
          <DialogTitle>{`${pose.name} - ${t("pose.viewer.title")}`}</DialogTitle>
        </VisuallyHidden>
        <div className="flex flex-col h-full">
          {/* Header - responsive */}
          <div className="flex items-center justify-between px-4 sm:px-6 py-3 sm:py-4 border-b border-stone-800 gap-2">
            <div className="flex items-center gap-2 sm:gap-4 min-w-0 flex-1">
              <h2 className="text-base sm:text-xl font-medium text-white truncate">{pose.name}</h2>
              {pose.category_name && (
                <Badge variant="outline" className="border-stone-600 text-stone-400 hidden sm:inline-flex flex-shrink-0">
                  {pose.category_name}
                </Badge>
              )}
            </div>
            <div className="flex items-center gap-2 sm:gap-3 flex-shrink-0">
              <Button
                variant="ghost"
                size="sm"
                onClick={handleDownload}
                disabled={isDownloading}
                className="text-stone-400 hover:text-white hover:bg-stone-800 min-h-[44px] px-3 touch-manipulation disabled:opacity-50"
                aria-label={t("pose.viewer.download")}
              >
                {isDownloading ? (
                  <Loader2 className="w-4 h-4 sm:mr-2 animate-spin" />
                ) : (
                  <Download className="w-4 h-4 sm:mr-2" />
                )}
                <span className="hidden sm:inline">{t("pose.viewer.download")}</span>
              </Button>
              <Button
                variant="ghost"
                size="icon"
                onClick={onClose}
                className="text-stone-400 hover:text-white hover:bg-stone-800 rounded-full min-h-[44px] min-w-[44px] touch-manipulation"
                aria-label={t("common.close")}
              >
                <X className="w-5 h-5" />
              </Button>
            </div>
          </div>

          {/* Main content - stack on mobile, side-by-side on desktop */}
          <div className="flex-1 flex flex-col sm:flex-row overflow-hidden min-h-0">
            {/* Image viewer */}
            <div className="flex-1 relative flex items-center justify-center p-4 sm:p-8 bg-stone-900 min-h-[40vh] sm:min-h-0 overflow-hidden">
              <div className="relative max-w-full max-h-full overflow-hidden rounded-lg isolate">
                <AnimatePresence mode="wait">
                  <motion.img
                    key={activeOverlay === "photo" ? "photo" : "base"}
                    src={photoSrc || undefined}
                    alt={pose.name}
                    className="block max-w-full max-h-full object-contain"
                    variants={fadeScale}
                    initial="initial"
                    animate="animate"
                    exit="exit"
                    transition={smoothTransition}
                    onError={() => void refreshPhoto(true)}
                  />
                </AnimatePresence>

                <AnimatePresence>
                  {activeOverlay !== "photo" && hasOverlay(activeOverlay) && (
                    <motion.img
                      key={activeOverlay}
                      src={muscleSrc || undefined}
                      alt={`${pose.name} - ${overlayLabel}`}
                      className="absolute inset-0 m-auto max-w-full max-h-full object-contain pointer-events-none transition-opacity duration-200 ease-out will-change-[opacity]"
                      style={{ opacity: overlayOpacity, transform: "translateZ(0)" }}
                      onError={() => void refreshMuscle(true)}
                    />
                  )}
                </AnimatePresence>
              </div>
            </div>

            {/* Sidebar - bottom on mobile, right side on desktop */}
            <div className="w-full sm:w-80 bg-stone-900 border-t sm:border-t-0 sm:border-l border-stone-800 p-4 sm:p-6 overflow-y-auto safe-area-pb">
              <div className="mb-8">
                <div className="flex items-center gap-2 mb-4">
                  <Layers className="w-4 h-4 text-stone-400" />
                  <h3 className="text-sm font-medium text-stone-300">{t("pose.viewer.layer")}</h3>
                </div>

                <div className="flex sm:flex-col gap-2">
                  {overlayTypes.map((overlay) => {
                    const Icon = overlay.icon;
                    const available = hasOverlay(overlay.id);
                    return (
                      <button
                        key={overlay.id}
                        onClick={() => available && setActiveOverlay(overlay.id as "photo" | "muscles")}
                        disabled={!available}
                        className={cn(
                          "flex-1 sm:flex-initial w-full flex items-center justify-center sm:justify-start gap-2 sm:gap-3 px-3 sm:px-4 py-3 rounded-xl transition-colors min-h-[48px] touch-manipulation active:scale-[0.98]",
                          activeOverlay === overlay.id
                            ? "bg-white text-stone-900"
                            : available
                              ? "bg-stone-800 text-stone-300 hover:bg-stone-700 active:bg-stone-600"
                              : "bg-stone-800/50 text-stone-600 cursor-not-allowed"
                        )}
                      >
                        <Icon className="w-5 h-5" />
                        <span className="font-medium text-sm sm:text-base">{t(overlay.labelKey)}</span>
                        {!available && overlay.id !== "photo" && (
                          <Badge className="ml-auto bg-stone-700 text-stone-400 text-xs hidden sm:inline-flex">
                            {t("pose.viewer.not_generated")}
                          </Badge>
                        )}
                      </button>
                    );
                  })}
                </div>
              </div>

              {activeOverlay === "muscles" && hasOverlay("muscles") && (
                <div className="mb-6 sm:mb-8">
                  <label className="text-sm font-medium text-stone-300 block mb-3">
                    {t("pose.viewer.opacity", { value: Math.round(overlayOpacity * 100) })}
                  </label>

                  <input
                    type="range"
                    min="0"
                    max="100"
                    value={overlayOpacity * 100}
                    onChange={(e) => setOverlayOpacity(Number(e.target.value) / 100)}
                    className="w-full accent-white h-2 cursor-pointer touch-manipulation"
                  />
                </div>
              )}

              {/* Active Muscles Section */}
              {pose.muscles && pose.muscles.length > 0 && (
                <div className="mb-8">
                  <div className="flex items-center gap-2 mb-4">
                    <Activity className="w-4 h-4 text-stone-400" />
                    <h3 className="text-sm font-medium text-stone-300">{t("pose.viewer.active_muscles")}</h3>
                  </div>
                  <MuscleOverlay muscles={pose.muscles} className="[&_h4]:text-stone-500 [&_*]:text-stone-300" />
                </div>
              )}
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
};
