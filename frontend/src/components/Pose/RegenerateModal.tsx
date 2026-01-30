import React, { useState, useEffect, useRef, useCallback } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "../ui/dialog";
import { Button } from "../ui/button";
import { Label } from "../ui/label";
import { Textarea } from "../ui/textarea";
import { Loader2, RefreshCw, Activity, Check } from "lucide-react";
import { cn } from "../../lib/utils";
import type { Pose } from "../../types";
import { useGenerate } from "../../hooks/useGenerate";
import { posesApi, getSignedImageUrl } from "../../services/api";
import { useI18n } from "../../i18n";
import { logger } from "../../lib/logger";
import { generationSteps, getStepState } from "./generation-steps";
import { usePoseImageSrc } from "../../hooks/usePoseImageSrc";

interface RegenerateModalProps {
  pose: Pose | null;
  isOpen: boolean;
  onClose: () => void;
  onComplete?: () => void;
  activeTab?: "photo" | "muscles";
}

export const RegenerateModal: React.FC<RegenerateModalProps> = ({
  pose,
  isOpen,
  onClose,
  onComplete,
  activeTab = "photo",
}) => {
  const [feedback, setFeedback] = useState("");
  const [localError, setLocalError] = useState<string | null>(null);
  const { isGenerating, progress, statusMessage, error, photoUrl, taskId, regenerate, reset } = useGenerate();
  const [generationStarted, setGenerationStarted] = useState(false);
  const { t } = useI18n();

  // Track if generation is fully complete (100%)
  const isComplete = progress >= 100;

  // Ref to prevent double saves
  const savingRef = useRef(false);

  // Save generated images to database when generation completes
  useEffect(() => {
    const saveGeneratedImages = async () => {
      // Prevent multiple saves with ref (more reliable than state)
      if (!generationStarted || !photoUrl || isGenerating || savingRef.current || !pose || !taskId) {
        return;
      }

      savingRef.current = true;

      try {
        // Apply generation results to the pose (photo, muscle layer, AND muscle associations)
        await posesApi.applyGeneration(pose.id, taskId);

        // Notify parent to refresh data
        onComplete?.();
      } catch (err) {
        logger.error(t("generate.save_failed"), err);
        // Still notify parent - the images are generated, just not saved to pose
        onComplete?.();
      } finally {
        // Reset and close
        savingRef.current = false;
        setGenerationStarted(false);
        reset();
        setFeedback("");
        onClose();
      }
    };

    saveGeneratedImages();
  }, [photoUrl, isGenerating, pose, generationStarted, taskId, onComplete, onClose, reset, t]);

  /**
   * Fetches an image from URL and converts to File.
   */
  const fetchImageAsFile = async (url: string, filename: string): Promise<File> => {
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(t("regenerate.fetch_photo_failed"));
    }
    const blob = await response.blob();
    return new File([blob], filename, { type: blob.type || 'image/png' });
  };

  /**
   * Handles the regeneration process.
   * Sends: schema (if available) + selected image (photo OR muscles based on tab).
   */
  const handleRegenerate = async () => {
    // Determine which image to use based on activeTab
    const useMusclePath = activeTab === "muscles" && pose?.muscle_layer_path;
    const sourcePath = useMusclePath ? pose?.muscle_layer_path : pose?.photo_path;

    if (!pose || !sourcePath) {
      setLocalError(t("regenerate.no_source_image"));
      return;
    }

    setLocalError(null);

    try {
      // Mark that generation started in this session
      setGenerationStarted(true);

      // Use user's feedback directly as the prompt
      const regenerationNotes = feedback.trim() || undefined;

      // Fetch the selected image (either photo OR muscle layer)
      const selectedImageUrl = useMusclePath
        ? await getSignedImageUrl(pose.id, "muscle_layer", { allowProxyFallback: false })
        : await getSignedImageUrl(pose.id, "photo", { allowProxyFallback: false });

      const selectedImage = await fetchImageAsFile(
        selectedImageUrl,
        `${pose.code}_${useMusclePath ? 'muscles' : 'photo'}.png`
      );

      // Fetch schema if available
      let schemaFile: File | undefined;
      if (pose.schema_path) {
        const schemaUrl = await getSignedImageUrl(pose.id, "schema", { allowProxyFallback: false });
        schemaFile = await fetchImageAsFile(schemaUrl, `${pose.code}_schema.png`);
      }

      // Send schema + selected image for regeneration
      await regenerate({
        schemaFile,
        referencePhoto: selectedImage,
        additionalNotes: regenerationNotes,
      });
    } catch (err) {
      logger.error("Regeneration error:", err);
      const message = err instanceof Error ? err.message : t("generate.error_failed");
      setLocalError(message);
      setGenerationStarted(false);
    }
  };

  const handleClose = useCallback((open: boolean) => {
    // Only handle close events (open=false), not open events
    if (open) return;

    // Only close if not currently saving
    if (savingRef.current) {
      return;
    }
    reset();
    setFeedback("");
    setLocalError(null);
    setGenerationStarted(false);
    onClose();
  }, [reset, onClose]);

  // Get current image URL based on active tab
  const isShowingMuscles = activeTab === "muscles" && Boolean(pose?.muscle_layer_path);
  const currentImageType = isShowingMuscles ? "muscle_layer" : "photo";
  const currentDirectPath = isShowingMuscles ? pose?.muscle_layer_path : pose?.photo_path;
  const { src: currentImageSrc, refresh: refreshCurrentImage } = usePoseImageSrc(
    currentDirectPath,
    pose?.id ?? 0,
    currentImageType,
    { enabled: Boolean(pose && currentDirectPath) }
  );

  if (!pose) return null;

  return (
    <Dialog open={isOpen} onOpenChange={handleClose}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="text-xl font-medium">
            {t("regenerate.title", { pose: pose.name })}
          </DialogTitle>
          <DialogDescription>
            {t("regenerate.description")}
          </DialogDescription>
        </DialogHeader>

        {!isGenerating ? (
          <div className="space-y-6 pt-4">
            {/* Current image based on selected tab */}
            <div>
              <Label className="text-stone-600 mb-2 block">{t("regenerate.current_image")}</Label>

              {currentImageSrc ? (
                <div className="relative rounded-xl overflow-hidden bg-stone-50 p-4">
                  <img
                    src={currentImageSrc}
                    alt={isShowingMuscles ? t("regenerate.alt_muscle_image") : t("regenerate.alt_photo_image")}
                    className="max-h-64 mx-auto object-contain rounded-lg"
                    onError={() => void refreshCurrentImage(true)}
                  />
                </div>
              ) : (
                <div className="rounded-xl bg-stone-50 p-8 text-center">
                  <Activity className="w-12 h-12 text-stone-300 mx-auto mb-2" />
                  <p className="text-stone-500 text-sm">{t("regenerate.no_image")}</p>
                </div>
              )}
            </div>

            {/* Feedback textarea */}
            <div className="space-y-2">
              <Label className="text-stone-600">{t("regenerate.feedback_label")}</Label>
              <Textarea
                value={feedback}
                onChange={(e) => setFeedback(e.target.value)}
                placeholder={t("regenerate.feedback_placeholder")}
                className="border-stone-200 resize-none min-h-[100px]"
              />
              <p className="text-xs text-stone-400">{t("regenerate.feedback_hint")}</p>
            </div>

            {(error || localError) && (
              <div className="p-4 bg-red-50 text-red-700 rounded-xl text-sm">
                {error || localError}
              </div>
            )}

            <Button
              onClick={handleRegenerate}
              className="w-full bg-stone-800 hover:bg-stone-900 text-white h-12 rounded-xl"
            >
              <RefreshCw className="w-4 h-4 mr-2" />
              {t("regenerate.start")}
            </Button>
          </div>
        ) : (
          <div className="py-8">
            {/* Progress bar */}
            <div className="mb-6">
              <div className="flex justify-between text-xs text-stone-500 mb-2">
                <span>{statusMessage || t("generate.modal_progress")}</span>
                <span>{Math.min(progress, 100)}%</span>
              </div>
              <div className="h-2 bg-stone-200 rounded-full overflow-hidden">
                <div
                  className="h-full bg-stone-800 rounded-full transition-all duration-700 ease-out"
                  style={{ width: `${Math.min(progress, 100)}%` }}
                />
              </div>
            </div>

            <div className="space-y-3">
              {generationSteps.map((step, index) => {
                const Icon = step.icon;
                const stepState = getStepState(index, progress, isComplete);
                const isActive = stepState === "active";
                const isStepComplete = stepState === "complete";
                const isPending = stepState === "pending";

                return (
                  <div
                    key={step.id}
                    className={cn(
                      "flex items-center gap-4 p-4 rounded-xl transition-all duration-300",
                      isActive && "bg-stone-100",
                      isStepComplete && "bg-emerald-50",
                      isPending && "bg-stone-50 opacity-50"
                    )}
                  >
                    <div
                      className={cn(
                        "w-10 h-10 rounded-full flex items-center justify-center transition-all duration-300",
                        isActive && "bg-stone-800",
                        isStepComplete && "bg-emerald-500",
                        isPending && "bg-stone-200"
                      )}
                    >
                      {isActive ? (
                        <Loader2 className="w-5 h-5 text-white animate-spin" />
                      ) : isStepComplete ? (
                        <Check className="w-5 h-5 text-white" />
                      ) : (
                        <Icon className="w-5 h-5 text-stone-400" />
                      )}
                    </div>
                    <div className="flex-1">
                      <p
                        className={cn(
                          "font-medium transition-colors duration-300",
                          isActive && "text-stone-800",
                          isStepComplete && "text-emerald-700",
                          isPending && "text-stone-400"
                        )}
                      >
                        {t(step.labelKey)}
                      </p>
                    </div>
                  </div>
                );
              })}
            </div>
            <p className="text-center text-stone-500 text-sm mt-6">
              {t("generate.modal_hint")}
            </p>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
};
