import React, { useState, useRef, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Loader2, Sparkles, Camera, Activity, Lightbulb, Upload,
  FileImage, Type, Eye, Download, Layers, X, Check, Save, FolderPlus
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Dialog, DialogContent, DialogTitle, DialogHeader, DialogDescription, DialogFooter } from '@/components/ui/dialog';
import { VisuallyHidden } from '@/components/ui/visually-hidden';
import { cn } from '@/lib/utils';
import { useGenerate } from '@/hooks/useGenerate';
import { useI18n } from '@/i18n';
import { useAppStore } from '@/store/useAppStore';
import { generateApi } from '@/services/api';
import { GENERATION_PROGRESS } from '@/lib/constants';
import { useViewTransition } from '@/hooks/useViewTransition';

const steps = [
  { id: 'analyzing', labelKey: 'generate.step_analyzing', icon: Lightbulb, minProgress: 0, maxProgress: GENERATION_PROGRESS.ANALYZING_END },
  { id: 'generating_photo', labelKey: 'generate.step_photo', icon: Camera, minProgress: GENERATION_PROGRESS.ANALYZING_END, maxProgress: GENERATION_PROGRESS.PHOTO_END },
  { id: 'generating_muscles', labelKey: 'generate.step_muscles', icon: Activity, minProgress: GENERATION_PROGRESS.PHOTO_END, maxProgress: GENERATION_PROGRESS.MUSCLES_END },
] as const;

// Minimum text description length for text-based generation
const MIN_TEXT_LENGTH = 10;

// Animation variants
const fadeInUp = {
  hidden: { opacity: 0, y: 20 },
  visible: { opacity: 1, y: 0 },
};

const staggerContainer = {
  hidden: { opacity: 0 },
  visible: {
    opacity: 1,
    transition: {
      staggerChildren: 0.1,
      delayChildren: 0.1,
    },
  },
};

const scaleIn = {
  hidden: { opacity: 0, scale: 0.9 },
  visible: {
    opacity: 1,
    scale: 1,
    transition: { type: "spring" as const, stiffness: 300, damping: 24 }
  },
};

const slideInFromRight = {
  hidden: { opacity: 0, x: 50 },
  visible: {
    opacity: 1,
    x: 0,
    transition: { type: "spring" as const, stiffness: 300, damping: 30 }
  },
};

const progressBarSpring = {
  type: "spring" as const,
  stiffness: 100,
  damping: 15,
};

