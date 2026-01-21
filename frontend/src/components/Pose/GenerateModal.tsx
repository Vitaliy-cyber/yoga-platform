import React, { useState, useRef, useEffect, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "../ui/dialog";
import { Button } from "../ui/button";
import { Checkbox } from "../ui/checkbox";
import { Label } from "../ui/label";
import { Textarea } from "../ui/textarea";
import { Loader2, Sparkles, Camera, Activity, Lightbulb, Check, Upload, X } from "lucide-react";
import { cn } from "../../lib/utils";
import type { Pose, PoseListItem } from "../../types";
import { useGenerate } from "../../hooks/useGenerate";
import { posesApi, getImageUrl } from "../../services/api";
import { useI18n } from "../../i18n";

// Animation variants
const fadeInUp = {
  hidden: { opacity: 0, y: 20 },
  visible: { opacity: 1, y: 0, transition: { duration: 0.3 } },
};

const staggerContainer = {
  hidden: { opacity: 0 },
  visible: {
    opacity: 1,
    transition: { staggerChildren: 0.1, delayChildren: 0.1 },
  },
};

const scaleIn = {
  hidden: { opacity: 0, scale: 0.95 },
  visible: {
    opacity: 1,
    scale: 1,
    transition: { type: "spring" as const, stiffness: 300, damping: 24 }
  },
};

const progressBarSpring = {
  type: "spring" as const,
  stiffness: 100,
  damping: 15,
};

// Backend progress values:
// 5% - Initializing
// 10% - Analyzing pose
// 30% - Generating photo (starts)
// 60% - Generating muscles (starts)
// 100% - Completed
const steps = [
  { id: "analyzing", labelKey: "generate.step_analyzing", icon: Lightbulb, progressThreshold: 10 },
  { id: "generating_photo", labelKey: "generate.step_photo", icon: Camera, progressThreshold: 30 },
  { id: "generating_muscles", labelKey: "generate.step_muscles", icon: Activity, progressThreshold: 60 },
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
  const { isGenerating, progress, statusMessage, error, photoUrl, musclesUrl, analyzedMuscles, generate, generateFromPose, reset } = useGenerate();
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
        // Update the pose with the generated image URLs and analyzed muscles
        await posesApi.update(pose.id, {
          photo_path: photoUrl,
          ...(musclesUrl && { muscle_layer_path: musclesUrl }),
          ...(analyzedMuscles && analyzedMuscles.length > 0 && { analyzed_muscles: analyzedMuscles }),
        });

        // Notify parent to refresh data
        onComplete?.();
      } catch (err) {
        console.error(t("generate.save_failed"), err);
        // Still notify parent - the images are generated, just not saved to pose
        onComplete?.();
      } finally {
        // Reset all states and close
        savingRef.current = false;
        setGenerationStarted(false);
        setLocalError(null);
        setAdditionalNotes("");
        setGenerateMuscles(true);
        reset();
        handleClearFile();
        setSchemaLoadError(false);
        onClose();
      }
    };
    
    saveGeneratedImages();
  }, [photoUrl, musclesUrl, analyzedMuscles, isGenerating, pose, generationStarted, onComplete, onClose, reset, handleClearFile, t]);

  /**
   * Handles the generation process:
   * 1. If user uploaded a file, use it directly
   * 2. If pose has existing schema, use server-side fetch (avoids CORS)
   * 3. Shows errors to user via localError state if generation fails
   */
  const handleGenerate = async () => {
    setLocalError(null);
    
    try {
      // Mark that generation started in this session
      setGenerationStarted(true);
      
      if (uploadedFile) {
        // User uploaded a new file - use it directly
        await generate(uploadedFile, additionalNotes);
      } else if (pose?.schema_path) {
        // Use server-side fetch to avoid CORS issues
        await generateFromPose(pose.id, additionalNotes);
      } else {
        setLocalError(t("generate.error_failed"));
        setGenerationStarted(false);
        return;
      }
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

    // Don't close if currently saving or generating
    if (savingRef.current || isGenerating) {
      return;
    }
    // Reset all states
    reset();
    handleClearFile();
    setSchemaLoadError(false);
    setGenerationStarted(false);
    setLocalError(null);
    setAdditionalNotes("");
    setGenerateMuscles(true);
    onClose();
  }, [reset, handleClearFile, onClose, isGenerating]);

  if (!pose) return null;

  return (
    <Dialog open={isOpen} onOpenChange={handleClose}>
      <DialogContent className="max-w-lg" mobileFullscreen>
        <DialogHeader className="pr-10">
          <DialogTitle className="text-lg sm:text-xl font-medium">
            {t("generate.tab_title", { pose: pose.name })}
          </DialogTitle>
          <DialogDescription className="text-sm">
            {t("generate.tab_description")}
          </DialogDescription>
        </DialogHeader>

        {!isGenerating ? (
          <div className="space-y-4 sm:space-y-6 pt-2 sm:pt-4">
            {/* Source schematic section */}
            <div>
              <Label className="text-muted-foreground mb-2 block text-sm sm:text-base">{t("generate.source_schematic")}</Label>

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
                <div className="relative rounded-xl overflow-hidden bg-muted p-3 sm:p-4">
                  <img
                    src={previewUrl}
                    alt={t("generate.alt_schematic")}
                    className="max-h-36 sm:max-h-48 mx-auto object-contain"
                  />
                  <button
                    onClick={handleClearFile}
                    className="absolute top-2 right-2 bg-card/90 backdrop-blur-sm rounded-full p-2 shadow-sm hover:bg-card transition-colors min-h-[40px] min-w-[40px] flex items-center justify-center touch-manipulation"
                  >
                    <X className="w-4 h-4 text-muted-foreground" />
                  </button>
                </div>
              ) : hasExistingSchema ? (
                /* Show existing schema */
                <div className="relative rounded-xl overflow-hidden bg-muted p-3 sm:p-4">
                  <img
                    src={getImageUrl(pose.schema_path, pose.id, 'schema')}
                    alt={t("generate.alt_schematic")}
                    className="max-h-36 sm:max-h-48 mx-auto object-contain"
                    onError={() => setSchemaLoadError(true)}
                  />
                </div>
              ) : (
                /* Upload area when no schema exists */
                <div
                  onClick={() => fileInputRef.current?.click()}
                  className="border-2 border-dashed border-border rounded-xl p-6 sm:p-8 text-center cursor-pointer hover:border-border/80 hover:bg-muted active:bg-accent transition-colors touch-manipulation"
                >
                  <div className="w-12 h-12 rounded-full bg-muted flex items-center justify-center mx-auto mb-3">
                    <Upload className="w-5 h-5 text-muted-foreground/70" />
                  </div>
                  <p className="text-muted-foreground font-medium">{t("generate.upload_schematic_button")}</p>
                  <p className="text-muted-foreground/70 text-sm mt-1">{t("generate.formats")}</p>
                </div>
              )}
            </div>

            <div className="space-y-3 sm:space-y-4">
              <h3 className="text-sm font-medium text-foreground">{t("generate.options")}</h3>
              <div className="space-y-2 sm:space-y-3">
                <div className="flex items-center gap-3 p-3 bg-muted rounded-xl min-h-[56px]">
                  <Camera className="w-5 h-5 text-muted-foreground flex-shrink-0" />
                  <div className="flex-1 min-w-0">
                    <p className="font-medium text-foreground text-sm sm:text-base">{t("generate.photo_label")}</p>
                    <p className="text-xs sm:text-sm text-muted-foreground truncate">{t("generate.photo_hint")}</p>
                  </div>
                  <div className="text-muted-foreground/70 text-xs sm:text-sm flex-shrink-0">{t("generate.required")}</div>
                </div>

                <label className="flex items-center gap-3 p-3 bg-muted rounded-xl cursor-pointer hover:bg-muted active:bg-muted transition-colors min-h-[56px] touch-manipulation">
                  <Activity className="w-5 h-5 text-muted-foreground flex-shrink-0" />
                  <div className="flex-1 min-w-0">
                    <p className="font-medium text-foreground text-sm sm:text-base">{t("generate.muscles_label")}</p>
                    <p className="text-xs sm:text-sm text-muted-foreground truncate">{t("generate.muscles_hint")}</p>
                  </div>
                  <Checkbox
                    checked={generateMuscles}
                    onCheckedChange={(checked) => setGenerateMuscles(checked as boolean)}
                    className="h-5 w-5"
                  />
                </label>
              </div>
            </div>

            <div className="space-y-2">
              <Label className="text-muted-foreground text-sm sm:text-base">{t("generate.notes")}</Label>
              <Textarea
                value={additionalNotes}
                onChange={(e) => setAdditionalNotes(e.target.value)}
                placeholder={t("generate.notes_placeholder")}
                className="border-border resize-none min-h-[70px] sm:min-h-[80px] text-sm sm:text-base"
                rows={3}
              />
              <p className="text-xs text-muted-foreground/70">
                {t("generate.notes_hint")}
              </p>
            </div>

            {(error || localError) && (
              <div className="p-3 sm:p-4 bg-red-50 dark:bg-red-900/30 text-red-700 dark:text-red-400 rounded-xl text-sm">
                {error || localError}
              </div>
            )}

            <Button
              onClick={handleGenerate}
              className="w-full bg-primary hover:bg-primary/90 active:bg-primary/80 text-primary-foreground h-12 sm:h-12 rounded-xl min-h-[48px] touch-manipulation active:scale-[0.98] transition-transform"
              disabled={!canGenerate}
            >
              <Sparkles className="w-4 h-4 mr-2" />
              {t("generate.start")}
            </Button>
          </div>
        ) : (
          <motion.div
            className="py-8"
            initial="hidden"
            animate="visible"
            variants={scaleIn}
          >
            {/* Progress bar */}
            <div className="mb-6">
              <div className="flex justify-between text-xs mb-2">
                <span className={cn(
                  "font-medium transition-colors duration-500",
                  progress < 30 && "text-amber-600",
                  progress >= 30 && progress < 70 && "text-blue-600",
                  progress >= 70 && "text-emerald-600"
                )}>{statusMessage || t("generate.modal_progress")}</span>
                <motion.span
                  key={progress}
                  initial={{ opacity: 0, y: -10 }}
                  animate={{ opacity: 1, y: 0 }}
                  className={cn(
                    "font-bold transition-colors duration-500",
                    progress < 30 && "text-amber-600",
                    progress >= 30 && progress < 70 && "text-blue-600",
                    progress >= 70 && "text-emerald-600"
                  )}
                >
                  {Math.min(progress, 100)}%
                </motion.span>
              </div>
              <div className="h-3 bg-muted rounded-full overflow-hidden">
                <motion.div
                  className={cn(
                    "h-full rounded-full relative",
                    progress < 30 && "bg-gradient-to-r from-amber-400 to-amber-500",
                    progress >= 30 && progress < 70 && "bg-gradient-to-r from-blue-400 to-blue-500",
                    progress >= 70 && "bg-gradient-to-r from-emerald-400 to-emerald-500"
                  )}
                  initial={{ width: 0 }}
                  animate={{ width: `${Math.min(progress, 100)}%` }}
                  transition={progressBarSpring}
                >
                  <div className="absolute inset-0 bg-gradient-to-r from-transparent via-white/40 to-transparent animate-progress-shimmer" />
                </motion.div>
              </div>
            </div>

            <motion.div
              className="space-y-3"
              variants={staggerContainer}
              initial="hidden"
              animate="visible"
            >
              {steps.map((step, index) => {
                const Icon = step.icon;
                const stepState = getStepState(index, progress, isComplete);
                const isActive = stepState === "active";
                const isStepComplete = stepState === "complete";
                const isPending = stepState === "pending";

                // Hide muscles step if not generating muscles
                if (step.id === "generating_muscles" && !generateMuscles) return null;

                return (
                  <motion.div
                    key={step.id}
                    variants={fadeInUp}
                    layout
                    className={cn(
                      "flex items-center gap-4 p-4 rounded-xl transition-colors duration-300",
                      isActive && "bg-muted",
                      isStepComplete && "bg-emerald-50 dark:bg-emerald-900/30",
                      isPending && "bg-muted opacity-50"
                    )}
                  >
                    <motion.div
                      className={cn(
                        "w-10 h-10 rounded-full flex items-center justify-center transition-colors duration-300",
                        isActive && "bg-primary",
                        isStepComplete && "bg-emerald-500",
                        isPending && "bg-muted"
                      )}
                      animate={isStepComplete ? { scale: [1, 1.2, 1] } : {}}
                      transition={{ duration: 0.3 }}
                    >
                      <AnimatePresence mode="wait">
                        {isActive ? (
                          <motion.div
                            key="loading"
                            initial={{ opacity: 0, rotate: -180 }}
                            animate={{ opacity: 1, rotate: 0 }}
                            exit={{ opacity: 0, rotate: 180 }}
                          >
                            <Loader2 className="w-5 h-5 text-white animate-spin" />
                          </motion.div>
                        ) : isStepComplete ? (
                          <motion.div
                            key="check"
                            initial={{ opacity: 0, scale: 0 }}
                            animate={{ opacity: 1, scale: 1 }}
                            transition={{ type: "spring", stiffness: 500, damping: 25 }}
                          >
                            <Check className="w-5 h-5 text-white" />
                          </motion.div>
                        ) : (
                          <motion.div key="icon" initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
                            <Icon className="w-5 h-5 text-muted-foreground/70" />
                          </motion.div>
                        )}
                      </AnimatePresence>
                    </motion.div>
                    <div className="flex-1">
                      <p
                        className={cn(
                          "font-medium transition-colors duration-300",
                          isActive && "text-foreground",
                          isStepComplete && "text-emerald-700 dark:text-emerald-400",
                          isPending && "text-muted-foreground/70"
                        )}
                      >
                        {t(step.labelKey)}
                      </p>
                    </div>
                  </motion.div>
                );
              })}
            </motion.div>
            <motion.p
              className="text-center text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-900/30 text-sm mt-6 px-4 py-2 rounded-lg"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ delay: 0.5 }}
            >
              {t("generate.modal_hint")}
            </motion.p>
          </motion.div>
        )}
      </DialogContent>
    </Dialog>
  );
};
