import React, { useState, useRef, useEffect } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "../ui/dialog";
import { Button } from "../ui/button";
import { Checkbox } from "../ui/checkbox";
import { Label } from "../ui/label";
import { Textarea } from "../ui/textarea";
import { Loader2, Sparkles, Camera, Activity, Lightbulb, Check, Upload, X } from "lucide-react";
import { cn } from "../../lib/utils";
import type { Pose, PoseListItem } from "../../types";
import { useGenerate } from "../../hooks/useGenerate";
import { posesApi } from "../../services/api";

const steps = [
  { id: "analyzing", label: "Analyzing pose structure...", icon: Lightbulb, minProgress: 0, maxProgress: 30 },
  { id: "generating_photo", label: "Generating photorealistic image...", icon: Camera, minProgress: 30, maxProgress: 60 },
  { id: "generating_muscles", label: "Creating muscle visualization...", icon: Activity, minProgress: 60, maxProgress: 100 },
];

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
  const [isSaving, setIsSaving] = useState(false);
  const [generationStarted, setGenerationStarted] = useState(false);

  // Determine current step based on progress
  // Backend sends: 10% (analyzing), 30% (photo start), 60% (muscles start), 100% (done)
  const currentStep = progress < 30 ? 0 : progress < 60 ? 1 : progress < 100 ? 2 : 2;
  
  // Save generated images to database when generation completes
  // Only trigger if generation was started in this modal session
  useEffect(() => {
    const saveGeneratedImages = async () => {
      if (generationStarted && photoUrl && !isGenerating && !isSaving && pose) {
        setIsSaving(true);
        try {
          // Update the pose with the generated image URLs
          await posesApi.update(pose.id, {
            photo_path: photoUrl,
            ...(musclesUrl && { muscle_layer_path: musclesUrl }),
          });
          
          // Notify parent to refresh data
          if (onComplete) {
            onComplete();
          }
          handleClose();
        } catch (err) {
          console.error("Failed to save generated images:", err);
          // Still close and refresh - the images are generated, just not saved to pose
          if (onComplete) {
            onComplete();
          }
          handleClose();
        }
      }
    };
    
    saveGeneratedImages();
  }, [photoUrl, musclesUrl, isGenerating, pose, generationStarted]);
  
  // Check if pose has existing schema (and it loaded successfully)
  const hasExistingSchema = Boolean(pose?.schema_path && pose.schema_path.trim()) && !schemaLoadError;
  const hasUploadedFile = Boolean(uploadedFile);
  const canGenerate = hasUploadedFile || (hasExistingSchema && !schemaLoadError);

  const handleFileSelect = (file: File) => {
    if (file && file.type.startsWith("image/")) {
      setUploadedFile(file);
      setPreviewUrl(URL.createObjectURL(file));
    }
  };

  const handleClearFile = () => {
    setUploadedFile(null);
    if (previewUrl) {
      URL.revokeObjectURL(previewUrl);
      setPreviewUrl(null);
    }
  };

  const handleGenerate = async () => {
    let fileToGenerate: File | null = null;
    
    try {
      if (uploadedFile) {
        fileToGenerate = uploadedFile;
      } else if (pose?.schema_path) {
        const response = await fetch(pose.schema_path);
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

  const handleClose = () => {
    reset();
    handleClearFile();
    setSchemaLoadError(false);
    setIsSaving(false);
    setGenerationStarted(false);
    onClose();
  };

  if (!pose) return null;

  return (
    <Dialog open={isOpen} onOpenChange={handleClose}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="text-xl font-medium">Generate Images for "{pose.name}"</DialogTitle>
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
                    src={pose.schema_path!}
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
                <span>Progress</span>
                <span>{progress}%</span>
              </div>
              <div className="h-2 bg-stone-200 rounded-full overflow-hidden">
                <div 
                  className="h-full bg-stone-800 rounded-full transition-all duration-500 ease-out"
                  style={{ width: `${progress}%` }}
                />
              </div>
            </div>

            <div className="space-y-3">
              {steps.map((step, index) => {
                const Icon = step.icon;
                const isActive = index === currentStep && progress < 100;
                const isComplete = index < currentStep || progress >= 100;
                if (step.id === "generating_muscles" && !generateMuscles) return null;

                return (
                  <div
                    key={step.id}
                    className={cn(
                      "flex items-center gap-4 p-4 rounded-xl transition-all duration-200",
                      isActive && "bg-stone-100",
                      isComplete && "bg-emerald-50",
                      !isActive && !isComplete && "bg-stone-50 opacity-60"
                    )}
                  >
                    <div
                      className={cn(
                        "w-10 h-10 rounded-full flex items-center justify-center transition-colors duration-200",
                        isActive && "bg-stone-800",
                        isComplete && "bg-emerald-500",
                        !isActive && !isComplete && "bg-stone-200"
                      )}
                    >
                      {isActive ? (
                        <Loader2 className="w-5 h-5 text-white animate-spin" />
                      ) : isComplete ? (
                        <Check className="w-5 h-5 text-white" />
                      ) : (
                        <Icon className="w-5 h-5 text-stone-400" />
                      )}
                    </div>
                    <div className="flex-1">
                      <p
                        className={cn(
                          "font-medium transition-colors duration-200",
                          isActive && "text-stone-800",
                          isComplete && "text-emerald-700",
                          !isActive && !isComplete && "text-stone-500"
                        )}
                      >
                        {step.label}
                      </p>
                      {isActive && statusMessage && (
                        <p className="text-xs text-stone-500 mt-1">{statusMessage}</p>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
            <p className="text-center text-stone-500 text-sm mt-6">
              This may take a few minutes. Please don't close this window.
            </p>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
};
