import React, { useState, useRef, useEffect } from "react";
import {
  Loader2,
  Sparkles,
  Camera,
  Activity,
  Lightbulb,
  Upload,
  FileImage,
  Type,
  Eye,
  Download,
  Layers,
  X,
  Check,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { VisuallyHidden } from "@/components/ui/visually-hidden";
import { cn } from "@/lib/utils";
import { useGenerate } from "@/hooks/useGenerate";
import { useI18n } from "@/i18n";

const steps = [
  {
    id: "analyzing",
    labelKey: "generate.modal_progress",
    icon: Lightbulb,
    minProgress: 0,
    maxProgress: 30,
  },
  {
    id: "generating_photo",
    labelKey: "generate.modal_progress",
    icon: Camera,
    minProgress: 30,
    maxProgress: 60,
  },
  {
    id: "generating_muscles",
    labelKey: "generate.modal_progress",
    icon: Activity,
    minProgress: 60,
    maxProgress: 100,
  },
] as const;

export const Generate: React.FC = () => {
  const [inputType, setInputType] = useState<"schematic" | "text">("schematic");
  const [uploadedFile, setUploadedFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [textDescription, setTextDescription] = useState("");
  const [additionalNotes, setAdditionalNotes] = useState("");
  const [generateMuscles, setGenerateMuscles] = useState(true);
  const [dragActive, setDragActive] = useState(false);
  const [viewerOpen, setViewerOpen] = useState(false);
  const [activeOverlay, setActiveOverlay] = useState<"photo" | "muscles">(
    "photo",
  );
  const fileInputRef = useRef<HTMLInputElement>(null);
  const { t } = useI18n();

  const {
    isGenerating,
    progress,
    error,
    photoUrl,
    musclesUrl,
    generate,
    generateFromText,
    reset,
  } = useGenerate();

  const effectiveMusclesUrl = generateMuscles ? musclesUrl : null;
  const hasResults = photoUrl || effectiveMusclesUrl;
  // Determine current step based on progress
  // Progress is either 0 or 100
  const currentStep =
    progress < 30 ? 0 : progress < 60 ? 1 : progress < 100 ? 2 : 2;

  // If user disables muscles generation, ensure the viewer never gets stuck on a hidden layer.
  useEffect(() => {
    if (!generateMuscles && activeOverlay === "muscles") {
      setActiveOverlay("photo");
    }
  }, [activeOverlay, generateMuscles]);

  // Cleanup preview URL on unmount to prevent memory leaks
  useEffect(() => {
    return () => {
      if (previewUrl) {
        URL.revokeObjectURL(previewUrl);
      }
    };
  }, [previewUrl]);

  const handleFileSelect = (file: File) => {
    if (file && file.type.startsWith("image/")) {
      // Revoke previous URL before creating new one
      if (previewUrl) {
        URL.revokeObjectURL(previewUrl);
      }
      setUploadedFile(file);
      setPreviewUrl(URL.createObjectURL(file));
    }
  };

  const handleDrag = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (e.type === "dragenter" || e.type === "dragover") {
      setDragActive(true);
    } else if (e.type === "dragleave") {
      setDragActive(false);
    }
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDragActive(false);
    if (e.dataTransfer.files && e.dataTransfer.files[0]) {
      handleFileSelect(e.dataTransfer.files[0]);
    }
  };

  const handleGenerate = async () => {
    try {
      if (inputType === "schematic" && uploadedFile) {
        const notes = additionalNotes.trim() ? additionalNotes.trim() : undefined;
        await generate(uploadedFile, notes, generateMuscles);
        return;
      }

      if (inputType === "text") {
        const description = textDescription.trim();
        if (!description) return;
        const notes = additionalNotes.trim() ? additionalNotes.trim() : undefined;
        await generateFromText(description, notes, generateMuscles);
      }
    } catch {
      // `useGenerate` already sets UI error state + toast.
      // Swallow to prevent `window.unhandledrejection` from async click handlers.
    }
  };

  const handleReset = () => {
    reset();
    setUploadedFile(null);
    setPreviewUrl(null);
    setTextDescription("");
    setAdditionalNotes("");
  };

  const handleDownload = async (url: string | null, name: string) => {
    if (!url) return;
    try {
      const response = await fetch(url);
      const blob = await response.blob();
      const downloadUrl = window.URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = downloadUrl;
      a.download = `yoga_pose_${name}_${Date.now()}.png`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      window.URL.revokeObjectURL(downloadUrl);
    } catch (error) {
      console.error(t("generate.download_failed"), error);
    }
  };

  const canGenerate =
    inputType === "schematic" ? !!uploadedFile : textDescription.trim().length > 0;

  return (
    <div className="min-h-screen bg-stone-50 p-6">
      <div className="max-w-6xl mx-auto">
        {/* Header */}
        <div className="mb-8">
          <h1 className="text-2xl font-semibold text-stone-800">
            {t("generate.title")}
          </h1>
          <p className="text-stone-500 mt-1">{t("generate.subtitle")}</p>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
          {/* Left Column - Input */}
          <div className="space-y-6">
            <div className="bg-white rounded-2xl border border-stone-200 p-6">
              <h2 className="text-lg font-medium text-stone-800 mb-4">
                {t("generate.source_input")}
              </h2>

              <Tabs
                value={inputType}
                onValueChange={(v) => setInputType(v as "schematic" | "text")}
                className="w-full"
              >
                <TabsList className="grid w-full grid-cols-2 bg-stone-100 p-1 rounded-xl">
                  <TabsTrigger
                    value="schematic"
                    className="rounded-lg data-[state=active]:bg-white data-[state=active]:shadow-sm"
                  >
                    <FileImage className="w-4 h-4 mr-2" />
                    {t("generate.upload_schematic")}
                  </TabsTrigger>
                  <TabsTrigger
                    value="text"
                    className="rounded-lg data-[state=active]:bg-white data-[state=active]:shadow-sm"
                  >
                    <Type className="w-4 h-4 mr-2" />
                    {t("generate.text_description")}
                  </TabsTrigger>
                </TabsList>

                <div className="mt-4 min-h-[20rem]">
                  <TabsContent value="schematic" className="mt-0">
                    <div
                      className={cn(
                        "relative min-h-[20rem] border-2 border-dashed rounded-xl transition-colors duration-200",
                        dragActive
                          ? "border-stone-400 bg-stone-50"
                          : "border-stone-200 hover:border-stone-300",
                      )}
                      onDragEnter={handleDrag}
                      onDragLeave={handleDrag}
                      onDragOver={handleDrag}
                      onDrop={handleDrop}
                    >
                      <input
                        ref={fileInputRef}
                        type="file"
                        accept="image/*"
                        onChange={(e) =>
                          e.target.files?.[0] &&
                          handleFileSelect(e.target.files[0])
                        }
                        className="hidden"
                        data-testid="generate-file-input"
                      />

                      {previewUrl ? (
                        <div className="min-h-[20rem] p-4 flex flex-col justify-center">
                          <div className="relative aspect-square max-w-[300px] mx-auto">
                            <img
                              src={previewUrl}
                              alt={t("generate.alt_schematic")}
                              className="w-full h-full object-contain rounded-lg"
                            />

                            <button
                              onClick={() => {
                                setUploadedFile(null);
                                setPreviewUrl(null);
                              }}
                              className="absolute top-2 right-2 bg-white/90 backdrop-blur-sm rounded-full p-2 shadow-sm hover:bg-white transition-colors duration-150"
                            >
                              <X className="w-4 h-4 text-stone-600" />
                            </button>
                          </div>
                          <p className="text-center text-sm text-stone-500 mt-3">
                            {uploadedFile?.name}
                          </p>
                        </div>
                      ) : (
                        <div
                          className="min-h-[20rem] p-12 text-center cursor-pointer flex flex-col items-center justify-center"
                          onClick={() => fileInputRef.current?.click()}
                        >
                          <div className="w-16 h-16 rounded-full bg-stone-100 flex items-center justify-center mx-auto mb-4">
                            <Upload className="w-7 h-7 text-stone-400" />
                          </div>
                          <p className="text-stone-600 font-medium">
                            {t("generate.drop_here")}
                          </p>
                          <p className="text-stone-400 text-sm mt-1">
                            {t("generate.browse")}
                          </p>
                        </div>
                      )}
                    </div>
                  </TabsContent>

                  <TabsContent value="text" className="mt-0">
                    <Textarea
                      value={textDescription}
                      onChange={(e) => setTextDescription(e.target.value)}
                      placeholder={`${t("generate.describe_placeholder")}

${t("generate.describe_example")}`}
                      className="h-[20rem] min-h-[20rem] resize-none font-mono text-sm"
                      data-testid="generate-text-description"
                    />
                  </TabsContent>
                </div>
              </Tabs>
            </div>

            {/* Options */}
            <div className="bg-white rounded-2xl border border-stone-200 p-6">
              <h3 className="text-sm font-medium text-stone-700 mb-4">
                {t("generate.options")}
              </h3>

              <div className="space-y-3">
                <div className="flex items-center gap-3 p-3 bg-stone-50 rounded-xl">
                  <Camera className="w-5 h-5 text-stone-600" />
                  <div className="flex-1">
                    <p className="font-medium text-stone-800">
                      {t("generate.photo_title")}
                    </p>
                    <p className="text-sm text-stone-500">
                      {t("generate.photo_desc")}
                    </p>
                  </div>
                  <div className="text-stone-400 text-sm">
                    {t("generate.required")}
                  </div>
                </div>

                <label className="flex items-center gap-3 p-3 bg-stone-50 rounded-xl cursor-pointer hover:bg-stone-100 transition-colors">
                  <Activity className="w-5 h-5 text-stone-600" />
                  <div className="flex-1">
                    <p className="font-medium text-stone-800">
                      {t("generate.muscles_title")}
                    </p>
                    <p className="text-sm text-stone-500">
                      {t("generate.muscles_desc")}
                    </p>
                  </div>
                  <Checkbox
                    checked={generateMuscles}
                    onCheckedChange={(checked) =>
                      setGenerateMuscles(checked as boolean)
                    }
                  />
                </label>
              </div>
            </div>

            {/* Additional notes */}
            <div className="bg-white rounded-2xl border border-stone-200 p-6">
              <Label className="text-stone-600">{t("generate.notes")}</Label>
              <Textarea
                value={additionalNotes}
                onChange={(e) => setAdditionalNotes(e.target.value)}
                placeholder={t("generate.notes_placeholder")}
                className="mt-2 resize-none"
                data-testid="generate-additional-notes"
              />
            </div>

            {error && (
              <div className="p-4 bg-red-50 text-red-700 rounded-xl text-sm">
                {error}
              </div>
            )}

            <Button
              onClick={handleGenerate}
              disabled={!canGenerate || isGenerating}
              className="w-full bg-stone-800 hover:bg-stone-900 text-white h-12 rounded-xl"
              data-testid="generate-submit"
            >
              {isGenerating ? (
                <>
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                  {t("generate.generating")}
                </>
              ) : (
                <>
                  <Sparkles className="w-4 h-4 mr-2" />
                  {t("generate.start")}
                </>
              )}
            </Button>

            {hasResults && (
              <Button
                onClick={handleReset}
                variant="outline"
                className="w-full h-12 rounded-xl"
                data-testid="generate-reset"
              >
                {t("generate.reset")}
              </Button>
            )}
          </div>

          {/* Right Column - Results / Progress */}
          <div className="space-y-6">
            {isGenerating ? (
              <div className="bg-white rounded-2xl border border-stone-200 p-6">
                <h2 className="text-lg font-medium text-stone-800 mb-6">
                  {t("generate.progress")}
                </h2>

                {/* Progress bar */}
                <div className="mb-6">
                  <div className="flex justify-between text-xs text-stone-500 mb-2">
                    <span>{t("generate.progress_label")}</span>
                    <span data-testid="generate-progress">{progress}%</span>
                  </div>
                  <div className="h-2 bg-stone-200 rounded-full overflow-hidden">
                    <div
                      className="h-full bg-stone-800 rounded-full transition-[width] duration-500 ease-out"
                      style={{ width: `${progress}%` }}
                    />
                  </div>
                </div>

                <div className="space-y-3">
                  {steps.map((step, index) => {
                    const Icon = step.icon;
                    const isActive = index === currentStep && progress < 100;
                    const isComplete = index < currentStep || progress >= 100;

                    if (step.id === "generating_muscles" && !generateMuscles)
                      return null;

                    return (
                      <div
                        key={step.id}
                        className={cn(
                          "flex items-center gap-4 p-4 rounded-xl transition-colors duration-200",
                          isActive && "bg-stone-100",
                          isComplete && "bg-emerald-50",
                          !isActive && !isComplete && "bg-stone-50 opacity-60",
                        )}
                      >
                        <div
                          className={cn(
                            "w-10 h-10 rounded-full flex items-center justify-center transition-colors duration-200",
                            isActive && "bg-stone-800",
                            isComplete && "bg-emerald-500",
                            !isActive && !isComplete && "bg-stone-200",
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
                              !isActive && !isComplete && "text-stone-500",
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
                  {t("generate.progress_hint")}
                </p>
              </div>
            ) : hasResults ? (
              <>
                {/* Results Grid */}
                <div className="grid grid-cols-2 gap-4">
                  {photoUrl && (
                    <div className="bg-white rounded-2xl border border-stone-200 overflow-hidden">
                      <div className="aspect-square relative bg-stone-50">
                        <img
                          src={photoUrl}
                          alt={t("generate.alt_photo")}
                          className="w-full h-full object-contain"
                          data-testid="generate-result-photo"
                        />
                      </div>
                      <div className="p-4 flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          <Camera className="w-4 h-4 text-stone-500" />
                          <span className="text-sm font-medium text-stone-700">
                            {t("generate.results_photo")}
                          </span>
                        </div>
                        <div className="flex gap-2">
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => {
                              setActiveOverlay("photo");
                              setViewerOpen(true);
                            }}
                          >
                            <Eye className="w-4 h-4" />
                          </Button>
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => handleDownload(photoUrl, "photo")}
                          >
                            <Download className="w-4 h-4" />
                          </Button>
                        </div>
                      </div>
                    </div>
                  )}

                  {effectiveMusclesUrl && (
                    <div
                      className="bg-white rounded-2xl border border-stone-200 overflow-hidden"
                    >
                      <div className="aspect-square relative bg-stone-50">
                        <img
                          src={effectiveMusclesUrl}
                          alt={t("generate.alt_muscles")}
                          className="w-full h-full object-contain"
                          data-testid="generate-result-muscles"
                        />
                      </div>
                      <div className="p-4 flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          <Activity className="w-4 h-4 text-red-500" />
                          <span className="text-sm font-medium text-stone-700">
                            {t("generate.results_muscles")}
                          </span>
                        </div>
                        <div className="flex gap-2">
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => {
                              setActiveOverlay("muscles");
                              setViewerOpen(true);
                            }}
                          >
                            <Eye className="w-4 h-4" />
                          </Button>
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() =>
                              handleDownload(effectiveMusclesUrl, "muscles")
                            }
                          >
                            <Download className="w-4 h-4" />
                          </Button>
                        </div>
                      </div>
                    </div>
                  )}
                </div>

                {/* Full Viewer Button */}
                <Button
                  onClick={() => setViewerOpen(true)}
                  variant="outline"
                  className="w-full h-12 rounded-xl"
                  data-testid="generate-open-viewer"
                >
                  <Layers className="w-4 h-4 mr-2" />
                  {t("generate.viewer")}
                </Button>
              </>
            ) : (
              <div className="bg-white rounded-2xl border border-stone-200 p-12 text-center">
                <div className="w-16 h-16 rounded-full bg-stone-100 flex items-center justify-center mx-auto mb-4">
                  <Sparkles className="w-7 h-7 text-stone-400" />
                </div>
                <h3 className="text-lg font-medium text-stone-700 mb-2">
                  {t("generate.ready")}
                </h3>
                <p className="text-stone-500 text-sm">
                  {t("generate.ready_hint")}
                </p>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Full Viewer Dialog */}
      <Dialog open={viewerOpen} onOpenChange={setViewerOpen}>
        <DialogContent
          className="max-w-5xl w-[95vw] h-[85vh] p-0 bg-stone-950 border-0 overflow-hidden"
          aria-describedby={undefined}
          hideCloseButton
        >
          <VisuallyHidden>
            <DialogTitle>{t("pose.viewer.title")}</DialogTitle>
          </VisuallyHidden>
          <div className="flex flex-col h-full">
            <div className="flex items-center justify-between px-6 py-4 border-b border-stone-800">
              <h2 className="text-xl font-medium text-white">
                {t("pose.viewer.title")}
              </h2>
              <div className="flex items-center gap-3">
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() =>
                    handleDownload(
                      activeOverlay === "photo" ? photoUrl : effectiveMusclesUrl,
                      activeOverlay,
                    )
                  }
                  className="text-stone-400 hover:text-white hover:bg-stone-800 transition-colors duration-150"
                >
                  <Download className="w-4 h-4 mr-2" />
                  {t("pose.viewer.download")}
                </Button>
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={() => setViewerOpen(false)}
                  className="text-stone-400 hover:text-white hover:bg-stone-800 rounded-full transition-colors duration-150"
                >
                  <X className="w-5 h-5" />
                </Button>
              </div>
            </div>

            <div className="flex-1 flex overflow-hidden">
              <div className="flex-1 relative flex items-center justify-center p-8 bg-stone-900">
                <img
                  src={
                    activeOverlay === "photo"
                      ? photoUrl || ""
                      : effectiveMusclesUrl || ""
                  }
                  alt={t("generate.alt_pose")}
                  className="max-w-full max-h-full object-contain rounded-lg transition-opacity duration-200"
                  data-testid="generate-viewer-image"
                />
              </div>

              <div className="w-72 bg-stone-900 border-l border-stone-800 p-6">
                <div className="flex items-center gap-2 mb-4">
                  <Layers className="w-4 h-4 text-stone-400" />
                  <h3 className="text-sm font-medium text-stone-300">
                    {t("pose.viewer.layer")}
                  </h3>
                </div>
                <div className="space-y-2">
                  <button
                    onClick={() => setActiveOverlay("photo")}
                    className={cn(
                      "w-full flex items-center gap-3 px-4 py-3 rounded-xl transition-colors",
                      activeOverlay === "photo"
                        ? "bg-white text-stone-900"
                        : "bg-stone-800 text-stone-300 hover:bg-stone-700",
                    )}
                    data-testid="generate-viewer-tab-photo"
                  >
                    <Camera className="w-5 h-5" />
                    <span className="font-medium">
                      {t("pose.viewer.photo")}
                    </span>
                  </button>
                  {effectiveMusclesUrl && (
                    <button
                      onClick={() => setActiveOverlay("muscles")}
                      className={cn(
                        "w-full flex items-center gap-3 px-4 py-3 rounded-xl transition-colors",
                        activeOverlay === "muscles"
                          ? "bg-white text-stone-900"
                          : "bg-stone-800 text-stone-300 hover:bg-stone-700",
                      )}
                      data-testid="generate-viewer-tab-muscles"
                    >
                      <Activity className="w-5 h-5" />
                      <span className="font-medium">
                        {t("pose.viewer.muscles")}
                      </span>
                    </button>
                  )}
                </div>
              </div>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default Generate;
