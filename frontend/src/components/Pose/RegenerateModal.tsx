import React, { useState, useEffect, useRef, useCallback } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "../ui/dialog";
import { Button } from "../ui/button";
import { Label } from "../ui/label";
import { Textarea } from "../ui/textarea";
import { Loader2, RefreshCw, Activity, Check } from "lucide-react";
import { cn } from "../../lib/utils";
import type { Pose } from "../../types";
import { getSignedImageUrl } from "../../services/api";
import { useI18n } from "../../i18n";
import { logger } from "../../lib/logger";
import { getGenerationSteps, getStepState } from "./generation-steps";
import { usePoseImageSrc } from "../../hooks/usePoseImageSrc";
import { useAuthStore } from "../../store/useAuthStore";
import {
  selectLatestTaskForPose,
  useGenerationStore,
} from "../../store/useGenerationStore";

interface RegenerateModalProps {
  pose: Pose | null;
  isOpen: boolean;
  onClose: () => void;
  onComplete?: (updatedPose?: Pose) => void | Promise<void>;
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
  const [isStarting, setIsStarting] = useState(false);
  const handledAppliedAtRef = useRef<number | null>(null);
  const { t } = useI18n();

  const startFromPose = useGenerationStore((state) => state.startFromPose);
  const startRegenerationUpload = useGenerationStore(
    (state) => state.startRegenerationUpload,
  );

  const generationTask = useGenerationStore(
    useCallback(
      (state) => (pose ? selectLatestTaskForPose(pose.id, "regenerate")(state) : null),
      [pose],
    ),
  );

  const isGenerating = generationTask
    ? generationTask.status === "pending" ||
      generationTask.status === "processing" ||
      generationTask.autoApplyStatus === "applying"
    : false;

  const progress = generationTask?.progress ?? 0;
  const statusMessage = generationTask?.statusMessage;
  const taskError = generationTask?.errorMessage;
  const taskGenerateMuscles = generationTask?.generateMuscles ?? true;
  const generationSteps = getGenerationSteps(taskGenerateMuscles);

  // Track if generation is fully complete (100%)
  const isComplete = progress >= 100;

  // Handle successful auto-apply even if modal was closed in the meantime.
  useEffect(() => {
    if (!generationTask) return;
    if (generationTask.autoApplyStatus !== "applied") return;
    if (!generationTask.appliedAt) return;
    if (handledAppliedAtRef.current === generationTask.appliedAt) return;

    handledAppliedAtRef.current = generationTask.appliedAt;

    void Promise.resolve(onComplete?.(generationTask.appliedPose ?? undefined)).catch(
      (err) => {
        logger.warn("RegenerateModal onComplete failed", err);
      },
    );

    setFeedback("");
    setLocalError(null);

    if (isOpen) {
      onClose();
    }
  }, [generationTask, isOpen, onClose, onComplete]);

  /**
   * Fetches an image from URL and converts to File.
   */
  const fetchImageAsFile = async (url: string, filename: string): Promise<File> => {
    const init: RequestInit = {};
    try {
      const parsed = new URL(url, window.location.origin);
      const isApiPath = parsed.pathname.startsWith("/api");
      if (isApiPath) {
        const token = useAuthStore.getState().accessToken;
        if (token) {
          init.headers = { Authorization: `Bearer ${token}` };
        }
        init.credentials = "include";
      }
    } catch {
      // ignore URL parse errors; fetch will surface them as a network error
    }

    const response = await fetch(url, init);
    if (!response.ok) {
      throw new Error(t("regenerate.fetch_photo_failed"));
    }
    const blob = await response.blob();
    const safeType = blob.type && blob.type.startsWith("image/") ? blob.type : "image/png";
    return new File([blob], filename, { type: safeType });
  };

