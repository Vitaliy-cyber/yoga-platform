import React, { useState, useRef, useEffect, useCallback } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "../ui/dialog";
import { Button } from "../ui/button";
import { Checkbox } from "../ui/checkbox";
import { Label } from "../ui/label";
import { Textarea } from "../ui/textarea";
import { Loader2, Sparkles, Camera, Activity, Lightbulb, Check, Upload, X } from "lucide-react";
import { cn } from "../../lib/utils";
import type { Pose, PoseListItem } from "../../types";
import { useGenerate } from "../../hooks/useGenerate";
import { posesApi, getImageProxyUrl } from "../../services/api";
import { useI18n } from "../../i18n";

// Backend progress values:
// 5% - Initializing
// 10% - Analyzing pose
// 30% - Generating photo (starts)
// 60% - Generating muscles (starts)
// 100% - Completed
const steps = [
  { id: "analyzing", labelKey: "generate.modal_progress", icon: Lightbulb, progressThreshold: 10 },
  { id: "generating_photo", labelKey: "generate.modal_progress", icon: Camera, progressThreshold: 30 },
  { id: "generating_muscles", labelKey: "generate.modal_progress", icon: Activity, progressThreshold: 60 },
] as const;

// Determine which step is active based on progress
function getStepState(stepIndex: number, progress: number, isComplete: boolean) {
  const step = steps[stepIndex];
  const nextStep = steps[stepIndex + 1];
  
  if (isComplete) {
    return "complete";
  }
  
  // Step is complete if progress has passed the NEXT step's threshold (or 100 if last step)
  const nextThreshold = nextStep?.progressThreshold ?? 100;
  if (progress >= nextThreshold) {
    return "complete";
  }
  
  // Step is active if progress is >= this step's threshold but < next threshold
  if (progress >= step.progressThreshold) {
    return "active";
  }
  
  return "pending";
}

interface GenerateModalProps {
  pose: Pose | PoseListItem | null;
  isOpen: boolean;
  onClose: () => void;
  onComplete?: () => void;
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
  const fileInputRef = useRef<HTMLInputElement>(null);
  const { isGenerating, progress, statusMessage, error, photoUrl, musclesUrl, generate, reset } = useGenerate();
  const [generationStarted, setGenerationStarted] = useState(false);
  const { t } = useI18n();

  // Track if generation is fully complete (100%)
  const isComplete = progress >= 100;
  
  // Ref to prevent double saves
  const savingRef = useRef(false);

