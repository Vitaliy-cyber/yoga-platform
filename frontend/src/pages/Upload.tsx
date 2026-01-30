import React, { useRef, useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
import { Textarea } from "../components/ui/textarea";
import { Label } from "../components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "../components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../components/ui/select";
import { Upload as UploadIcon, FileImage, Type, Loader2, Plus } from "lucide-react";
import { categoriesApi, posesApi } from "../services/api";
import type { Category } from "../types";
import { useI18n } from "../i18n";
import { CategoryModal } from "../components/Category/CategoryModal";

export const Upload: React.FC = () => {
  const navigate = useNavigate();
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
  const [showCategoryModal, setShowCategoryModal] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const { t } = useI18n();

  const refreshCategories = () => {
    categoriesApi.getAll().then(setCategories).catch(console.error);
  };

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
    try {
      const pose = await posesApi.create({
        code: `${Date.now()}`,
        name,
        description,
        category_id: category ? parseInt(category, 10) : undefined,
      });

      if (inputType === "schematic" && uploadedFile) {
        await posesApi.uploadSchema(pose.id, uploadedFile);
      }

      navigate(`/poses/${pose.id}`);
    } catch (error) {
      console.error("Error creating pose:", error);
    } finally {
      setIsUploading(false);
    }
  };

  return (
    <div className="min-h-screen bg-stone-50 py-8">
      <div className="max-w-4xl mx-auto px-6">
        <div className="bg-white rounded-2xl border border-stone-200 p-8">
          <h2 className="text-xl font-medium text-stone-800 mb-6">{t("upload.title")}</h2>

          <div className="space-y-6">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label className="text-stone-600">{t("upload.pose_name")}</Label>
                <Input
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder={t("upload.pose_name_placeholder")}
                  className="border-stone-200"
                />
              </div>
              <div className="space-y-2">
                <Label className="text-stone-600">{t("upload.category")}</Label>
                <Select value={category} onValueChange={setCategory}>
                  <SelectTrigger className="border-stone-200">
                    <SelectValue placeholder={t("upload.category_placeholder")} />
                  </SelectTrigger>
                  <SelectContent>
                    {categories.length === 0 ? (
                      <div className="py-6 text-center text-sm text-stone-500">
                        {t("upload.no_categories")}
                      </div>
                    ) : (
                      categories.map((cat) => (
                        <SelectItem key={cat.id} value={String(cat.id)}>
                          {cat.name}
                        </SelectItem>
                      ))
                    )}
                    <div className="border-t border-stone-100 mt-1 pt-1">
                      <button
                        type="button"
                        onClick={(e) => {
                          e.preventDefault();
                          e.stopPropagation();
                          setShowCategoryModal(true);
                        }}
                        className="flex items-center gap-2 w-full px-2 py-2 text-sm text-primary hover:bg-accent rounded-sm transition-colors"
                      >
                        <Plus size={16} />
                        {t("nav.add_category")}
                      </button>
                    </div>
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="space-y-2">
              <Label className="text-stone-600">{t("upload.description")}</Label>
              <Textarea
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder={t("upload.description_placeholder")}
                className="border-stone-200 min-h-[80px] resize-none"
              />
            </div>

            <Tabs value={inputType} onValueChange={setInputType} className="w-full">
              <TabsList className="grid w-full grid-cols-2 bg-stone-100 p-1 rounded-xl">
                <TabsTrigger value="schematic" className="rounded-lg data-[state=active]:bg-white data-[state=active]:shadow-sm">
                  <FileImage className="w-4 h-4 mr-2" />
                  {t("upload.upload_schematic")}
                </TabsTrigger>
                <TabsTrigger value="text" className="rounded-lg data-[state=active]:bg-white data-[state=active]:shadow-sm">
                  <Type className="w-4 h-4 mr-2" />
                  {t("upload.text_description")}
                </TabsTrigger>
              </TabsList>

              <TabsContent value="schematic" className="mt-4">
                <div
                  className={`relative border-2 border-dashed rounded-xl transition-all duration-200 ${
                    dragActive ? "border-stone-400 bg-stone-50" : "border-stone-200 hover:border-stone-300"
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
                          onClick={() => {
                            setUploadedFile(null);
                            setPreviewUrl(null);
                          }}
                          className="absolute top-2 right-2 bg-white/90 backdrop-blur-sm rounded-full p-2 shadow-sm hover:bg-white transition-colors"
                        >
                          <span className="text-stone-600 text-sm">✕</span>
                        </button>
                      </div>
                      <p className="text-center text-sm text-stone-500 mt-3">
                        {uploadedFile?.name}
                      </p>
                    </div>
                  ) : (
                    <div className="p-12 text-center cursor-pointer" onClick={() => fileInputRef.current?.click()}>
                      <div className="w-16 h-16 rounded-full bg-stone-100 flex items-center justify-center mx-auto mb-4">
                        <UploadIcon className="w-7 h-7 text-stone-400" />
                      </div>
                        <p className="text-stone-600 font-medium">{t("upload.drop_here")}</p>
                        <p className="text-stone-400 text-sm mt-1">{t("upload.browse")}</p>

                    </div>
                  )}
                </div>
              </TabsContent>

              <TabsContent value="text" className="mt-4">
                <Textarea
                  value={textDescription}
                  onChange={(e) => setTextDescription(e.target.value)}
                  placeholder={t("upload.text_placeholder")}
                  className="border-stone-200 min-h-[200px] resize-none font-mono text-sm"
                />
              </TabsContent>
            </Tabs>

            <Button
              onClick={handleSubmit}
              disabled={!name || isUploading || (inputType === "schematic" && !uploadedFile)}
              className="w-full bg-stone-800 hover:bg-stone-900 text-white h-12 rounded-xl font-medium"
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

      {/* Category Creation Modal */}
      <CategoryModal
        open={showCategoryModal}
        onOpenChange={setShowCategoryModal}
        onSuccess={refreshCategories}
      />
    </div>
  );
};
