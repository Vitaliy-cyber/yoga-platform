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

// Backend progress values:
// 5% - Initializing
// 10% - Analyzing pose
// 30% - Generating photo (starts)
// 60% - Generating muscles (starts)
// 100% - Completed
const steps = [
  { id: "analyzing", label: "Analyzing pose structure", icon: Lightbulb, progressThreshold: 10 },
  { id: "generating_photo", label: "Generating photorealistic image", icon: Camera, progressThreshold: 30 },
  { id: "generating_muscles", label: "Creating muscle visualization", icon: Activity, progressThreshold: 60 },
];

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
  const fileInputRef = useRef<HTMLInputElement>(null);
  const { isGenerating, progress, statusMessage, error, photoUrl, musclesUrl, generate, reset } = useGenerate();
  const [generationStarted, setGenerationStarted] = useState(false);

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

  const handleFileSelect = (file: File) => {
    if (file && file.type.startsWith("image/")) {
      setUploadedFile(file);
      setPreviewUrl(URL.createObjectURL(file));
    }
  };

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
        console.error("Failed to save generated images:", err);
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

  const handleGenerate = async () => {
    let fileToGenerate: File | null = null;
    
    try {
      if (uploadedFile) {
        fileToGenerate = uploadedFile;
      } else if (pose?.schema_path) {
        // Use proxy URL to avoid CORS issues
        const proxyUrl = getImageProxyUrl(pose.id, 'schema');
        const response = await fetch(proxyUrl);
        if (!response.ok) {
          throw new Error(`Failed to fetch schema: ${response.status}`);
        }
        const blob = await response.blob();
        fileToGenerate = new File([blob], "schema.png", { type: blob.type || "image/png" });
      }
      
      if (!fileToGenerate) {
        return;
      }
      
      // Mark that generation started in this session
      setGenerationStarted(true);
      await generate(fileToGenerate);
      // onComplete will be called by useEffect when photoUrl is set
    } catch (err) {
      console.error("Generation error:", err);
    }
  };

  const handleClose = useCallback(() => {
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
          <DialogTitle className="text-xl font-medium">Generate Images for "{pose.name}"</DialogTitle>
          <DialogDescription>
            Generate photorealistic images from the source schematic using AI.
          </DialogDescription>
        </DialogHeader>

        {!isGenerating ? (
          <div className="space-y-6 pt-4">
            {/* Source schematic section */}
            <div>
              <Label className="text-stone-600 mb-2 block">Source schematic</Label>
              
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
                    alt="Uploaded schematic"
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
                    alt="Source schematic"
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
                  <p className="text-stone-600 font-medium">Upload a schematic</p>
                  <p className="text-stone-400 text-sm mt-1">PNG, JPG or WEBP</p>
                </div>
              )}
            </div>

            <div className="space-y-4">
              <h3 className="text-sm font-medium text-stone-700">What to generate:</h3>
              <div className="space-y-3">
                <div className="flex items-center gap-3 p-3 bg-stone-50 rounded-xl">
                  <Camera className="w-5 h-5 text-stone-600" />
                  <div className="flex-1">
                    <p className="font-medium text-stone-800">Photorealistic Image</p>
                    <p className="text-sm text-stone-500">Studio-quality photograph</p>
                  </div>
                  <div className="text-stone-400 text-sm">Required</div>
                </div>

                <label className="flex items-center gap-3 p-3 bg-stone-50 rounded-xl cursor-pointer hover:bg-stone-100 transition-colors">
                  <Activity className="w-5 h-5 text-stone-600" />
                  <div className="flex-1">
                    <p className="font-medium text-stone-800">Muscle Visualization</p>
                    <p className="text-sm text-stone-500">Active muscle groups highlighted</p>
                  </div>
                  <Checkbox
                    checked={generateMuscles}
                    onCheckedChange={(checked) => setGenerateMuscles(checked as boolean)}
                  />
                </label>
              </div>
            </div>

            <div className="space-y-2">
              <Label className="text-stone-600">Additional notes (optional)</Label>
              <Textarea
                value={additionalNotes}
                onChange={(e) => setAdditionalNotes(e.target.value)}
                placeholder="e.g., Male subject, athletic build, specific lighting preferences..."
                className="border-stone-200 resize-none"
              />
            </div>

            {error && (
              <div className="p-4 bg-red-50 text-red-700 rounded-xl text-sm">
                {error}
              </div>
            )}

            <Button
              onClick={handleGenerate}
              className="w-full bg-stone-800 hover:bg-stone-900 text-white h-12 rounded-xl"
              disabled={!canGenerate}
            >
              <Sparkles className="w-4 h-4 mr-2" />
              Start Generation
            </Button>
          </div>
        ) : (
          <div className="py-8">
            {/* Progress bar */}
            <div className="mb-6">
              <div className="flex justify-between text-xs text-stone-500 mb-2">
                <span>{statusMessage || "Processing..."}</span>
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
                        {step.label}
                      </p>
                    </div>
                  </div>
                );
              })}
            </div>
            <p className="text-center text-stone-500 text-sm mt-6">
              This may take up to a minute. Please don't close this window.
            </p>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
};
