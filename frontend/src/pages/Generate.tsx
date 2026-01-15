import React, { useState, useRef } from 'react';
import { 
  Loader2, Sparkles, Camera, Activity, Lightbulb, Upload, 
  FileImage, Type, Eye, Download, Layers, X, Check
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog';
import { VisuallyHidden } from '@/components/ui/visually-hidden';
import { cn } from '@/lib/utils';
import { useGenerate } from '@/hooks/useGenerate';

const steps = [
  { id: 'analyzing', label: 'Analyzing pose structure...', icon: Lightbulb, minProgress: 0, maxProgress: 30 },
  { id: 'generating_photo', label: 'Generating photorealistic image...', icon: Camera, minProgress: 30, maxProgress: 60 },
  { id: 'generating_muscles', label: 'Creating muscle visualization...', icon: Activity, minProgress: 60, maxProgress: 100 },
];

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

  const { 
    isGenerating, 
    progress, 
    error, 
    photoUrl, 
    musclesUrl, 
    generate, 
    reset 
  } = useGenerate();

  const hasResults = photoUrl || musclesUrl;
  // Determine current step based on progress
  // Backend sends: 10% (analyzing), 30% (photo start), 60% (muscles start), 100% (done)
  const currentStep = progress < 30 ? 0 : progress < 60 ? 1 : progress < 100 ? 2 : 2;

  const handleFileSelect = (file: File) => {
    if (file && file.type.startsWith('image/')) {
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
      await generate(uploadedFile);
    }
  };

  const handleReset = () => {
    reset();
    setUploadedFile(null);
    setPreviewUrl(null);
    setTextDescription('');
    setAdditionalNotes('');
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
      console.error('Download failed:', error);
    }
  };

  const canGenerate = inputType === 'schematic' ? !!uploadedFile : !!textDescription;

  return (
    <div className="min-h-screen bg-stone-50 p-6">
      <div className="max-w-6xl mx-auto">
        {/* Header */}
        <div className="mb-8">
          <h1 className="text-2xl font-semibold text-stone-800">Generate Yoga Pose</h1>
          <p className="text-stone-500 mt-1">Upload a schematic or describe a pose to generate photorealistic images</p>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
          {/* Left Column - Input */}
          <div className="space-y-6">
            <div className="bg-white rounded-2xl border border-stone-200 p-6">
              <h2 className="text-lg font-medium text-stone-800 mb-4">Source Input</h2>
              
              <Tabs value={inputType} onValueChange={(v) => setInputType(v as 'schematic' | 'text')} className="w-full">
                <TabsList className="grid w-full grid-cols-2 bg-stone-100 p-1 rounded-xl">
                  <TabsTrigger value="schematic" className="rounded-lg data-[state=active]:bg-white data-[state=active]:shadow-sm">
                    <FileImage className="w-4 h-4 mr-2" />
                    Upload Schematic
                  </TabsTrigger>
                  <TabsTrigger value="text" className="rounded-lg data-[state=active]:bg-white data-[state=active]:shadow-sm">
                    <Type className="w-4 h-4 mr-2" />
                    Text Description
                  </TabsTrigger>
                </TabsList>
                
                <TabsContent value="schematic" className="mt-4">
                  <div
                    className={cn(
                      "relative border-2 border-dashed rounded-xl transition-all duration-200",
                      dragActive ? "border-stone-400 bg-stone-50" : "border-stone-200 hover:border-stone-300"
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
                            alt="Schematic preview" 
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
                        className="p-12 text-center cursor-pointer"
                        onClick={() => fileInputRef.current?.click()}
                      >
                        <div className="w-16 h-16 rounded-full bg-stone-100 flex items-center justify-center mx-auto mb-4">
                          <Upload className="w-7 h-7 text-stone-400" />
                        </div>
                        <p className="text-stone-600 font-medium">
                          Drop your schematic drawing here
                        </p>
                        <p className="text-stone-400 text-sm mt-1">
                          or click to browse files
                        </p>
                      </div>
                    )}
                  </div>
                </TabsContent>
                
                <TabsContent value="text" className="mt-4">
                  <Textarea
                    value={textDescription}
                    onChange={(e) => setTextDescription(e.target.value)}
                    placeholder="Describe the pose in detail...

Example: Standing pose with feet wide apart, approximately 4 feet. Right foot turned out 90 degrees, left foot slightly inward. Arms extended horizontally at shoulder height."
                    className="min-h-[200px] resize-none font-mono text-sm"
                  />
                </TabsContent>
              </Tabs>
            </div>

            {/* Options */}
            <div className="bg-white rounded-2xl border border-stone-200 p-6">
              <h3 className="text-sm font-medium text-stone-700 mb-4">What to generate:</h3>
              
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
                    <p className="text-sm text-stone-500">Active muscle groups highlighted in red</p>
                  </div>
                  <Checkbox 
                    checked={generateMuscles}
                    onCheckedChange={(checked) => setGenerateMuscles(checked as boolean)}
                  />
                </label>
              </div>
            </div>

            {/* Additional notes */}
            <div className="bg-white rounded-2xl border border-stone-200 p-6">
              <Label className="text-stone-600">Additional notes (optional)</Label>
              <Textarea
                value={additionalNotes}
                onChange={(e) => setAdditionalNotes(e.target.value)}
                placeholder="e.g., Male subject, athletic build, specific lighting preferences..."
                className="mt-2 resize-none"
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
            >
              {isGenerating ? (
                <>
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                  Generating...
                </>
              ) : (
                <>
                  <Sparkles className="w-4 h-4 mr-2" />
                  Start Generation
                </>
              )}
            </Button>

            {hasResults && (
              <Button 
                onClick={handleReset}
                variant="outline"
                className="w-full h-12 rounded-xl"
              >
                Reset & Start Over
              </Button>
            )}
          </div>

          {/* Right Column - Results / Progress */}
          <div className="space-y-6">
            {isGenerating ? (
              <div className="bg-white rounded-2xl border border-stone-200 p-6">
                <h2 className="text-lg font-medium text-stone-800 mb-6">Generation Progress</h2>
                
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
                    
                    if (step.id === 'generating_muscles' && !generateMuscles) return null;

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
                        <div className={cn(
                          "w-10 h-10 rounded-full flex items-center justify-center transition-colors duration-200",
                          isActive && "bg-stone-800",
                          isComplete && "bg-emerald-500",
                          !isActive && !isComplete && "bg-stone-200"
                        )}>
                          {isActive ? (
                            <Loader2 className="w-5 h-5 text-white animate-spin" />
                          ) : isComplete ? (
                            <Check className="w-5 h-5 text-white" />
                          ) : (
                            <Icon className="w-5 h-5 text-stone-400" />
                          )}
                        </div>
                        <div className="flex-1">
                          <p className={cn(
                            "font-medium transition-colors duration-200",
                            isActive && "text-stone-800",
                            isComplete && "text-emerald-700",
                            !isActive && !isComplete && "text-stone-500"
                          )}>
                            {step.label}
                          </p>
                        </div>
                      </div>
                    );
                  })}
                </div>
                <p className="text-center text-stone-500 text-sm mt-6">
                  This may take a few minutes. Please don't close this window.
                </p>
              </div>
            ) : hasResults ? (
              <>
                {/* Results Grid */}
                <div className="grid grid-cols-2 gap-4">
                  {photoUrl && (
                    <div className="bg-white rounded-2xl border border-stone-200 overflow-hidden animate-fade-in">
                      <div className="aspect-square relative bg-stone-50">
                        <img src={photoUrl} alt="Generated photo" className="w-full h-full object-contain" />
                      </div>
                      <div className="p-4 flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          <Camera className="w-4 h-4 text-stone-500" />
                          <span className="text-sm font-medium text-stone-700">Photo</span>
                        </div>
                        <div className="flex gap-2">
                          <Button size="sm" variant="ghost" onClick={() => { setActiveOverlay('photo'); setViewerOpen(true); }}>
                            <Eye className="w-4 h-4" />
                          </Button>
                          <Button size="sm" variant="ghost" onClick={() => handleDownload(photoUrl, 'photo')}>
                            <Download className="w-4 h-4" />
                          </Button>
                        </div>
                      </div>
                    </div>
                  )}
                  
                  {musclesUrl && (
                    <div 
                      className="bg-white rounded-2xl border border-stone-200 overflow-hidden animate-fade-in"
                      style={{ animationDelay: '50ms' }}
                    >
                      <div className="aspect-square relative bg-stone-50">
                        <img src={musclesUrl} alt="Muscle visualization" className="w-full h-full object-contain" />
                      </div>
                      <div className="p-4 flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          <Activity className="w-4 h-4 text-red-500" />
                          <span className="text-sm font-medium text-stone-700">Muscles</span>
                        </div>
                        <div className="flex gap-2">
                          <Button size="sm" variant="ghost" onClick={() => { setActiveOverlay('muscles'); setViewerOpen(true); }}>
                            <Eye className="w-4 h-4" />
                          </Button>
                          <Button size="sm" variant="ghost" onClick={() => handleDownload(musclesUrl, 'muscles')}>
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
                >
                  <Layers className="w-4 h-4 mr-2" />
                  Open Full Viewer
                </Button>
              </>
            ) : (
              <div className="bg-white rounded-2xl border border-stone-200 p-12 text-center">
                <div className="w-16 h-16 rounded-full bg-stone-100 flex items-center justify-center mx-auto mb-4">
                  <Sparkles className="w-7 h-7 text-stone-400" />
                </div>
                <h3 className="text-lg font-medium text-stone-700 mb-2">Ready to Generate</h3>
                <p className="text-stone-500 text-sm">
                  Upload a schematic image or describe a pose to get started
                </p>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Full Viewer Dialog */}
      <Dialog open={viewerOpen} onOpenChange={setViewerOpen}>
        <DialogContent className="max-w-5xl w-[95vw] h-[85vh] p-0 bg-stone-950 border-0 overflow-hidden" aria-describedby={undefined} hideCloseButton>
          <VisuallyHidden>
            <DialogTitle>Pose Viewer</DialogTitle>
          </VisuallyHidden>
          <div className="flex flex-col h-full">
            <div className="flex items-center justify-between px-6 py-4 border-b border-stone-800">
              <h2 className="text-xl font-medium text-white">Pose Viewer</h2>
              <div className="flex items-center gap-3">
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => handleDownload(activeOverlay === 'photo' ? photoUrl : musclesUrl, activeOverlay)}
                  className="text-stone-400 hover:text-white hover:bg-stone-800"
                >
                  <Download className="w-4 h-4 mr-2" />
                  Download
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
                  alt="Pose"
                  className="max-w-full max-h-full object-contain rounded-lg transition-opacity duration-200"
                />
              </div>

              <div className="w-72 bg-stone-900 border-l border-stone-800 p-6">
                <div className="flex items-center gap-2 mb-4">
                  <Layers className="w-4 h-4 text-stone-400" />
                  <h3 className="text-sm font-medium text-stone-300">Visualization Layer</h3>
                </div>
                <div className="space-y-2">
                  <button
                    onClick={() => setActiveOverlay('photo')}
                    className={cn(
                      "w-full flex items-center gap-3 px-4 py-3 rounded-xl transition-all",
                      activeOverlay === 'photo' ? "bg-white text-stone-900" : "bg-stone-800 text-stone-300 hover:bg-stone-700"
                    )}
                  >
                    <Camera className="w-5 h-5" />
                    <span className="font-medium">Photo</span>
                  </button>
                  {musclesUrl && (
                    <button
                      onClick={() => setActiveOverlay('muscles')}
                      className={cn(
                        "w-full flex items-center gap-3 px-4 py-3 rounded-xl transition-all",
                        activeOverlay === 'muscles' ? "bg-white text-stone-900" : "bg-stone-800 text-stone-300 hover:bg-stone-700"
                      )}
                    >
                      <Activity className="w-5 h-5" />
                      <span className="font-medium">Muscles</span>
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
