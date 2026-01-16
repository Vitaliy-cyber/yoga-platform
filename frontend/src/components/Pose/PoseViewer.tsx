import React, { useState } from "react";
import { Button } from "../ui/button";
import { Badge } from "../ui/badge";
import { Dialog, DialogContent, DialogTitle } from "../ui/dialog";
import { VisuallyHidden } from "../ui/visually-hidden";
import { Activity, Download, Eye, Layers, X } from "lucide-react";
import type { Pose } from "../../types";
import { getImageProxyUrl } from "../../services/api";
import { useI18n } from "../../i18n";

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
  const [overlayOpacity, setOverlayOpacity] = useState(0.7);
  const { t } = useI18n();
  const overlayLabel = activeOverlay === "photo" ? t("pose.viewer.photo") : t("pose.viewer.muscles");

  const getActiveImage = () => {
    if (activeOverlay === "muscles" && pose.muscle_layer_path) {
      return getImageProxyUrl(pose.id, 'muscle_layer');
    }
    if (pose.photo_path) {
      return getImageProxyUrl(pose.id, 'photo');
    }
    return null;
  };

  const hasOverlay = (type: string) => {
    if (type === "muscles") return !!pose.muscle_layer_path;
    return true;
  };

  const handleDownload = async () => {
    const imageUrl = getActiveImage();
    if (!imageUrl) return;

    try {
      const response = await fetch(imageUrl);
      const blob = await response.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `${pose.name.replace(/\s+/g, "_")}_${activeOverlay}.jpg`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      window.URL.revokeObjectURL(url);
    } catch (error) {
      console.error(t("generate.download_failed"), error);
    }
  };

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-6xl w-[95vw] h-[90vh] p-0 bg-stone-950 border-0 overflow-hidden" aria-describedby={undefined} hideCloseButton>
        <VisuallyHidden>
          <DialogTitle>{`${pose.name} - ${t("pose.viewer.title")}`}</DialogTitle>
        </VisuallyHidden>
        <div className="flex flex-col h-full">
          <div className="flex items-center justify-between px-6 py-4 border-b border-stone-800">
            <div className="flex items-center gap-4">
              <h2 className="text-xl font-medium text-white">{pose.name}</h2>
              {pose.category_name && (
                <Badge variant="outline" className="border-stone-600 text-stone-400">
                  {pose.category_name}
                </Badge>
              )}
            </div>
            <div className="flex items-center gap-3">
              <Button
                variant="ghost"
                size="sm"
                onClick={handleDownload}
                className="text-stone-400 hover:text-white hover:bg-stone-800"
              >
                <Download className="w-4 h-4 mr-2" />
                {t("pose.viewer.download")}
              </Button>
              <Button
                variant="ghost"
                size="icon"
                onClick={onClose}
                className="text-stone-400 hover:text-white hover:bg-stone-800 rounded-full"
              >
                <X className="w-5 h-5" />
              </Button>
            </div>
          </div>

          <div className="flex-1 flex overflow-hidden">
            <div className="flex-1 relative flex items-center justify-center p-8 bg-stone-900">
              <div className="relative max-w-full max-h-full">
                <img
                  src={pose.photo_path ? getImageProxyUrl(pose.id, 'photo') : ""}
                  alt={pose.name}
                  className="max-w-full max-h-[calc(90vh-180px)] object-contain rounded-lg transition-opacity duration-200"
                />

                {activeOverlay !== "photo" && hasOverlay(activeOverlay) && (
                  <img
                    src={getActiveImage() || ""}
                    alt={`${pose.name} - ${overlayLabel}`}
                    className="absolute inset-0 max-w-full max-h-full object-contain rounded-lg transition-opacity duration-200"
                    style={{ opacity: overlayOpacity }}
                  />
                )}
              </div>
            </div>

            <div className="w-80 bg-stone-900 border-l border-stone-800 p-6 overflow-y-auto">
              <div className="mb-8">
                <div className="flex items-center gap-2 mb-4">
                  <Layers className="w-4 h-4 text-stone-400" />
                  <h3 className="text-sm font-medium text-stone-300">{t("pose.viewer.layer")}</h3>
                </div>

                <div className="space-y-2">
                  {overlayTypes.map((overlay) => {
                    const Icon = overlay.icon;
                    const available = hasOverlay(overlay.id);
                    return (
                      <button
                        key={overlay.id}
                        onClick={() => available && setActiveOverlay(overlay.id as "photo" | "muscles")}
                        disabled={!available}
                        className={`w-full flex items-center gap-3 px-4 py-3 rounded-xl transition-all ${
                          activeOverlay === overlay.id
                            ? "bg-white text-stone-900"
                            : available
                              ? "bg-stone-800 text-stone-300 hover:bg-stone-700"
                              : "bg-stone-800/50 text-stone-600 cursor-not-allowed"
                        }`}
                      >
                        <Icon className="w-5 h-5" />
                        <span className="font-medium">{t(overlay.labelKey)}</span>
                        {!available && overlay.id !== "photo" && (
                          <Badge className="ml-auto bg-stone-700 text-stone-400 text-xs">
                            {t("pose.viewer.not_generated")}
                          </Badge>
                        )}
                      </button>
                    );
                  })}
                </div>
              </div>

              {activeOverlay !== "photo" && hasOverlay(activeOverlay) && (
                <div className="mb-8">
                  <label className="text-sm font-medium text-stone-300 block mb-3">
                    {t("pose.viewer.opacity", { value: Math.round(overlayOpacity * 100) })}
                  </label>

                  <input
                    type="range"
                    min="0"
                    max="100"
                    value={overlayOpacity * 100}
                    onChange={(e) => setOverlayOpacity(Number(e.target.value) / 100)}
                    className="w-full accent-white"
                  />
                </div>
              )}
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
};