  const upgradeToHttpsIfNeeded = (url: string): string => {
    if (typeof window === "undefined") return url;
    if (window.location.protocol === "https:" && url.startsWith("http://")) {
      return url.replace(/^http:\/\//, "https://");
    }
    return url;
  };

  const resolveSourceUrl = async (
    directPath: string | null | undefined,
    imageType: "schema" | "photo" | "muscle_layer",
  ): Promise<string> => {
    if (!pose) throw new Error("pose missing");
    if (directPath && directPath.startsWith("/storage/")) return directPath;
    if (directPath && (directPath.startsWith("http://") || directPath.startsWith("https://"))) {
      return upgradeToHttpsIfNeeded(directPath);
    }
    const signed = await getSignedImageUrl(pose.id, imageType, { allowProxyFallback: true });
    return upgradeToHttpsIfNeeded(signed);
  };

  /**
   * Handles the regeneration process.
   * Sends: schema (if available) + selected image (photo OR muscles based on tab).
   */
  const handleRegenerate = async () => {
    if (isStarting || !pose) return;

    setIsStarting(true);
    setLocalError(null);

    try {
      // Use user's feedback directly as the prompt
      const regenerationNotes = feedback.trim() || undefined;

      // If we have a stored schema, prefer server-side generation from the pose.
      // This avoids unnecessary image downloads in the browser and reduces the
      // chance of regeneration failing due to signed URL / payload size issues.
      if (pose.schema_path) {
        try {
          await startFromPose({
            poseId: pose.id,
            poseName: pose.name,
            mode: "regenerate",
            additionalNotes: regenerationNotes,
          });
          return;
        } catch (err) {
          const status = (err as Error & { status?: number })?.status;
          // If the server rejects the request due to user input (validation/permissions),
          // falling back to client-side upload won't help; surface the error instead.
          const allowUploadFallback = status === 400 || status === 404 || status === 413;
          if (typeof status === "number" && status >= 400 && status < 500 && !allowUploadFallback) {
            throw err;
          }

          // If we have no status at all (likely a transient network error), prefer surfacing
          // the failure so the user can retry rather than doing extra work client-side.
          if (typeof status !== "number") {
            throw err;
          }

          logger.warn(
            "startFromPose failed; falling back to client-side upload regeneration",
            err,
          );
        }
      }

      // Determine which image to use based on activeTab (fallback path).
      const useMusclePath = activeTab === "muscles" && pose.muscle_layer_path;
      const selectedDirectPath = useMusclePath ? pose.muscle_layer_path : pose.photo_path;

      // Fetch schema if available
      let schemaFile: File | undefined;
      if (pose.schema_path) {
        try {
          const schemaUrl = await resolveSourceUrl(pose.schema_path, "schema");
          schemaFile = await fetchImageAsFile(schemaUrl, `${pose.code}_schema.png`);
        } catch (err) {
          // Schema may be missing/corrupted even though the DB field is set.
          // In that case, continue with reference photo-only regeneration rather than failing the whole flow.
          logger.warn("Failed to fetch schema for regeneration fallback; using reference photo only", err);
          schemaFile = undefined;
        }
      }

      // IMPORTANT: Backend currently accepts only a single `schema_file`.
      // If we can fetch the schema, we should proceed without also requiring the current image.
      // Otherwise, a broken/missing photo could block regeneration even though schema is present.
      if (schemaFile) {
        await startRegenerationUpload({
          poseId: pose.id,
          poseName: pose.name,
          mode: "regenerate",
          schemaFile,
          referencePhoto: schemaFile,
          additionalNotes: regenerationNotes,
        });
        return;
      }

      // No schema available; fall back to uploading the selected current image.
      if (!selectedDirectPath) {
        setLocalError(t("regenerate.no_source_image"));
        return;
      }

      const selectedImageUrl = useMusclePath
        ? await resolveSourceUrl(selectedDirectPath, "muscle_layer")
        : await resolveSourceUrl(selectedDirectPath, "photo");

      let selectedImage: File;
      try {
        selectedImage = await fetchImageAsFile(
          selectedImageUrl,
          `${pose.code}_${useMusclePath ? "muscles" : "photo"}.png`,
        );
      } catch (err) {
        // If the user is viewing muscles but the overlay is missing/corrupted, fall back to the photo.
        // Regeneration should still be possible when at least one source image exists.
        if (useMusclePath && pose.photo_path) {
          logger.warn("Failed to fetch muscle layer for regeneration; falling back to photo", err);
          const photoUrl = await resolveSourceUrl(pose.photo_path, "photo");
          selectedImage = await fetchImageAsFile(photoUrl, `${pose.code}_photo.png`);
        } else if (!useMusclePath && pose.muscle_layer_path) {
          // Symmetric fallback: if the photo is missing/corrupted but the muscles overlay exists,
          // use the overlay so regeneration still works.
          logger.warn("Failed to fetch photo for regeneration; falling back to muscle layer", err);
          const muscleUrl = await resolveSourceUrl(pose.muscle_layer_path, "muscle_layer");
          selectedImage = await fetchImageAsFile(muscleUrl, `${pose.code}_muscles.png`);
        } else {
          throw err;
        }
      }

      // Send schema + selected image for regeneration
      await startRegenerationUpload({
        poseId: pose.id,
        poseName: pose.name,
        mode: "regenerate",
        referencePhoto: selectedImage,
        additionalNotes: regenerationNotes,
      });
    } catch (err) {
      logger.error("Regeneration error:", err);
      const message = err instanceof Error ? err.message : t("generate.error_failed");
      setLocalError(message);
    } finally {
      setIsStarting(false);
    }
  };

  const handleClose = useCallback((open: boolean) => {
    // Only handle close events (open=false), not open events
    if (open) return;

    // Closing is always allowed; regeneration continues in background.
    setFeedback("");
    setLocalError(null);
    setIsStarting(false);
    onClose();
  }, [onClose]);

  // Get current image URL based on active tab
  const isShowingMuscles = activeTab === "muscles" && Boolean(pose?.muscle_layer_path);
  const currentImageType = isShowingMuscles ? "muscle_layer" : "photo";
  const currentDirectPath = isShowingMuscles ? pose?.muscle_layer_path : pose?.photo_path;
  const { src: currentImageSrc, refresh: refreshCurrentImage } = usePoseImageSrc(
    currentDirectPath,
    pose?.id ?? 0,
    currentImageType,
    { enabled: Boolean(pose && currentDirectPath && isOpen), version: pose?.version },
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
                  <div className="aspect-square max-w-72 mx-auto">
                    <img
                      src={currentImageSrc}
                      alt={isShowingMuscles ? t("regenerate.alt_muscle_image") : t("regenerate.alt_photo_image")}
                      className="w-full h-full object-contain rounded-lg"
                      onError={() => void refreshCurrentImage(true)}
                    />
                  </div>
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
                maxLength={500}
                className="border-stone-200 resize-none min-h-[100px]"
                data-testid="pose-regenerate-feedback"
              />
              <p className="text-xs text-stone-400">{t("regenerate.feedback_hint")}</p>
            </div>

            {(taskError || generationTask?.autoApplyError || localError) && (
              <div className="p-4 bg-red-50 text-red-700 rounded-xl text-sm">
                {generationTask?.autoApplyError || taskError || localError}
              </div>
            )}

            <Button
              onClick={handleRegenerate}
              className="w-full bg-stone-800 hover:bg-stone-900 text-white h-12 rounded-xl"
              data-testid="pose-regenerate-start"
              disabled={isStarting}
            >
              <RefreshCw className="w-4 h-4 mr-2" />
              {t("regenerate.start")}
            </Button>
          </div>
        ) : (
          <div className="py-8" data-testid="pose-regenerate-progress">
            {/* Progress bar */}
            <div className="mb-6">
              <div className="flex justify-between text-xs text-stone-500 mb-2">
                <span>{statusMessage || t("generate.modal_progress")}</span>
                <span>{Math.min(progress, 100)}%</span>
              </div>
              <div className="h-2 bg-stone-200 rounded-full overflow-hidden">
                <div
                  className="h-full bg-stone-800 rounded-full transition-[width] duration-700 ease-out"
                  style={{ width: `${Math.min(progress, 100)}%` }}
                />
              </div>
            </div>

            <div className="space-y-3">
              {generationSteps.map((step, index) => {
                const Icon = step.icon;
                const stepState = getStepState(generationSteps, index, progress, isComplete);
                const isActive = stepState === "active";
                const isStepComplete = stepState === "complete";
                const isPending = stepState === "pending";

                return (
                  <div
                    key={step.id}
                    className={cn(
                      "flex items-center gap-4 p-4 rounded-xl transition-colors duration-300",
                      isActive && "bg-stone-100",
                      isStepComplete && "bg-emerald-50",
                      isPending && "bg-stone-50 opacity-50",
                    )}
                  >
                    <div
                      className={cn(
                        "w-10 h-10 rounded-full flex items-center justify-center transition-colors duration-300",
                        isActive && "bg-stone-800",
                        isStepComplete && "bg-emerald-500",
                        isPending && "bg-stone-200",
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
                          isPending && "text-stone-400",
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
