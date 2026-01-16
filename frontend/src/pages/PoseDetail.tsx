import React, { useEffect, useState } from "react";
import { useParams, Link } from "react-router-dom";
import { posesApi, categoriesApi, getImageProxyUrl } from "../services/api";
import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
import { Textarea } from "../components/ui/textarea";
import { Label } from "../components/ui/label";
import { Badge } from "../components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../components/ui/select";
import { Tabs, TabsList, TabsTrigger } from "../components/ui/tabs";
import { ArrowLeft, Sparkles, Edit2, Save, X, Trash2, Eye, Activity, Download, Loader2, AlertCircle, RefreshCw } from "lucide-react";
import { PoseViewer, GenerateModal } from "../components/Pose";
import type { Pose, Category } from "../types";
import { useI18n } from "../i18n";

export const PoseDetail: React.FC = () => {
  const { id } = useParams<{ id: string }>();
  const [pose, setPose] = useState<Pose | null>(null);
  const [categories, setCategories] = useState<Category[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const { t } = useI18n();
  const [isEditing, setIsEditing] = useState(false);
  const [editData, setEditData] = useState({
    name: "",
    name_en: "",
    description: "",
    category_id: "",
  });
  const [showViewer, setShowViewer] = useState(false);
  const [showGenerateModal, setShowGenerateModal] = useState(false);
  const [activeTab, setActiveTab] = useState<"photo" | "muscles">("photo");

  useEffect(() => {
    const fetchData = async () => {
      if (!id) return;
      setIsLoading(true);
      setError(null);
      try {
        const [poseData, categoriesData] = await Promise.all([
          posesApi.getById(parseInt(id, 10)),
          categoriesApi.getAll(),
        ]);
        setPose(poseData);
        setCategories(categoriesData);
        setEditData({
          name: poseData.name,
          name_en: poseData.name_en || "",
          description: poseData.description || "",
          category_id: poseData.category_id ? String(poseData.category_id) : "",
        });
      } catch (err) {
        setError(err instanceof Error ? err.message : t("pose.detail.not_found"));
      } finally {
        setIsLoading(false);
      }
    };

    fetchData();
  }, [id]);

  const handleSave = async () => {
    if (!pose) return;
    try {
      const updated = await posesApi.update(pose.id, {
        name: editData.name,
        name_en: editData.name_en || undefined,
        description: editData.description || undefined,
        category_id: editData.category_id ? parseInt(editData.category_id, 10) : undefined,
      });
      setPose(updated);
      setIsEditing(false);
    } catch (err) {
      console.error(err);
    }
  };

  const handleDelete = async () => {
    if (!pose) return;
    if (!window.confirm(t("pose.detail.delete_confirm"))) return;
    await posesApi.delete(pose.id);
    window.location.href = "/poses";
  };

  const getActiveImage = () => {
    if (!pose) return null;
    if (activeTab === "muscles" && pose.muscle_layer_path) {
      return getImageProxyUrl(pose.id, 'muscle_layer');
    }
    if (pose.photo_path) {
      return getImageProxyUrl(pose.id, 'photo');
    }
    return null;
  };

  const getSchemaImage = () => {
    if (!pose || !pose.schema_path) return null;
    return getImageProxyUrl(pose.id, 'schema');
  };

  const handleDownload = async () => {
    const imageUrl = getActiveImage();
    if (!imageUrl || !pose) return;
    const response = await fetch(imageUrl);
    const blob = await response.blob();
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${pose.name.replace(/\s+/g, "_")}_${activeTab}.png`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    window.URL.revokeObjectURL(url);
  };

  if (isLoading) {
    return (
      <div className="min-h-screen bg-stone-50 flex items-center justify-center">
        <Loader2 className="w-8 h-8 text-stone-400 animate-spin" />
      </div>
    );
  }

  if (error || !pose) {
    return (
      <div className="min-h-screen bg-stone-50 flex items-center justify-center">
        <div className="text-center">
          <AlertCircle className="w-12 h-12 text-red-400 mx-auto mb-4" />
          <h2 className="text-xl font-medium text-stone-800 mb-2">{t("pose.detail.not_found")}</h2>
          <Link to="/poses">
            <Button variant="outline">{t("pose.detail.back")}</Button>
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-stone-50">
      <header className="bg-white border-b border-stone-200">
        <div className="max-w-7xl mx-auto px-6 py-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-4">
              <Link to="/poses">
                <Button variant="ghost" size="icon" className="text-stone-500">
                  <ArrowLeft className="w-5 h-5" />
                </Button>
              </Link>
              <div>
                <h1 className="text-xl font-semibold text-stone-800">{pose.name}</h1>
                <div className="flex items-center gap-2 mt-1">
                  <Badge className={pose.photo_path ? "bg-emerald-100 text-emerald-700" : "bg-stone-100 text-stone-600"}>
                    {pose.photo_path ? t("pose.badge.complete") : t("pose.badge.draft")}
                  </Badge>
                  {pose.category_name && (
                    <Badge variant="outline" className="text-stone-500">
                      {pose.category_name}
                    </Badge>
                  )}
                </div>
              </div>
            </div>
            <div className="flex items-center gap-3">
              {pose.photo_path ? (
                <>
                  <Button onClick={() => setShowViewer(true)} variant="outline">
                    <Eye className="w-4 h-4 mr-2" />
                    {t("pose.detail.full_view")}
                  </Button>
                  <Button onClick={() => setShowGenerateModal(true)} variant="outline">
                    <RefreshCw className="w-4 h-4 mr-2" />
                    {t("pose.detail.regenerate")}
                  </Button>
                </>
              ) : (
                <Button onClick={() => setShowGenerateModal(true)} className="bg-stone-800 hover:bg-stone-900">
                  <Sparkles className="w-4 h-4 mr-2" />
                  {t("pose.generate_cta")}
                </Button>
              )}
              <Button
                variant="ghost"
                size="icon"
                onClick={handleDelete}
                className="text-red-500 hover:text-red-700 hover:bg-red-50"
              >
                <Trash2 className="w-4 h-4" />
              </Button>
            </div>
          </div>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-6 py-8">
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
          <div className="space-y-6">
            {pose.photo_path ? (
              <div className="bg-white rounded-2xl border border-stone-200 overflow-hidden">
                <div className="p-4 border-b border-stone-100">
                  <Tabs value={activeTab} onValueChange={(value) => setActiveTab(value as "photo" | "muscles")}>
                    <TabsList className="grid grid-cols-2 bg-stone-100 p-1">
                      <TabsTrigger value="photo" className="text-sm">
                        <Eye className="w-4 h-4 mr-1" />
                        {t("pose.tabs.photo")}
                      </TabsTrigger>
                      <TabsTrigger value="muscles" disabled={!pose.muscle_layer_path} className="text-sm">
                        <Activity className="w-4 h-4 mr-1" />
                        {t("pose.tabs.muscles")}
                      </TabsTrigger>
                    </TabsList>
                  </Tabs>
                </div>
                <div className="p-4">
                  <img
                    src={getActiveImage() || pose.photo_path}
                    alt={pose.name}
                    className="w-full rounded-xl transition-opacity duration-200"
                  />
                </div>
                <div className="p-4 border-t border-stone-100 flex justify-end">
                  <Button variant="outline" onClick={handleDownload}>
                    <Download className="w-4 h-4 mr-2" />
                    {t("pose.download")}
                  </Button>
                </div>
              </div>
            ) : (
              <div className="bg-white rounded-2xl border border-stone-200 p-12 text-center">
                <div className="w-16 h-16 rounded-full bg-stone-100 flex items-center justify-center mx-auto mb-4">
                  <Sparkles className="w-8 h-8 text-stone-400" />
                </div>
                <h3 className="text-lg font-medium text-stone-800 mb-2">{t("pose.detail.no_image")}</h3>
                <p className="text-stone-500">{t("pose.detail.no_image_hint")}</p>
              </div>
            )}

              {pose.schema_path && (
                <div className="bg-white rounded-2xl border border-stone-200 p-6">
                  <h3 className="text-sm font-medium text-stone-600 mb-4">{t("pose.detail.source_schematic")}</h3>
                  <img
                    src={getSchemaImage() || ''}
                    alt={t("pose.file_alt")}
                    className="w-full rounded-xl border border-stone-100"
                  />
                </div>
              )}

          </div>

          <div className="space-y-6">
            <div className="bg-white rounded-2xl border border-stone-200 p-6">
              <div className="flex items-center justify-between mb-6">
                <h3 className="text-lg font-medium text-stone-800">{t("pose.detail.details")}</h3>
                {!isEditing ? (
                  <Button variant="ghost" size="sm" onClick={() => setIsEditing(true)}>
                    <Edit2 className="w-4 h-4 mr-2" />
                    {t("pose.detail.edit")}
                  </Button>
                ) : (
                  <div className="flex gap-2">
                    <Button variant="ghost" size="sm" onClick={() => setIsEditing(false)}>
                      <X className="w-4 h-4 mr-2" />
                      {t("pose.detail.cancel")}
                    </Button>
                    <Button size="sm" onClick={handleSave}>
                      <Save className="w-4 h-4 mr-2" />
                      {t("pose.detail.save")}
                    </Button>
                  </div>
                )}
              </div>

              <div className="space-y-4">
                <div className="space-y-2">
                  <Label className="text-stone-600">{t("pose.detail.name")}</Label>
                  {isEditing ? (
                    <Input
                      value={editData.name}
                      onChange={(e) => setEditData({ ...editData, name: e.target.value })}
                    />
                  ) : (
                    <p className="text-stone-800 font-medium">{pose.name}</p>
                  )}
                </div>

                <div className="space-y-2">
                  <Label className="text-stone-600">{t("pose.detail.name_en")}</Label>
                  {isEditing ? (
                    <Input
                      value={editData.name_en}
                      onChange={(e) => setEditData({ ...editData, name_en: e.target.value })}
                    />
                  ) : (
                    <p className="text-stone-800">{pose.name_en || "-"}</p>
                  )}
                </div>

                <div className="space-y-2">
                  <Label className="text-stone-600">{t("pose.detail.category")}</Label>
                  {isEditing ? (
                    <Select
                      value={editData.category_id || "__none__"}
                      onValueChange={(value) => setEditData({ ...editData, category_id: value === "__none__" ? "" : value })}
                    >
                      <SelectTrigger>
                        <SelectValue placeholder={t("upload.category_placeholder")} />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="__none__">{t("pose.uncategorized")}</SelectItem>
                        {categories.map((cat) => (
                          <SelectItem key={cat.id} value={String(cat.id)}>
                            {cat.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  ) : (
                    <p className="text-stone-800">{pose.category_name || "-"}</p>
                  )}
                </div>

                <div className="space-y-2">
                  <Label className="text-stone-600">{t("pose.detail.description")}</Label>
                  {isEditing ? (
                    <Textarea
                      value={editData.description}
                      onChange={(e) => setEditData({ ...editData, description: e.target.value })}
                      rows={3}
                    />
                  ) : (
                    <p className="text-stone-800">{pose.description || t("pose.detail.no_description")}</p>
                  )}
                </div>
              </div>
            </div>
          </div>
        </div>
      </main>

      {showViewer && (
        <PoseViewer pose={pose} isOpen={showViewer} onClose={() => setShowViewer(false)} />
      )}

      {showGenerateModal && (
        <GenerateModal
          pose={pose}
          isOpen={showGenerateModal}
          onClose={() => setShowGenerateModal(false)}
          onComplete={async () => {
            // Refresh pose data after generation
            // Note: GenerateModal handles closing via onClose(), so we only refresh data here
            if (id) {
              const updatedPose = await posesApi.getById(parseInt(id, 10));
              setPose(updatedPose);
            }
          }}
        />
      )}
    </div>
  );
};
