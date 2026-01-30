import React, { useEffect, useState, useCallback } from "react";
import { useParams, Link, useNavigate } from "react-router-dom";
import { motion, AnimatePresence } from "framer-motion";
import { posesApi, categoriesApi, exportApi, downloadBlob } from "../services/api";
import { usePoseImageSrc } from "../hooks/usePoseImageSrc";
import { useViewTransition } from "../hooks/useViewTransition";
import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
import { Textarea } from "../components/ui/textarea";
import { Label } from "../components/ui/label";
import { Badge } from "../components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../components/ui/select";
import { Tabs, TabsList, TabsTrigger } from "../components/ui/tabs";
import { ArrowLeft, Sparkles, Edit2, Save, X, Trash2, Eye, Activity, Download, Loader2, AlertCircle, RefreshCw, FileText, Plus } from "lucide-react";
import { PoseViewer, GenerateModal, RegenerateModal, VersionHistory, VersionDiffViewer, VersionRestoreModal, VersionDetailModal } from "../components/Pose";
import { CategoryModal } from "../components/Category/CategoryModal";
import { MuscleOverlay } from "../components/Anatomy";
import { ConfirmDialog } from "../components/ui/confirm-dialog";
import { ErrorBoundary } from "../components/ui/error-boundary";
import type { Pose, Category } from "../types";
import { useI18n } from "../i18n";
import { useAppStore } from "../store/useAppStore";
import { logger } from "../lib/logger";

/**
 * Internal component containing the PoseDetail logic.
 * Wrapped by ErrorBoundary to prevent crashes from propagating.
 */
