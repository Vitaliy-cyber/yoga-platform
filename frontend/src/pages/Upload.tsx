import React, { useRef, useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { motion, AnimatePresence } from "framer-motion";
import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
import { Textarea } from "../components/ui/textarea";
import { Label } from "../components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "../components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../components/ui/select";
import { Upload as UploadIcon, FileImage, Type, Loader2, AlertCircle } from "lucide-react";
import { categoriesApi, posesApi } from "../services/api";
import { useViewTransition } from "../hooks/useViewTransition";
import type { Category } from "../types";
import { useI18n } from "../i18n";

export const Upload: React.FC = () => {
  const navigate = useNavigate();
  const { startTransition } = useViewTransition();
  const [inputType, setInputType] = useState("schematic");
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [textDescription, setTextDescription] = useState("");
  const [category, setCategory] = useState("");
  const [uploadedFile, setUploadedFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [isUploading, setIsUploading] = useState(false);
  const [dragActive, setDragActive] = useState(false);
  const [categories, setCategories] = useState<Category[]>([]);
  const [error, setError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const { t } = useI18n();

  useEffect(() => {
    categoriesApi.getAll().then(setCategories).catch(console.error);
  }, []);

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

  const handleSubmit = async () => {
    if (!name) return;

    setIsUploading(true);
    setError(null);
    try {
      const pose = await posesApi.create({
        code: `${Date.now()}`,
        name,
        description: inputType === "text" && textDescription ? textDescription : description,
        category_id: category ? parseInt(category, 10) : undefined,
      });

      if (inputType === "schematic" && uploadedFile) {
        await posesApi.uploadSchema(pose.id, uploadedFile);
      }

      navigate(`/poses/${pose.id}`);
    } catch (err) {
      console.error("Error creating pose:", err);
      const message = err instanceof Error ? err.message : t("upload.error");
      setError(message);
    } finally {
      setIsUploading(false);
    }
  };

  return (
    <div className="min-h-screen bg-background py-8">
      <div className="max-w-4xl mx-auto px-6">
        <div className="bg-card rounded-2xl border border-border p-8">
          <h2 className="text-xl font-medium text-foreground mb-6">{t("upload.title")}</h2>

          {error && (
            <div className="mb-6 p-4 bg-red-50 dark:bg-red-900/30 border border-red-200 dark:border-red-800 rounded-xl flex items-start gap-3">
              <AlertCircle className="w-5 h-5 text-red-500 dark:text-red-400 flex-shrink-0 mt-0.5" />
              <div className="flex-1">
                <p className="text-red-700 dark:text-red-400 text-sm">{error}</p>
              </div>
              <button
                onClick={() => setError(null)}
                className="text-red-400 hover:text-red-600 dark:hover:text-red-300 text-sm"
                aria-label={t("app.dismiss")}
              >
                &times;
              </button>
            </div>
          )}

          <div className="space-y-6">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label className="text-muted-foreground">{t("upload.pose_name")}</Label>
                <Input
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder={t("upload.pose_name_placeholder")}
                  className="border-input"
                />
              </div>
              <div className="space-y-2">
                <Label className="text-muted-foreground">{t("upload.category")}</Label>
                <Select value={category} onValueChange={setCategory}>
                  <SelectTrigger className="border-input">
                    <SelectValue placeholder={t("upload.category_placeholder")} />
                  </SelectTrigger>
                  <SelectContent>
                    {categories.length === 0 ? (
                      <div className="py-6 text-center text-sm text-muted-foreground">
                        {t("upload.no_categories")}
                      </div>
                    ) : (
                      categories.map((cat) => (
                        <SelectItem key={cat.id} value={String(cat.id)}>
                          {cat.name}
                        </SelectItem>
                      ))
                    )}
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="space-y-2">
              <Label className="text-muted-foreground">{t("upload.description")}</Label>
              <Textarea
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder={t("upload.description_placeholder")}
                className="border-input min-h-[80px] resize-none"
              />
            </div>

            <Tabs value={inputType} onValueChange={(v) => startTransition(() => setInputType(v))} className="w-full">
              <TabsList className="grid w-full grid-cols-2 bg-muted p-1 rounded-xl">
                <TabsTrigger value="schematic" className="rounded-lg data-[state=active]:bg-card data-[state=active]:shadow-sm">
                  <FileImage className="w-4 h-4 mr-2" />
                  {t("upload.upload_schematic")}
                </TabsTrigger>
                <TabsTrigger value="text" className="rounded-lg data-[state=active]:bg-card data-[state=active]:shadow-sm">
                  <Type className="w-4 h-4 mr-2" />
                  {t("upload.text_description")}
                </TabsTrigger>
              </TabsList>

              <AnimatePresence mode="wait">
                <TabsContent value="schematic" className="mt-4" forceMount={inputType === "schematic" ? true : undefined}>
                  <motion.div
                    key="schematic"
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: -10 }}
                    transition={{ duration: 0.2 }}
                    className={`relative border-2 border-dashed rounded-xl transition-all duration-200 view-transition-tab-content ${
                      dragActive ? "border-border/80 bg-muted" : "border-border hover:border-border/80"
                    }`}
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
                            onClick={() => startTransition(() => {
                              setUploadedFile(null);
                              setPreviewUrl(null);
                            })}
                            className="absolute top-2 right-2 bg-card/90 backdrop-blur-sm rounded-full p-2 shadow-sm hover:bg-card transition-colors"
                            aria-label={t("upload.clear_file")}
                          >
                            <span className="text-muted-foreground text-sm">✕</span>
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
                        onKeyDown={(e) => {
                          if (e.key === "Enter" || e.key === " ") {
                            e.preventDefault();
                            fileInputRef.current?.click();
                          }
                        }}
                        tabIndex={0}
                        role="button"
                        aria-label={t("upload.drop_here")}
                      >
                        <div className="w-16 h-16 rounded-full bg-muted flex items-center justify-center mx-auto mb-4">
                          <UploadIcon className="w-7 h-7 text-muted-foreground" />
                        </div>
                          <p className="text-foreground font-medium">{t("upload.drop_here")}</p>
                          <p className="text-muted-foreground text-sm mt-1">{t("upload.browse")}</p>
                      </div>
                    )}
                  </motion.div>
                </TabsContent>
              </AnimatePresence>

              <AnimatePresence mode="wait">
                <TabsContent value="text" className="mt-4" forceMount={inputType === "text" ? true : undefined}>
                  <motion.div
                    key="text"
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: -10 }}
                    transition={{ duration: 0.2 }}
                    className="view-transition-tab-content"
                  >
                    <Textarea
                      value={textDescription}
                      onChange={(e) => setTextDescription(e.target.value)}
                      placeholder={t("upload.text_placeholder")}
                      className="border-input min-h-[200px] resize-none font-mono text-sm"
                    />
                  </motion.div>
                </TabsContent>
              </AnimatePresence>
            </Tabs>

            <Button
              onClick={handleSubmit}
              disabled={!name || isUploading || (inputType === "schematic" && !uploadedFile)}
              className="w-full bg-primary hover:bg-primary/90 text-primary-foreground h-12 rounded-xl font-medium"
            >
              {isUploading ? (
                <>
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                  {t("upload.creating")}
                </>
              ) : (
                t("upload.create")
              )}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
};