export const Generate: React.FC = () => {
  const [inputType, setInputType] = useState<'schematic' | 'text'>('schematic');
  const [uploadedFile, setUploadedFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [textDescription, setTextDescription] = useState('');
  const [additionalNotes, setAdditionalNotes] = useState('');
  const [generateMuscles, setGenerateMuscles] = useState(true);
  const [dragActive, setDragActive] = useState(false);
  const [viewerOpen, setViewerOpen] = useState(false);
  const [activeOverlay, setActiveOverlay] = useState<'photo' | 'muscles'>('photo');
  const fileInputRef = useRef<HTMLInputElement>(null);
  const { t } = useI18n();
  const navigate = useNavigate();
  const { addToast } = useAppStore();
  const { startTransition } = useViewTransition();

  // Save to gallery modal state
  const [saveModalOpen, setSaveModalOpen] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [poseName, setPoseName] = useState('');
  const [poseCode, setPoseCode] = useState('');
  const [poseNameEn, setPoseNameEn] = useState('');
  const [poseDescription, setPoseDescription] = useState('');

  const {
    isGenerating,
    progress,
    error,
    photoUrl,
    musclesUrl,
    taskId,
    analyzedMuscles,
    generate,
    generateFromText,
    reset
  } = useGenerate();

  const hasResults = photoUrl || musclesUrl;
  /**
   * Determine current step based on progress.
   * Uses GENERATION_PROGRESS thresholds for consistency.
   */
  const currentStep = progress < GENERATION_PROGRESS.ANALYZING_END ? 0
    : progress < GENERATION_PROGRESS.PHOTO_END ? 1
    : progress < GENERATION_PROGRESS.MUSCLES_END ? 2 : 2;

  // Cleanup preview URL on unmount to prevent memory leaks
  useEffect(() => {
    return () => {
      if (previewUrl) {
        URL.revokeObjectURL(previewUrl);
      }
    };
  }, [previewUrl]);

  const handleFileSelect = (file: File) => {
    if (file && file.type.startsWith('image/')) {
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
    if (inputType === 'schematic' && uploadedFile) {
      await generate(uploadedFile, additionalNotes || undefined);
    } else if (inputType === 'text' && textDescription.trim().length >= MIN_TEXT_LENGTH) {
      await generateFromText(textDescription.trim(), additionalNotes || undefined);
    }
  };

  const handleReset = () => {
    startTransition(() => {
      reset();
      setUploadedFile(null);
      setPreviewUrl(null);
      setTextDescription('');
      setAdditionalNotes('');
    });
  };

  const handleDownload = async (url: string | null, name: string) => {
    if (!url) return;
    try {
      const response = await fetch(url);
      const blob = await response.blob();
      const downloadUrl = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
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

  const handleOpenSaveModal = () => {
    // Pre-fill pose name from text description if available
    if (textDescription && !poseName) {
      const truncated = textDescription.slice(0, 100).trim();
      setPoseName(truncated);
    }
    // Generate a unique code based on timestamp
    if (!poseCode) {
      setPoseCode(`GEN-${Date.now().toString(36).toUpperCase()}`);
    }
    setSaveModalOpen(true);
  };

  const handleSaveToGallery = async () => {
    if (!taskId || !poseName.trim() || !poseCode.trim()) {
      addToast({ type: "error", message: t("generate.save_fill_required") });
      return;
    }

    setIsSaving(true);
    try {
      const result = await generateApi.saveToGallery({
        task_id: taskId,
        name: poseName.trim(),
        code: poseCode.trim(),
        name_en: poseNameEn.trim() || undefined,
        description: poseDescription.trim() || undefined,
      });

      addToast({ type: "success", message: t("generate.save_success") });
      setSaveModalOpen(false);

      // Navigate to the new pose
      navigate(`/poses/${result.pose_id}`);
    } catch (err) {
      const message = err instanceof Error ? err.message : t("generate.save_failed");
      addToast({ type: "error", message });
    } finally {
      setIsSaving(false);
    }
  };

  // Can generate from either uploaded file (schematic mode) or text description (text mode)
  const canGenerate = inputType === 'schematic'
    ? !!uploadedFile
    : textDescription.trim().length >= MIN_TEXT_LENGTH;

  return (
    <div className="min-h-screen bg-background p-6">
      <div className="max-w-6xl mx-auto">
        {/* Header */}
        <div className="mb-8">
          <h1 className="text-2xl font-semibold text-foreground">{t("generate.title")}</h1>
          <p className="text-muted-foreground mt-1">{t("generate.subtitle")}</p>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
          {/* Left Column - Input */}
          <div className="space-y-6">
            <div className="bg-card rounded-2xl border border-border p-6">
              <h2 className="text-lg font-medium text-foreground mb-4">{t("generate.source_input")}</h2>

              <Tabs value={inputType} onValueChange={(v) => startTransition(() => setInputType(v as 'schematic' | 'text'))} className="w-full">
                <TabsList className="grid w-full grid-cols-2 bg-muted p-1 rounded-xl">
                  <TabsTrigger value="schematic" className="rounded-lg data-[state=active]:bg-card data-[state=active]:shadow-sm">
                    <FileImage className="w-4 h-4 mr-2" />
                    {t("generate.upload_schematic")}
                  </TabsTrigger>
                  <TabsTrigger value="text" className="rounded-lg data-[state=active]:bg-card data-[state=active]:shadow-sm">
                    <Type className="w-4 h-4 mr-2" />
                    {t("generate.text_description")}
                  </TabsTrigger>
                </TabsList>
                
                <TabsContent value="schematic" className="mt-4 view-transition-tab-content">
                  <div
                    className={cn(
                      "relative border-2 border-dashed rounded-xl transition-all duration-200",
                      dragActive ? "border-border/80 bg-muted" : "border-border hover:border-border/80"
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
                      onChange={(e) => e.target.files?.[0] && handleFileSelect(e.target.files[0])}
                      className="hidden"
                    />
                    
                    {previewUrl ? (
                      <div className="p-4">
                        <div className="relative aspect-[4/3] max-h-[300px] mx-auto">
                          <img 
                            src={previewUrl} 
                            alt={t("generate.alt_schematic")} 
                            className="w-full h-full object-contain rounded-lg"
                          />

                          <button
                            onClick={() => startTransition(() => {
                              setUploadedFile(null);
                              setPreviewUrl(null);
                            })}
                            className="absolute top-2 right-2 bg-card/90 backdrop-blur-sm rounded-full p-2 shadow-sm hover:bg-card transition-colors duration-150"
                          >
                            <X className="w-4 h-4 text-muted-foreground" />
                          </button>
                        </div>
                        <p className="text-center text-sm text-muted-foreground mt-3">
                          {uploadedFile?.name}
                        </p>
                      </div>
                    ) : (
                      <div
                        className="p-12 text-center cursor-pointer"
                        onClick={() => fileInputRef.current?.click()}
                      >
                        <div className="w-16 h-16 rounded-full bg-muted flex items-center justify-center mx-auto mb-4">
                          <Upload className="w-7 h-7 text-muted-foreground" />
                        </div>
                        <p className="text-foreground font-medium">
                          {t("generate.drop_here")}
                        </p>
                        <p className="text-muted-foreground text-sm mt-1">
                          {t("generate.browse")}
                        </p>
                      </div>
                    )}
                  </div>
                </TabsContent>
                
                <TabsContent value="text" className="mt-4 view-transition-tab-content">
                  <div className="space-y-4">
                    <div>
                      <Label className="text-muted-foreground mb-2 block">{t("generate.text_label")}</Label>
                      <Textarea
                        value={textDescription}
                        onChange={(e) => setTextDescription(e.target.value)}
                        placeholder={t("generate.text_placeholder")}
                        className="min-h-[200px] resize-none"
                      />
                      <p className="text-xs text-muted-foreground mt-2">
                        {textDescription.length < MIN_TEXT_LENGTH
                          ? t("generate.text_min_chars", { min: MIN_TEXT_LENGTH, current: textDescription.length })
                          : t("generate.text_chars", { count: textDescription.length })}
                      </p>
                    </div>
                  </div>
                </TabsContent>
              </Tabs>
            </div>

            {/* Options */}
            <div className="bg-card rounded-2xl border border-border p-6">
              <h3 className="text-sm font-medium text-foreground mb-4">{t("generate.options")}</h3>

              <div className="space-y-3">
                <div className="flex items-center gap-3 p-3 bg-muted rounded-xl">
                  <Camera className="w-5 h-5 text-muted-foreground" />
                  <div className="flex-1">
                    <p className="font-medium text-foreground">{t("generate.photo_title")}</p>
                    <p className="text-sm text-muted-foreground">{t("generate.photo_desc")}</p>
                  </div>
                  <div className="text-muted-foreground text-sm">{t("generate.required")}</div>
                </div>

                <label className="flex items-center gap-3 p-3 bg-muted rounded-xl cursor-pointer hover:bg-accent transition-colors">
                  <Activity className="w-5 h-5 text-muted-foreground" />
                  <div className="flex-1">
                    <p className="font-medium text-foreground">{t("generate.muscles_title")}</p>
                    <p className="text-sm text-muted-foreground">{t("generate.muscles_desc")}</p>
                  </div>
                  <Checkbox 
                    checked={generateMuscles}
                    onCheckedChange={(checked) => setGenerateMuscles(checked as boolean)}
                  />
                </label>
              </div>
            </div>

            {/* Additional notes */}
            <div className="bg-card rounded-2xl border border-border p-6">
              <Label className="text-muted-foreground">{t("generate.notes")}</Label>
              <Textarea
                value={additionalNotes}
                onChange={(e) => setAdditionalNotes(e.target.value)}
                placeholder={t("generate.notes_placeholder")}
                className="mt-2 resize-none"
              />
            </div>

            <AnimatePresence>
              {error && (
                <motion.div
                  initial={{ opacity: 0, y: -10, height: 0 }}
                  animate={{ opacity: 1, y: 0, height: "auto" }}
                  exit={{ opacity: 0, y: -10, height: 0 }}
                  transition={{ duration: 0.3 }}
                  className="p-4 bg-red-50 dark:bg-red-900/30 text-red-700 dark:text-red-400 rounded-xl text-sm overflow-hidden"
                >
                  <motion.div
                    initial={{ x: -20 }}
                    animate={{ x: 0 }}
                    transition={{ delay: 0.1 }}
                  >
                    {error}
                  </motion.div>
                </motion.div>
              )}
            </AnimatePresence>

            <motion.div
              whileHover={canGenerate && !isGenerating ? { scale: 1.02 } : {}}
              whileTap={canGenerate && !isGenerating ? { scale: 0.98 } : {}}
            >
              <Button
                onClick={handleGenerate}
                disabled={!canGenerate || isGenerating}
                className="w-full bg-primary hover:bg-primary/90 text-primary-foreground h-12 rounded-xl"
              >
                {isGenerating ? (
                  <>
                    <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                    {t("generate.generating")}
                  </>
                ) : (
                  <>
                    <motion.div
                      animate={{ rotate: [0, 15, -15, 0] }}
                      transition={{ duration: 2, repeat: Infinity, repeatDelay: 3 }}
                    >
                      <Sparkles className="w-4 h-4 mr-2" />
                    </motion.div>
                    {t("generate.start")}
                  </>
                )}
              </Button>
            </motion.div>

            <AnimatePresence>
              {hasResults && (
                <motion.div
                  initial={{ opacity: 0, height: 0 }}
                  animate={{ opacity: 1, height: "auto" }}
                  exit={{ opacity: 0, height: 0 }}
                  transition={{ duration: 0.3 }}
                >
                  <Button
                    onClick={handleReset}
                    variant="outline"
                    className="w-full h-12 rounded-xl"
                  >
                    {t("generate.reset")}
                  </Button>
                </motion.div>
              )}
            </AnimatePresence>
          </div>

          {/* Right Column - Results / Progress */}
          <div className="space-y-6">
            <AnimatePresence mode="wait">
            {isGenerating ? (
              <motion.div
                key="progress"
                initial="hidden"
                animate="visible"
                exit={{ opacity: 0, scale: 0.95 }}
                variants={scaleIn}
                className="bg-card rounded-2xl border border-border p-6 view-transition-progress"
              >
                <h2 className="text-lg font-medium text-foreground mb-6">{t("generate.progress")}</h2>

                {/* Progress bar */}
                <div className="mb-6">
                  <div className="flex justify-between text-xs text-muted-foreground mb-2">
                    <span>{t("generate.progress_label")}</span>
                    <motion.span
                      key={progress}
                      initial={{ opacity: 0, y: -10 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{ duration: 0.2 }}
                    >
                      {progress}%
                    </motion.span>
                  </div>
                  <div className="h-3 bg-muted rounded-full overflow-hidden">
                    <motion.div
                      className="h-full bg-gradient-to-r from-primary to-primary/70 rounded-full"
                      initial={{ width: 0 }}
                      animate={{ width: `${progress}%` }}
                      transition={progressBarSpring}
                    />
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
                    const isActive = index === currentStep && progress < 100;
                    const isComplete = index < currentStep || progress >= 100;

                    if (step.id === 'generating_muscles' && !generateMuscles) return null;

                    return (
                      <motion.div
                        key={step.id}
                        variants={fadeInUp}
                        layout
                        className={cn(
                          "flex items-center gap-4 p-4 rounded-xl transition-colors duration-200",
                          isActive && "bg-muted",
                          isComplete && "bg-emerald-50 dark:bg-emerald-950/30",
                          !isActive && !isComplete && "bg-muted/50 opacity-60"
                        )}
                      >
                        <motion.div
                          className={cn(
                            "w-10 h-10 rounded-full flex items-center justify-center",
                            isActive && "bg-primary",
                            isComplete && "bg-emerald-500",
                            !isActive && !isComplete && "bg-muted"
                          )}
                          animate={isComplete ? { scale: [1, 1.2, 1] } : {}}
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
                            ) : isComplete ? (
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
                                <Icon className="w-5 h-5 text-muted-foreground" />
                              </motion.div>
                            )}
                          </AnimatePresence>
                        </motion.div>
                        <div className="flex-1">
                          <p className={cn(
                            "font-medium transition-colors duration-200",
                            isActive && "text-foreground",
                            isComplete && "text-emerald-700 dark:text-emerald-400",
                            !isActive && !isComplete && "text-muted-foreground"
                          )}>
                            {t(step.labelKey)}
                          </p>
                        </div>
                      </motion.div>
                    );
                  })}
                </motion.div>
                <motion.p
                  className="text-center text-muted-foreground text-sm mt-6"
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  transition={{ delay: 0.5 }}
                >
                  {t("generate.progress_hint")}
                </motion.p>
              </motion.div>
            ) : hasResults ? (
              <motion.div
                key="results"
                initial="hidden"
                animate="visible"
                exit={{ opacity: 0, y: -20 }}
                variants={staggerContainer}
                className="space-y-6 view-transition-results"
              >
                {/* Results Grid */}
                <div className="grid grid-cols-2 gap-4">
                  {photoUrl && (
                    <motion.div
                      variants={scaleIn}
                      whileHover={{ scale: 1.02, y: -4 }}
                      transition={{ type: "spring" as const, stiffness: 400, damping: 25 }}
                      className="bg-card rounded-2xl border border-border overflow-hidden shadow-sm hover:shadow-lg"
                    >
                      <div className="aspect-square relative bg-muted overflow-hidden">
                        <motion.img
                          src={photoUrl}
                          alt={t("generate.alt_photo")}
                          className="w-full h-full object-contain"
                          initial={{ opacity: 0, scale: 1.1 }}
                          animate={{ opacity: 1, scale: 1 }}
                          transition={{ duration: 0.5 }}
                        />
                      </div>
                      <div className="p-4 flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          <Camera className="w-4 h-4 text-muted-foreground" />
                          <span className="text-sm font-medium text-foreground">{t("generate.results_photo")}</span>
                        </div>
                        <div className="flex gap-2">
                          <Button size="sm" variant="ghost" onClick={() => startTransition(() => { setActiveOverlay('photo'); setViewerOpen(true); })}>
                            <Eye className="w-4 h-4" />
                          </Button>
                          <Button size="sm" variant="ghost" onClick={() => handleDownload(photoUrl, 'photo')}>
                            <Download className="w-4 h-4" />
                          </Button>
                        </div>
                      </div>
                    </motion.div>
                  )}

                  {musclesUrl && (
                    <motion.div
                      variants={scaleIn}
                      whileHover={{ scale: 1.02, y: -4 }}
                      transition={{ type: "spring" as const, stiffness: 400, damping: 25 }}
                      className="bg-card rounded-2xl border border-border overflow-hidden shadow-sm hover:shadow-lg"
                    >
                      <div className="aspect-square relative bg-muted overflow-hidden">
                        <motion.img
                          src={musclesUrl}
                          alt={t("generate.alt_muscles")}
                          className="w-full h-full object-contain"
                          initial={{ opacity: 0, scale: 1.1 }}
                          animate={{ opacity: 1, scale: 1 }}
                          transition={{ duration: 0.5, delay: 0.1 }}
                        />
                      </div>
                      <div className="p-4 flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          <Activity className="w-4 h-4 text-red-500" />
                          <span className="text-sm font-medium text-foreground">{t("generate.results_muscles")}</span>
                        </div>
                        <div className="flex gap-2">
                          <Button size="sm" variant="ghost" onClick={() => startTransition(() => { setActiveOverlay('muscles'); setViewerOpen(true); })}>
                            <Eye className="w-4 h-4" />
                          </Button>
                          <Button size="sm" variant="ghost" onClick={() => handleDownload(musclesUrl, 'muscles')}>
                            <Download className="w-4 h-4" />
                          </Button>
                        </div>
                      </div>
                    </motion.div>
                  )}
                </div>

                {/* Analyzed Muscles */}
                {analyzedMuscles && analyzedMuscles.length > 0 && (
                  <motion.div
                    variants={slideInFromRight}
                    className="bg-card rounded-2xl border border-border p-6"
                  >
                    <div className="flex items-center gap-2 mb-4">
                      <motion.div
                        animate={{ rotate: [0, 10, -10, 0] }}
                        transition={{ duration: 0.5, delay: 0.3 }}
                      >
                        <Activity className="w-5 h-5 text-red-500" />
                      </motion.div>
                      <h3 className="text-sm font-medium text-foreground">{t("generate.active_muscles")}</h3>
                    </div>
                    <motion.div
                      className="space-y-3"
                      variants={staggerContainer}
                      initial="hidden"
                      animate="visible"
                    >
                      {analyzedMuscles
                        .sort((a, b) => b.activation_level - a.activation_level)
                        .map((muscle, index) => (
                          <motion.div
                            key={index}
                            className="flex items-center gap-3"
                            variants={fadeInUp}
                            custom={index}
                          >
                            <div className="flex-1">
                              <div className="flex items-center justify-between mb-1">
                                <span className="text-sm text-foreground">
                                  {t(`muscle.${muscle.name}` as any) || muscle.name.replace(/_/g, ' ')}
                                </span>
                                <motion.span
                                  className="text-xs text-muted-foreground"
                                  initial={{ opacity: 0 }}
                                  animate={{ opacity: 1 }}
                                  transition={{ delay: 0.3 + index * 0.1 }}
                                >
                                  {muscle.activation_level}%
                                </motion.span>
                              </div>
                              <div className="h-2 bg-muted rounded-full overflow-hidden">
                                <motion.div
                                  className={cn(
                                    "h-full rounded-full",
                                    muscle.activation_level >= 70 ? "bg-red-500" :
                                    muscle.activation_level >= 40 ? "bg-amber-500" : "bg-muted-foreground"
                                  )}
                                  initial={{ width: 0 }}
                                  animate={{ width: `${muscle.activation_level}%` }}
                                  transition={{
                                    duration: 0.8,
                                    delay: 0.2 + index * 0.1,
                                    ease: [0.25, 0.46, 0.45, 0.94]
                                  }}
                                />
                              </div>
                            </div>
                          </motion.div>
                        ))}
                    </motion.div>
                    <motion.p
                      className="text-xs text-muted-foreground mt-4"
                      initial={{ opacity: 0 }}
                      animate={{ opacity: 1 }}
                      transition={{ delay: 0.8 }}
                    >
                      {t("generate.muscles_legend")}
                    </motion.p>
                  </motion.div>
                )}

                {/* Full Viewer Button */}
                <motion.div variants={fadeInUp}>
                  <Button
                    onClick={() => startTransition(() => setViewerOpen(true))}
                    variant="outline"
                    className="w-full h-12 rounded-xl"
                  >
                    <Layers className="w-4 h-4 mr-2" />
                    {t("generate.viewer")}
                  </Button>
                </motion.div>

                {/* Save to Gallery Button */}
                {taskId && (
                  <motion.div
                    variants={fadeInUp}
                    whileHover={{ scale: 1.02 }}
                    whileTap={{ scale: 0.98 }}
                  >
                    <Button
                      onClick={handleOpenSaveModal}
                      className="w-full h-12 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white"
                    >
                      <FolderPlus className="w-4 h-4 mr-2" />
                      {t("generate.save_to_gallery")}
                    </Button>
                  </motion.div>
                )}
              </motion.div>
            ) : (
              <motion.div
                key="empty"
                initial="hidden"
                animate="visible"
                exit={{ opacity: 0, scale: 0.9 }}
                variants={scaleIn}
                className="bg-card rounded-2xl border border-border p-12 text-center"
              >
                <motion.div
                  className="w-16 h-16 rounded-full bg-muted flex items-center justify-center mx-auto mb-4"
                  animate={{
                    scale: [1, 1.05, 1],
                    rotate: [0, 5, -5, 0],
                  }}
                  transition={{
                    duration: 3,
                    repeat: Infinity,
                    repeatType: "reverse",
                  }}
                >
                  <Sparkles className="w-7 h-7 text-muted-foreground" />
                </motion.div>
                <h3 className="text-lg font-medium text-foreground mb-2">{t("generate.ready")}</h3>
                <p className="text-muted-foreground text-sm">
                  {t("generate.ready_hint")}
                </p>
              </motion.div>
            )}
            </AnimatePresence>
          </div>
        </div>
      </div>

      {/* Full Viewer Dialog */}
      <Dialog open={viewerOpen} onOpenChange={(open) => startTransition(() => setViewerOpen(open))}>
        <DialogContent className="max-w-5xl w-[95vw] h-[85vh] p-0 bg-stone-950 border-0 overflow-hidden" aria-describedby={undefined} hideCloseButton>
          <VisuallyHidden>
            <DialogTitle>{t("pose.viewer.title")}</DialogTitle>
          </VisuallyHidden>
          <div className="flex flex-col h-full">
            <div className="flex items-center justify-between px-6 py-4 border-b border-stone-800">
              <h2 className="text-xl font-medium text-white">{t("pose.viewer.title")}</h2>
              <div className="flex items-center gap-3">
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => handleDownload(activeOverlay === 'photo' ? photoUrl : musclesUrl, activeOverlay)}
                  className="text-stone-400 hover:text-white hover:bg-stone-800"
                >
                  <Download className="w-4 h-4 mr-2" />
                  {t("pose.viewer.download")}
                </Button>
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={() => setViewerOpen(false)}
                  className="text-stone-400 hover:text-white hover:bg-stone-800 rounded-full"
                >
                  <X className="w-5 h-5" />
                </Button>
              </div>
            </div>

            <div className="flex-1 flex overflow-hidden">
              <div className="flex-1 relative flex items-center justify-center p-8 bg-stone-900">
                <img
                  src={activeOverlay === 'photo' ? photoUrl || '' : musclesUrl || ''}
                  alt={t("generate.alt_pose")}
                  className="max-w-full max-h-full object-contain rounded-lg transition-opacity duration-200 view-transition-image"
                />
              </div>

              <div className="w-72 bg-stone-900 border-l border-stone-800 p-6">
                <div className="flex items-center gap-2 mb-4">
                  <Layers className="w-4 h-4 text-stone-400" />
                  <h3 className="text-sm font-medium text-stone-300">{t("pose.viewer.layer")}</h3>
                </div>
                <div className="space-y-2">
                  <button
                    onClick={() => startTransition(() => setActiveOverlay('photo'))}
                    className={cn(
                      "w-full flex items-center gap-3 px-4 py-3 rounded-xl transition-all",
                      activeOverlay === 'photo' ? "bg-white text-stone-900" : "bg-stone-800 text-stone-300 hover:bg-stone-700"
                    )}
                  >
                    <Camera className="w-5 h-5" />
                    <span className="font-medium">{t("pose.viewer.photo")}</span>
                  </button>
                  {musclesUrl && (
                    <button
                      onClick={() => startTransition(() => setActiveOverlay('muscles'))}
                      className={cn(
                        "w-full flex items-center gap-3 px-4 py-3 rounded-xl transition-all",
                        activeOverlay === 'muscles' ? "bg-white text-stone-900" : "bg-stone-800 text-stone-300 hover:bg-stone-700"
                      )}
                    >
                      <Activity className="w-5 h-5" />
                      <span className="font-medium">{t("pose.viewer.muscles")}</span>
                    </button>
                  )}
                </div>
              </div>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* Save to Gallery Modal */}
      <Dialog open={saveModalOpen} onOpenChange={setSaveModalOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{t("generate.save_modal_title")}</DialogTitle>
            <DialogDescription>
              {t("generate.save_modal_description")}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label htmlFor="pose-name">{t("generate.save_name")} *</Label>
              <Input
                id="pose-name"
                value={poseName}
                onChange={(e) => setPoseName(e.target.value)}
                placeholder={t("generate.save_name_placeholder")}
                maxLength={200}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="pose-code">{t("generate.save_code")} *</Label>
              <Input
                id="pose-code"
                value={poseCode}
                onChange={(e) => setPoseCode(e.target.value.toUpperCase())}
                placeholder={t("generate.save_code_placeholder")}
                maxLength={20}
              />
              <p className="text-xs text-muted-foreground">{t("generate.save_code_hint")}</p>
            </div>
            <div className="space-y-2">
              <Label htmlFor="pose-name-en">{t("generate.save_name_en")}</Label>
              <Input
                id="pose-name-en"
                value={poseNameEn}
                onChange={(e) => setPoseNameEn(e.target.value)}
                placeholder={t("generate.save_name_en_placeholder")}
                maxLength={200}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="pose-description">{t("generate.save_description")}</Label>
              <Textarea
                id="pose-description"
                value={poseDescription}
                onChange={(e) => setPoseDescription(e.target.value)}
                placeholder={t("generate.save_description_placeholder")}
                className="resize-none"
                rows={3}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setSaveModalOpen(false)} disabled={isSaving}>
              {t("common.cancel")}
            </Button>
            <Button
              onClick={handleSaveToGallery}
              disabled={!poseName.trim() || !poseCode.trim() || isSaving}
              className="bg-emerald-600 hover:bg-emerald-700"
            >
              {isSaving ? (
                <>
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                  {t("generate.saving")}
                </>
              ) : (
                <>
                  <Save className="w-4 h-4 mr-2" />
                  {t("generate.save_button")}
                </>
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default Generate;
