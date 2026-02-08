import React, { useState, useRef, useEffect, useCallback } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "../ui/dialog";
import { Button } from "../ui/button";
import { Checkbox } from "../ui/checkbox";
import { Label } from "../ui/label";
import { Textarea } from "../ui/textarea";
import { Loader2, Sparkles, Camera, Activity, Check, Upload, X } from "lucide-react";
import { cn } from "../../lib/utils";
import type { Pose, PoseListItem } from "../../types";
import { useI18n } from "../../i18n";
import { logger } from "../../lib/logger";
import { getGenerationSteps, getStepState } from "./generation-steps";
import { usePoseImageSrc } from "../../hooks/usePoseImageSrc";
import {
  selectLatestTaskForPose,
  useGenerationStore,
} from "../../store/useGenerationStore";

interface GenerateModalProps {
  pose: Pose | PoseListItem | null;
  isOpen: boolean;
  onClose: () => void;
  onComplete?: (updatedPose?: Pose) => void | Promise<void>;
}

export const GenerateModal: React.FC<GenerateModalProps> = ({
  pose,
  isOpen,
  onClose,
  onComplete,
}) => {
  const [generateMuscles, setGenerateMuscles] = useState(true);
  const [additionalNotes, setAdditionalNotes] = useState("");
  const [uploadedFile, setUploadedFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [schemaLoadError, setSchemaLoadError] = useState(false);
  const [localError, setLocalError] = useState<string | null>(null);
  const [isStarting, setIsStarting] = useState(false);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const closeCleanupTimerRef = useRef<number | null>(null);
  const handledAppliedAtRef = useRef<number | null>(null);
  const { t } = useI18n();

  const startFromPose = useGenerationStore((state) => state.startFromPose);
  const startFromUpload = useGenerationStore((state) => state.startFromUpload);

  const generationTask = useGenerationStore(
    useCallback(
      (state) => (pose ? selectLatestTaskForPose(pose.id, "generate")(state) : null),
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
  const taskGenerateMuscles = generationTask?.generateMuscles ?? generateMuscles;
  const generationSteps = getGenerationSteps(taskGenerateMuscles);

  // Track if generation is fully complete (100%)
  const isComplete = progress >= 100;

  // Helper to clear uploaded file
  const handleClearFile = useCallback(() => {
    setUploadedFile(null);
    setPreviewUrl((prev) => {
      if (prev) {
        URL.revokeObjectURL(prev);
      }
      return null;
    });
    if (fileInputRef.current) {
      fileInputRef.current.value = "";
    }
  }, []);

  const openFilePicker = useCallback(() => {
    if (!fileInputRef.current) return;
    // Allow selecting the same file repeatedly.
    fileInputRef.current.value = "";
    fileInputRef.current.click();
  }, []);

  // Cleanup preview URL on unmount to prevent memory leaks
  useEffect(() => {
    return () => {
      if (previewUrl) {
        URL.revokeObjectURL(previewUrl);
      }
    };
  }, [previewUrl]);

  const handleFileSelect = useCallback((file: File) => {
    if (file && file.type.startsWith("image/")) {
      // Revoke previous URL before creating new one
      setPreviewUrl((prev) => {
        if (prev) {
          URL.revokeObjectURL(prev);
        }
        return URL.createObjectURL(file);
      });
      setUploadedFile(file);
    }
  }, []);

  // Check if pose has existing schema (on the server). Preview may still fail to load in the browser.
  const hasSchema = Boolean(pose?.schema_path && pose.schema_path.trim());
  const {
    src: schemaSrc,
    loading: schemaLoading,
    error: schemaError,
    refresh: refreshSchema,
  } = usePoseImageSrc(
    pose?.schema_path,
    pose?.id ?? 0,
    "schema",
    { enabled: hasSchema, version: pose?.version },
  );
  const showSchemaPreview =
    hasSchema &&
    !schemaLoadError &&
    (Boolean(schemaSrc) || schemaLoading || !schemaError);
  const hasUploadedFile = Boolean(uploadedFile);

  // Preview failures should not block generation:
  // - <img> load errors can be caused by proxy/CORS/network issues even when the server can still access schema.
  // - We handle server-side failures (missing/corrupt schema) when the request is made.
  const canGenerate = hasUploadedFile || hasSchema;

  // React on successful auto-apply even if the modal is currently closed.
  useEffect(() => {
    if (!generationTask) return;
    if (generationTask.autoApplyStatus !== "applied") return;
    if (!generationTask.appliedAt) return;
    if (handledAppliedAtRef.current === generationTask.appliedAt) return;

    handledAppliedAtRef.current = generationTask.appliedAt;

    void Promise.resolve(onComplete?.(generationTask.appliedPose ?? undefined)).catch(
      (err) => {
        logger.warn("GenerateModal onComplete failed", err);
      },
    );

    handleClearFile();
    setSchemaLoadError(false);
    setAdditionalNotes("");
    setLocalError(null);

    if (isOpen) {
      onClose();
    }
  }, [generationTask, handleClearFile, isOpen, onClose, onComplete]);

  /**
   * Handles the generation process:
   * 1. If user uploaded a file, use it directly
   * 2. If pose has existing schema, use server-side fetch (avoids CORS)
   */
  const handleGenerate = async () => {
    if (!pose || isStarting) return;

    setLocalError(null);
    setIsStarting(true);

    try {
      // Pass additional notes if provided
      const notes = additionalNotes.trim() || undefined;

      if (uploadedFile) {
        // User uploaded a new file - use it directly
        await startFromUpload({
          poseId: pose.id,
          poseName: pose.name,
          mode: "generate",
          file: uploadedFile,
          additionalNotes: notes,
          generateMuscles,
        });
      } else if (pose.schema_path) {
        // Use server-side fetch to avoid CORS issues
        await startFromPose({
          poseId: pose.id,
          poseName: pose.name,
          mode: "generate",
          additionalNotes: notes,
          generateMuscles,
        });
      } else {
        setLocalError(t("generate.error_failed"));
        return;
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : t("generate.error_failed");
      setLocalError(message);
    } finally {
      setIsStarting(false);
    }
  };

  const handleClose = useCallback((open: boolean) => {
    // Only handle close events (open=false), not open events
    if (open) return;

    // Closing is always allowed; generation continues in background.
    onClose();
  }, [onClose]);

  // Defer cleanup until close animation is finished to avoid layout "jumping".
  useEffect(() => {
    if (isOpen) return;

    if (closeCleanupTimerRef.current) {
      window.clearTimeout(closeCleanupTimerRef.current);
    }

    closeCleanupTimerRef.current = window.setTimeout(() => {
      handleClearFile();
      setSchemaLoadError(false);
      setLocalError(null);
      setAdditionalNotes("");
      setIsStarting(false);
      closeCleanupTimerRef.current = null;
    }, 220);

    return () => {
      if (closeCleanupTimerRef.current) {
        window.clearTimeout(closeCleanupTimerRef.current);
        closeCleanupTimerRef.current = null;
      }
    };
  }, [handleClearFile, isOpen]);

  if (!pose) return null;

  return (
    <Dialog open={isOpen} onOpenChange={handleClose}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="text-xl font-medium">
            {t("generate.tab_title", { pose: pose.name })}
          </DialogTitle>
          <DialogDescription>
            {t("generate.tab_description")}
          </DialogDescription>
        </DialogHeader>

        {!isGenerating ? (
          <div className="space-y-6 pt-4">
            {/* Source schematic section */}
            <div>
              <Label className="text-stone-600 mb-2 block">{t("generate.source_schematic")}</Label>

              {/* Hidden file input */}
              <input
                ref={fileInputRef}
                type="file"
                accept="image/png,image/jpeg,image/webp"
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file) {
                    handleFileSelect(file);
                  }
                  // Ensure selecting the same file again still triggers onChange.
                  e.currentTarget.value = "";
                }}
                className="hidden"
              />

              {/* Show uploaded file preview */}
              {previewUrl ? (
                <div className="relative rounded-xl overflow-hidden bg-stone-50 p-4">
                  <div className="aspect-square max-w-64 mx-auto">
                    <img
                      src={previewUrl}
                      alt={t("generate.alt_schematic")}
                      className="w-full h-full object-contain"
                    />
                  </div>
                  <button
                    onClick={handleClearFile}
                    className="absolute top-2 right-2 bg-white/90 backdrop-blur-sm rounded-full p-1.5 shadow-sm hover:bg-white transition-colors"
                  >
                    <X className="w-4 h-4 text-stone-600" />
                  </button>
                </div>
              ) : showSchemaPreview ? (
                /* Show existing schema */
                <div className="relative rounded-xl overflow-hidden bg-stone-50 p-4">
                  <div className="aspect-square max-w-64 mx-auto">
                    {schemaSrc ? (
                      <img
                        src={schemaSrc}
                        alt={t("generate.alt_schematic")}
                        className="w-full h-full object-contain"
                        onLoad={() => setSchemaLoadError(false)}
                        onError={() => {
                          // Try refreshing signed URL once; if it still fails, show upload area.
                          if (!schemaLoadError) {
                            setSchemaLoadError(true);
                            void refreshSchema(true);
                          }
                        }}
                      />
                    ) : (
                      <div className="w-full h-full flex items-center justify-center text-stone-400 text-sm">
                        {isOpen ? t("common.loading") : ""}
                      </div>
                    )}
                  </div>
                  <button
                    type="button"
                    onClick={openFilePicker}
                    className="mt-3 w-full text-sm text-stone-600 hover:text-stone-800 transition-colors"
                  >
                    {t("generate.upload_schematic_button")}
                  </button>
                </div>
              ) : (
                /* Upload area when no schema exists */
                <div
                  onClick={openFilePicker}
                  className="border-2 border-dashed border-stone-200 rounded-xl p-8 text-center cursor-pointer hover:border-stone-300 hover:bg-stone-50 transition-colors"
                  data-testid="pose-generate-upload-area"
                >
                  <div className="w-12 h-12 rounded-full bg-stone-100 flex items-center justify-center mx-auto mb-3">
                    <Upload className="w-5 h-5 text-stone-400" />
                  </div>
                  <p className="text-stone-600 font-medium">{t("generate.upload_schematic_button")}</p>
                  <p className="text-stone-400 text-sm mt-1">{t("generate.formats")}</p>
                </div>
              )}
            </div>

            <div className="space-y-4">
              <h3 className="text-sm font-medium text-stone-700">{t("generate.options")}</h3>
              <div className="space-y-3">
                <div className="flex items-center gap-3 p-3 bg-stone-50 rounded-xl">
                  <Camera className="w-5 h-5 text-stone-600" />
                  <div className="flex-1">
                    <p className="font-medium text-stone-800">{t("generate.photo_label")}</p>
                    <p className="text-sm text-stone-500">{t("generate.photo_hint")}</p>
                  </div>
                  <div className="text-stone-400 text-sm">{t("generate.required")}</div>
                </div>

                <label className="flex items-center gap-3 p-3 bg-stone-50 rounded-xl cursor-pointer hover:bg-stone-100 transition-colors">
                  <Activity className="w-5 h-5 text-stone-600" />
                  <div className="flex-1">
                    <p className="font-medium text-stone-800">{t("generate.muscles_label")}</p>
                    <p className="text-sm text-stone-500">{t("generate.muscles_hint")}</p>
                  </div>
                  <Checkbox
                    checked={generateMuscles}
                    onCheckedChange={(checked) => setGenerateMuscles(checked as boolean)}
                  />
                </label>
              </div>
            </div>

            <div className="space-y-2">
              <Label className="text-stone-600">{t("generate.notes")}</Label>
              <Textarea
                value={additionalNotes}
                onChange={(e) => setAdditionalNotes(e.target.value)}
                placeholder={t("generate.notes_placeholder")}
                maxLength={500}
                className="border-stone-200 resize-none"
                data-testid="pose-generate-notes"
              />
            </div>

            {(taskError || generationTask?.autoApplyError || localError) && (
              <div className="p-4 bg-red-50 text-red-700 rounded-xl text-sm">
                {generationTask?.autoApplyError || taskError || localError}
              </div>
            )}

            <Button
              onClick={handleGenerate}
              className="w-full bg-stone-800 hover:bg-stone-900 text-white h-12 rounded-xl"
              disabled={!canGenerate || isStarting}
              data-testid="pose-generate-start"
            >
              <Sparkles className="w-4 h-4 mr-2" />
              {t("generate.start")}
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