  // Helper to clear uploaded file
  const handleClearFile = useCallback(() => {
    setUploadedFile(null);
    setPreviewUrl((prev) => {
      if (prev) {
        URL.revokeObjectURL(prev);
      }
      return null;
    });
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

  // Check if pose has existing schema (and it loaded successfully)
  const hasExistingSchema = Boolean(pose?.schema_path && pose.schema_path.trim()) && !schemaLoadError;
  const hasUploadedFile = Boolean(uploadedFile);
  const canGenerate = hasUploadedFile || (hasExistingSchema && !schemaLoadError);
  
  // Save generated images to database when generation completes
  useEffect(() => {
    const saveGeneratedImages = async () => {
      // Prevent multiple saves with ref (more reliable than state)
      if (!generationStarted || !photoUrl || isGenerating || savingRef.current || !pose) {
        return;
      }
      
      savingRef.current = true;
      
      try {
        // Update the pose with the generated image URLs
        await posesApi.update(pose.id, {
          photo_path: photoUrl,
          ...(musclesUrl && { muscle_layer_path: musclesUrl }),
        });
        
        // Notify parent to refresh data
        onComplete?.();
      } catch (err) {
        console.error(t("generate.save_failed"), err);
        // Still notify parent - the images are generated, just not saved to pose
        onComplete?.();
      } finally {
        // Reset and close
        savingRef.current = false;
        setGenerationStarted(false);
        reset();
        handleClearFile();
        setSchemaLoadError(false);
        onClose();
      }
    };
    
    saveGeneratedImages();
  }, [photoUrl, musclesUrl, isGenerating, pose, generationStarted, onComplete, onClose, reset, handleClearFile]);

  /**
   * Handles the generation process:
   * 1. Uses uploaded file if available, otherwise fetches existing schema via proxy
   * 2. Converts schema to File object for the generate API
   * 3. Shows errors to user via localError state if fetch or generation fails
   */
  const handleGenerate = async () => {
    let fileToGenerate: File | null = null;
    setLocalError(null);
    
    try {
      // Priority: use newly uploaded file, fallback to existing schema from database
      if (uploadedFile) {
        fileToGenerate = uploadedFile;
      } else if (pose?.schema_path) {
        // Fetch existing schema via proxy to avoid CORS issues with S3/storage
        const proxyUrl = getImageProxyUrl(pose.id, 'schema');
        const response = await fetch(proxyUrl);
        if (!response.ok) {
          throw new Error(`${t("generate.schema_fetch_failed")}: ${response.status}`);
        }
        const blob = await response.blob();
        fileToGenerate = new File([blob], "schema.png", { type: blob.type || "image/png" });
      }
      
      if (!fileToGenerate) {
        setLocalError(t("generate.error_failed"));
        return;
      }
      
      // Mark that generation started in this session
      setGenerationStarted(true);
      await generate(fileToGenerate);
      // onComplete will be called by useEffect when photoUrl is set
    } catch (err) {
      console.error("Generation error:", err);
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
    handleClearFile();
    setSchemaLoadError(false);
    setGenerationStarted(false);
    onClose();
  }, [reset, handleClearFile, onClose]);

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
                onChange={(e) => e.target.files?.[0] && handleFileSelect(e.target.files[0])}
                className="hidden"
              />
              
              {/* Show uploaded file preview */}
              {previewUrl ? (
                <div className="relative rounded-xl overflow-hidden bg-stone-50 p-4">
                  <img
                    src={previewUrl}
                    alt={t("generate.alt_schematic")}
                    className="max-h-48 mx-auto object-contain"
                  />
                  <button
                    onClick={handleClearFile}
                    className="absolute top-2 right-2 bg-white/90 backdrop-blur-sm rounded-full p-1.5 shadow-sm hover:bg-white transition-colors"
                  >
                    <X className="w-4 h-4 text-stone-600" />
                  </button>
                </div>
              ) : hasExistingSchema ? (
                /* Show existing schema */
                <div className="relative rounded-xl overflow-hidden bg-stone-50 p-4">
                  <img
                    src={getImageProxyUrl(pose.id, 'schema')}
                    alt={t("generate.alt_schematic")}
                    className="max-h-48 mx-auto object-contain"
                    onError={() => setSchemaLoadError(true)}
                  />
                </div>
              ) : (
                /* Upload area when no schema exists */
                <div
                  onClick={() => fileInputRef.current?.click()}
                  className="border-2 border-dashed border-stone-200 rounded-xl p-8 text-center cursor-pointer hover:border-stone-300 hover:bg-stone-50 transition-colors"
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
                className="border-stone-200 resize-none"
              />
            </div>

            {(error || localError) && (
              <div className="p-4 bg-red-50 text-red-700 rounded-xl text-sm">
                {error || localError}
              </div>
            )}

            <Button
              onClick={handleGenerate}
              className="w-full bg-stone-800 hover:bg-stone-900 text-white h-12 rounded-xl"
              disabled={!canGenerate}
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
                  className="h-full bg-stone-800 rounded-full transition-all duration-700 ease-out"
                  style={{ width: `${Math.min(progress, 100)}%` }}
                />
              </div>
            </div>

            <div className="space-y-3">
              {steps.map((step, index) => {
                const Icon = step.icon;
                const stepState = getStepState(index, progress, isComplete);
                const isActive = stepState === "active";
                const isStepComplete = stepState === "complete";
                const isPending = stepState === "pending";
                
                // Hide muscles step if not generating muscles
                if (step.id === "generating_muscles" && !generateMuscles) return null;

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