const PoseDetailContent: React.FC = () => {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [pose, setPose] = useState<Pose | null>(null);
  const [categories, setCategories] = useState<Category[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const { t } = useI18n();
  const { startTransition } = useViewTransition();
  const [isEditing, setIsEditing] = useState(false);
  const [editData, setEditData] = useState({
    name: "",
    name_en: "",
    description: "",
    category_id: "",
    change_note: "",
  });
  const [showViewer, setShowViewer] = useState(false);
  const [showGenerateModal, setShowGenerateModal] = useState(false);
  const [showRegenerateModal, setShowRegenerateModal] = useState(false);
  const [activeTab, setActiveTab] = useState<"photo" | "muscles">("photo");

  // Version history state
  const [showVersionDetail, setShowVersionDetail] = useState<number | null>(null);
  const [showVersionDiff, setShowVersionDiff] = useState<{ v1: number; v2: number } | null>(null);
  const [showRestoreModal, setShowRestoreModal] = useState<{ versionId: number; versionNumber: number } | null>(null);
  const [versionHistoryKey, setVersionHistoryKey] = useState(0);
  const [isExportingPdf, setIsExportingPdf] = useState(false);

  // Delete confirmation state
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);

  // Category modal state
  const [showCategoryModal, setShowCategoryModal] = useState(false);

  // Saving state
  const [isSaving, setIsSaving] = useState(false);

  // Muscle reanalysis state
  const [isReanalyzingMuscles, setIsReanalyzingMuscles] = useState(false);

  // Toast notifications
  const addToast = useAppStore((state) => state.addToast);

  const refreshCategories = useCallback(() => {
    categoriesApi.getAll().then(setCategories).catch(console.error);
  }, []);

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
          change_note: "",
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
    setIsSaving(true);
    try {
      const updated = await posesApi.update(pose.id, {
        name: editData.name,
        name_en: editData.name_en || undefined,
        description: editData.description || undefined,
        category_id: editData.category_id ? parseInt(editData.category_id, 10) : undefined,
        change_note: editData.change_note || undefined,
      });
      setPose(updated);
      setIsEditing(false);
      // Clear change note after successful save
      setEditData(prev => ({ ...prev, change_note: "" }));
      // Reload version history
      setVersionHistoryKey(prev => prev + 1);
      // Show success toast
      addToast({
        type: "success",
        message: t("pose.detail.save_success"),
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : t("pose.detail.save_error");
      setError(message);
      addToast({
        type: "error",
        message: message,
      });
    } finally {
      setIsSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!pose) return;
    setIsDeleting(true);
    try {
      await posesApi.delete(pose.id);
      addToast({
        type: "success",
        message: t("pose.detail.delete_success"),
      });
      navigate("/poses");
    } catch (err) {
      logger.error("Failed to delete pose:", err);
      const message = err instanceof Error ? err.message : t("pose.detail.delete_error");
      setError(message);
      addToast({
        type: "error",
        message: message,
      });
    } finally {
      setIsDeleting(false);
      setShowDeleteConfirm(false);
    }
  };

  const activeImageType = activeTab === "muscles" ? "muscle_layer" : "photo";
  const activeDirectPath =
    activeTab === "muscles" ? pose?.muscle_layer_path : pose?.photo_path;
  const { src: activeImageSrc, refresh: refreshActiveImage } = usePoseImageSrc(
    activeDirectPath,
    pose?.id ?? 0,
    activeImageType,
    { enabled: Boolean(pose && activeDirectPath) }
  );

  const { src: schemaImageSrc, refresh: refreshSchemaImage } = usePoseImageSrc(
    pose?.schema_path,
    pose?.id ?? 0,
    "schema",
    { enabled: Boolean(pose?.schema_path) }
  );

  const handleDownload = async () => {
    const imageUrl = activeImageSrc;
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

  const handleExportPdf = async () => {
    if (!pose) return;
    setIsExportingPdf(true);
    try {
      const blob = await exportApi.posePdf(pose.id);
      const safeName = pose.name.replace(/[^a-zA-Z0-9-_]/g, '_');
      downloadBlob(blob, `${pose.code}_${safeName}.pdf`);
    } catch (err) {
      logger.error('PDF export failed:', err);
    } finally {
      setIsExportingPdf(false);
    }
  };

  const handleReanalyzeMuscles = async () => {
    if (!pose) return;
    setIsReanalyzingMuscles(true);
    try {
      const updatedPose = await posesApi.reanalyzeMuscles(pose.id);
      setPose(updatedPose);
      addToast({
        type: "success",
        message: t("pose.muscles.reanalyze_success"),
      });
    } catch (err) {
      logger.error("Failed to reanalyze muscles:", err);
      const message = err instanceof Error ? err.message : t("pose.muscles.reanalyze_error");
      addToast({
        type: "error",
        message: message,
      });
    } finally {
      setIsReanalyzingMuscles(false);
    }
  };

  if (isLoading) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <Loader2 className="w-8 h-8 text-muted-foreground animate-spin" />
      </div>
    );
  }

  if (error || !pose) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="text-center">
          <AlertCircle className="w-12 h-12 text-red-400 mx-auto mb-4" />
          <h2 className="text-xl font-medium text-foreground mb-2">{t("pose.detail.not_found")}</h2>
          <Link to="/poses">
            <Button variant="outline">{t("pose.detail.back")}</Button>
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background">
      <header className="bg-card border-b border-border">
        <div className="max-w-7xl mx-auto px-6 py-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-4">
              <Link to="/poses">
                <Button variant="ghost" size="icon" className="text-muted-foreground">
                  <ArrowLeft className="w-5 h-5" />
                </Button>
              </Link>
              <div>
                <h1 className="text-xl font-semibold text-foreground">{pose.name}</h1>
                <div className="flex items-center gap-2 mt-1">
                  <Badge className={pose.photo_path ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400" : "bg-muted text-muted-foreground"}>
                    {pose.photo_path ? t("pose.badge.complete") : t("pose.badge.draft")}
                  </Badge>
                  {pose.category_name && (
                    <Badge variant="outline" className="text-muted-foreground">
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
                  <Button onClick={() => setShowRegenerateModal(true)} variant="outline">
                    <RefreshCw className="w-4 h-4 mr-2" />
                    {t("pose.detail.regenerate")}
                  </Button>
                </>
              ) : (
                <Button onClick={() => setShowGenerateModal(true)} className="bg-primary hover:bg-primary/90">
                  <Sparkles className="w-4 h-4 mr-2" />
                  {t("pose.generate_cta")}
                </Button>
              )}
              <Button
                onClick={handleExportPdf}
                variant="outline"
                disabled={isExportingPdf}
              >
                {isExportingPdf ? (
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                ) : (
                  <FileText className="w-4 h-4 mr-2" />
                )}
                {t("export.pdf")}
              </Button>
              <Button
                variant="ghost"
                size="icon"
                onClick={() => setShowDeleteConfirm(true)}
                className="text-red-500 hover:text-red-700 hover:bg-red-50"
                aria-label={t("pose.detail.delete")}
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
              <div className="bg-card rounded-2xl border border-border overflow-hidden">
                <div className="p-4 border-b border-border">
                  <Tabs value={activeTab} onValueChange={(value) => void startTransition(() => setActiveTab(value as "photo" | "muscles"))}>
                    <TabsList className="grid grid-cols-2 bg-muted p-1">
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
                  <AnimatePresence mode="wait">
                    <motion.img
                      key={activeTab}
                      src={activeImageSrc || undefined}
                      alt={pose.name}
                      className="w-full rounded-xl view-transition-image"
                      initial={{ opacity: 0, scale: 0.98 }}
                      animate={{ opacity: 1, scale: 1 }}
                      exit={{ opacity: 0, scale: 1.02 }}
                      transition={{ duration: 0.3 }}
                      onError={() => void refreshActiveImage(true)}
                    />
                  </AnimatePresence>
                </div>
                <div className="p-4 border-t border-border flex justify-end">
                  <Button variant="outline" onClick={handleDownload}>
                    <Download className="w-4 h-4 mr-2" />
                    {t("pose.download")}
                  </Button>
                </div>
              </div>
            ) : (
              <div className="bg-card rounded-2xl border border-border p-12 text-center">
                <div className="w-16 h-16 rounded-full bg-muted flex items-center justify-center mx-auto mb-4">
                  <Sparkles className="w-8 h-8 text-muted-foreground" />
                </div>
                <h3 className="text-lg font-medium text-foreground mb-2">{t("pose.detail.no_image")}</h3>
                <p className="text-muted-foreground">{t("pose.detail.no_image_hint")}</p>
              </div>
            )}

              {pose.schema_path && (
                <div className="bg-card rounded-2xl border border-border p-6">
                  <h3 className="text-sm font-medium text-muted-foreground mb-4">{t("pose.detail.source_schematic")}</h3>
                  <img
                    src={schemaImageSrc || undefined}
                    alt={t("pose.file_alt")}
                    className="w-full rounded-xl border border-border"
                    onError={() => void refreshSchemaImage(true)}
                  />
                </div>
              )}

              {/* Active Muscles Section */}
              {pose.muscles && pose.muscles.length > 0 ? (
                <div className="bg-card rounded-2xl border border-border p-6">
                  <div className="flex items-center justify-between mb-4">
                    <h3 className="text-sm font-medium text-muted-foreground flex items-center gap-2">
                      <Activity className="w-4 h-4" />
                      {t("pose.viewer.active_muscles")}
                    </h3>
                    {pose.photo_path && (
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={handleReanalyzeMuscles}
                        disabled={isReanalyzingMuscles}
                        className="text-muted-foreground hover:text-foreground"
                      >
                        {isReanalyzingMuscles ? (
                          <Loader2 className="w-4 h-4 animate-spin" />
                        ) : (
                          <RefreshCw className="w-4 h-4" />
                        )}
                      </Button>
                    )}
                  </div>
                  <MuscleOverlay muscles={pose.muscles} />
                </div>
              ) : pose.photo_path ? (
                <div className="bg-card rounded-2xl border border-border p-6">
                  <div className="flex items-center justify-between mb-4">
                    <h3 className="text-sm font-medium text-muted-foreground flex items-center gap-2">
                      <Activity className="w-4 h-4" />
                      {t("pose.viewer.active_muscles")}
                    </h3>
                  </div>
                  <div className="text-center py-4">
                    <p className="text-muted-foreground mb-4">{t("pose.muscles.not_analyzed")}</p>
                    <Button
                      onClick={handleReanalyzeMuscles}
                      disabled={isReanalyzingMuscles}
                      variant="outline"
                    >
                      {isReanalyzingMuscles ? (
                        <>
                          <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                          {t("pose.muscles.analyzing")}
                        </>
                      ) : (
                        <>
                          <RefreshCw className="w-4 h-4 mr-2" />
                          {t("pose.muscles.analyze")}
                        </>
                      )}
                    </Button>
                  </div>
                </div>
              ) : null}

          </div>

          <div className="space-y-6">
            <div className="bg-card rounded-2xl border border-border p-6">
              <div className="flex items-center justify-between mb-6">
                <h3 className="text-lg font-medium text-foreground">{t("pose.detail.details")}</h3>
                {!isEditing ? (
                  <Button variant="ghost" size="sm" onClick={() => setIsEditing(true)}>
                    <Edit2 className="w-4 h-4 mr-2" />
                    {t("pose.detail.edit")}
                  </Button>
                ) : (
                  <div className="flex gap-2">
                    <Button variant="ghost" size="sm" onClick={() => setIsEditing(false)} disabled={isSaving}>
                      <X className="w-4 h-4 mr-2" />
                      {t("pose.detail.cancel")}
                    </Button>
                    <Button size="sm" onClick={handleSave} disabled={isSaving}>
                      {isSaving ? (
                        <>
                          <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                          {t("app.saving")}
                        </>
                      ) : (
                        <>
                          <Save className="w-4 h-4 mr-2" />
                          {t("pose.detail.save")}
                        </>
                      )}
                    </Button>
                  </div>
                )}
              </div>

              <div className="space-y-4">
                <div className="space-y-2">
                  <Label className="text-muted-foreground">{t("pose.detail.name")}</Label>
                  {isEditing ? (
                    <Input
                      value={editData.name}
                      onChange={(e) => setEditData({ ...editData, name: e.target.value })}
                    />
                  ) : (
                    <p className="text-foreground font-medium">{pose.name}</p>
                  )}
                </div>

                <div className="space-y-2">
                  <Label className="text-muted-foreground">{t("pose.detail.name_en")}</Label>
                  {isEditing ? (
                    <Input
                      value={editData.name_en}
                      onChange={(e) => setEditData({ ...editData, name_en: e.target.value })}
                    />
                  ) : (
                    <p className="text-foreground">{pose.name_en || "-"}</p>
                  )}
                </div>

                <div className="space-y-2">
                  <Label className="text-muted-foreground">{t("pose.detail.category")}</Label>
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
                        <div className="border-t border-border mt-1 pt-1">
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
                  ) : (
                    <p className="text-foreground">{pose.category_name || "-"}</p>
                  )}
                </div>

                <div className="space-y-2">
                  <Label className="text-muted-foreground">{t("pose.detail.description")}</Label>
                  {isEditing ? (
                    <Textarea
                      value={editData.description}
                      onChange={(e) => setEditData({ ...editData, description: e.target.value })}
                      rows={3}
                    />
                  ) : (
                    <p className="text-foreground">{pose.description || t("pose.detail.no_description")}</p>
                  )}
                </div>

                {/* Change note - only shown when editing */}
                {isEditing && (
                  <div className="space-y-2 pt-4 border-t border-border">
                    <Label className="text-muted-foreground">{t("versions.change_note_label")}</Label>
                    <Input
                      value={editData.change_note}
                      onChange={(e) => setEditData({ ...editData, change_note: e.target.value })}
                      placeholder={t("versions.change_note_placeholder")}
                      maxLength={500}
                    />
                    <p className="text-xs text-muted-foreground">{t("versions.change_note_hint")}</p>
                  </div>
                )}
              </div>
            </div>

            {/* Version History */}
            <VersionHistory
              key={versionHistoryKey}
              poseId={pose.id}
              onViewVersion={(versionId) => setShowVersionDetail(versionId)}
              onRestoreVersion={(versionId, versionNumber) => setShowRestoreModal({ versionId, versionNumber })}
              onCompareVersions={(v1, v2) => setShowVersionDiff({ v1, v2 })}
            />
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

      {showRegenerateModal && (
        <RegenerateModal
          pose={pose}
          isOpen={showRegenerateModal}
          onClose={() => setShowRegenerateModal(false)}
          activeTab={activeTab}
          onComplete={async () => {
            // Refresh pose data after regeneration
            if (id) {
              const updatedPose = await posesApi.getById(parseInt(id, 10));
              setPose(updatedPose);
              // Force version history to reload
              setVersionHistoryKey((prev) => prev + 1);
            }
          }}
        />
      )}

      {/* Version Detail Modal */}
      {showVersionDetail !== null && (
        <VersionDetailModal
          poseId={pose.id}
          versionId={showVersionDetail}
          isOpen={true}
          onClose={() => setShowVersionDetail(null)}
          onRestore={(versionId, versionNumber) => {
            setShowVersionDetail(null);
            setShowRestoreModal({ versionId, versionNumber });
          }}
        />
      )}

      {/* Version Diff Modal */}
      {showVersionDiff && (
        <VersionDiffViewer
          poseId={pose.id}
          versionId1={showVersionDiff.v1}
          versionId2={showVersionDiff.v2}
          isOpen={true}
          onClose={() => setShowVersionDiff(null)}
        />
      )}

      {/* Version Restore Modal */}
      {showRestoreModal && (
        <VersionRestoreModal
          poseId={pose.id}
          versionId={showRestoreModal.versionId}
          versionNumber={showRestoreModal.versionNumber}
          isOpen={true}
          onClose={() => setShowRestoreModal(null)}
          onRestored={async () => {
            // Refresh pose data after restore
            if (id) {
              const updatedPose = await posesApi.getById(parseInt(id, 10));
              setPose(updatedPose);
              setEditData({
                name: updatedPose.name,
                name_en: updatedPose.name_en || "",
                description: updatedPose.description || "",
                category_id: updatedPose.category_id ? String(updatedPose.category_id) : "",
                change_note: "",
              });
              // Force version history to reload
              setVersionHistoryKey((prev) => prev + 1);
            }
          }}
        />
      )}

      {/* Delete Confirmation Dialog */}
      <ConfirmDialog
        isOpen={showDeleteConfirm}
        onClose={() => setShowDeleteConfirm(false)}
        onConfirm={handleDelete}
        title={t("pose.detail.delete_title")}
        description={t("pose.detail.delete_confirm_message", { name: pose.name })}
        confirmText={t("pose.detail.delete")}
        cancelText={t("pose.detail.cancel")}
        variant="danger"
        isLoading={isDeleting}
      />

      {/* Category Creation Modal */}
      <CategoryModal
        open={showCategoryModal}
        onOpenChange={setShowCategoryModal}
        onSuccess={refreshCategories}
      />
    </div>
  );
};

/**
 * PoseDetail page wrapped with ErrorBoundary.
 *
 * This prevents rendering errors in the pose detail page from crashing
 * the entire application. Users can recover by clicking "Try again"
 * or navigating back to the poses list.
 */
export const PoseDetail: React.FC = () => {
  const navigate = useNavigate();

  const handleReset = useCallback(() => {
    // Navigate back to poses list on error recovery
    navigate("/poses");
  }, [navigate]);

  return (
    <ErrorBoundary
      errorTitle="Failed to load pose details"
      errorDescription="An unexpected error occurred while displaying this pose. Please try again or go back to the poses list."
      resetButtonText="Go to Poses"
      onReset={handleReset}
    >
      <PoseDetailContent />
    </ErrorBoundary>
  );
};
