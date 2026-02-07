import React, { useEffect, useState, useCallback, useMemo, useRef } from "react";
import { useParams, Link, useNavigate, useLocation } from "react-router-dom";
import {
  posesApi,
  categoriesApi,
  exportApi,
  downloadBlob,
  getImageProxyUrl,
} from "../services/api";
import { usePoseImageSrc } from "../hooks/usePoseImageSrc";
import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
import { Textarea } from "../components/ui/textarea";
import { Label } from "../components/ui/label";
import { Badge } from "../components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "../components/ui/select";
import { Tabs, TabsList, TabsTrigger } from "../components/ui/tabs";
import {
  ArrowLeft,
  Sparkles,
  Edit2,
  Save,
  X,
  Trash2,
  Eye,
  Activity,
  Download,
  Loader2,
  AlertCircle,
  CheckCircle2,
  RefreshCw,
  FileText,
  Plus,
  ChevronDown,
  ImageIcon,
  Layers,
} from "lucide-react";
import {
  PoseViewer,
  GenerateModal,
  RegenerateModal,
  VersionHistory,
  VersionDiffViewer,
  VersionRestoreModal,
  VersionDetailModal,
} from "../components/Pose";
import { CategoryModal } from "../components/Category/CategoryModal";
import { MuscleOverlay } from "../components/Anatomy";
import { ConfirmDialog } from "../components/ui/confirm-dialog";
import { ErrorBoundary } from "../components/ui/error-boundary";
import { PoseDetailSkeleton } from "../components/ui/skeleton";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "../components/ui/dialog";
import type { Pose, Category, PoseListItem } from "../types";
import { useI18n } from "../i18n";
import { useAppStore } from "../store/useAppStore";
import { getAuthToken } from "../store/useAuthStore";
import { useGenerationStore } from "../store/useGenerationStore";
import { logger } from "../lib/logger";
import { decodeHtmlEntities } from "../lib/text";

const MUSCLE_WIDGET_EXIT_ANIMATION_MS = 220;
const PDF_UNICODE_FONT_FAMILY = "DejaVuSans";
const PDF_UNICODE_REGULAR_FILE = "DejaVuSans.ttf";
const PDF_UNICODE_BOLD_FILE = "DejaVuSans-Bold.ttf";

let pdfFontBase64Cache:
  | {
      regular: string;
      bold: string;
    }
  | null = null;
let pdfFontBase64Promise: Promise<{
  regular: string;
  bold: string;
}> | null = null;

const arrayBufferToBase64 = (buffer: ArrayBuffer): string => {
  const bytes = new Uint8Array(buffer);
  const chunkSize = 0x8000;
  let binary = "";
  for (let i = 0; i < bytes.length; i += chunkSize) {
    const chunk = bytes.subarray(i, i + chunkSize);
    binary += String.fromCharCode(...chunk);
  }
  return btoa(binary);
};

const fetchFontBase64 = async (path: string): Promise<string> => {
  const response = await fetch(path, { cache: "force-cache" });
  if (!response.ok) {
    throw new Error(`Failed to load PDF font: ${path}`);
  }
  const buffer = await response.arrayBuffer();
  return arrayBufferToBase64(buffer);
};

const ensurePdfUnicodeFontsLoaded = async (): Promise<{
  regular: string;
  bold: string;
}> => {
  if (pdfFontBase64Cache) {
    return pdfFontBase64Cache;
  }
  if (!pdfFontBase64Promise) {
    pdfFontBase64Promise = (async () => {
      const [regular, bold] = await Promise.all([
        fetchFontBase64(`/fonts/${PDF_UNICODE_REGULAR_FILE}`),
        fetchFontBase64(`/fonts/${PDF_UNICODE_BOLD_FILE}`),
      ]);
      pdfFontBase64Cache = { regular, bold };
      return pdfFontBase64Cache;
    })();
  }
  return pdfFontBase64Promise;
};

const registerPdfUnicodeFonts = async (doc: any): Promise<boolean> => {
  try {
    const fonts = await ensurePdfUnicodeFontsLoaded();

    try {
      doc.addFileToVFS(PDF_UNICODE_REGULAR_FILE, fonts.regular);
    } catch {
      // jsPDF can throw if font already exists in VFS. Safe to ignore.
    }
    try {
      doc.addFileToVFS(PDF_UNICODE_BOLD_FILE, fonts.bold);
    } catch {
      // jsPDF can throw if font already exists in VFS. Safe to ignore.
    }
    try {
      doc.addFont(PDF_UNICODE_REGULAR_FILE, PDF_UNICODE_FONT_FAMILY, "normal");
    } catch {
      // jsPDF can throw if font already exists in registry. Safe to ignore.
    }
    try {
      doc.addFont(PDF_UNICODE_BOLD_FILE, PDF_UNICODE_FONT_FAMILY, "bold");
    } catch {
      // jsPDF can throw if font already exists in registry. Safe to ignore.
    }

    doc.setFont(PDF_UNICODE_FONT_FAMILY, "normal");
    return true;
  } catch (err) {
    logger.warn("Unicode PDF font registration failed:", err);
    return false;
  }
};

type MuscleWidgetStatus = "idle" | "processing" | "success" | "error";
type PdfExportSettings = {
  includeStudioPhoto: boolean;
  includeMusclePhoto: boolean;
  includeActiveMuscles: boolean;
};

/**
 * Internal component containing the PoseDetail logic.
 * Wrapped by ErrorBoundary to prevent crashes from propagating.
 */
const PoseDetailContent: React.FC = () => {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const location = useLocation();
  const routePoseId = id ? parseInt(id, 10) : 0;
  const preloadedPoseState = (
    location.state as { preloadedPose?: PoseListItem } | null
  )?.preloadedPose;
  const initialPose = useMemo(
    () =>
      preloadedPoseState && preloadedPoseState.id === routePoseId
        ? ({
            id: preloadedPoseState.id,
            code: preloadedPoseState.code,
            name: preloadedPoseState.name,
            name_en: preloadedPoseState.name_en,
            category_id: preloadedPoseState.category_id,
            category_name: preloadedPoseState.category_name,
            description: null,
            effect: null,
            breathing: null,
            schema_path: preloadedPoseState.schema_path,
            photo_path: preloadedPoseState.photo_path,
            muscle_layer_path: null,
            skeleton_layer_path: null,
            version: preloadedPoseState.version,
            created_at: "",
            updated_at: "",
            muscles: [],
          } satisfies Pose)
        : null,
    [preloadedPoseState, routePoseId],
  );

  const [pose, setPose] = useState<Pose | null>(initialPose);
  const [categories, setCategories] = useState<Category[]>([]);
  const [isLoading, setIsLoading] = useState(() => !initialPose);
  const [error, setError] = useState<string | null>(null);
  const { t } = useI18n();
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

  // If the muscles overlay disappears (e.g., version restore), ensure we don't stay on a disabled tab.
  useEffect(() => {
    if (activeTab === "muscles" && pose?.photo_path && !pose.muscle_layer_path) {
      setActiveTab("photo");
    }
  }, [activeTab, pose?.muscle_layer_path, pose?.photo_path]);

  // Version history state
  const [showVersionDetail, setShowVersionDetail] = useState<number | null>(
    null,
  );
  const [showVersionDiff, setShowVersionDiff] = useState<{
    v1: number;
    v2: number;
  } | null>(null);
  const [showRestoreModal, setShowRestoreModal] = useState<{
    versionId: number;
    versionNumber: number;
  } | null>(null);
  const [versionHistoryKey, setVersionHistoryKey] = useState(0);
  const [isExportingPdf, setIsExportingPdf] = useState(false);
  const [pdfExportProgress, setPdfExportProgress] = useState(0);
  const [showPdfExportModal, setShowPdfExportModal] = useState(false);
  const [pdfExportSettings, setPdfExportSettings] = useState<PdfExportSettings>({
    includeStudioPhoto: true,
    includeMusclePhoto: false,
    includeActiveMuscles: true,
  });

  // Delete confirmation state
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);

  // Category modal state
  const [showCategoryModal, setShowCategoryModal] = useState(false);

  // Saving state
  const [isSaving, setIsSaving] = useState(false);

  // Muscle reanalysis state
  const [isReanalyzingMuscles, setIsReanalyzingMuscles] = useState(false);
  const [muscleWidgetStatus, setMuscleWidgetStatus] =
    useState<MuscleWidgetStatus>("idle");
  const [muscleWidgetVisible, setMuscleWidgetVisible] = useState(false);
  const [muscleWidgetExiting, setMuscleWidgetExiting] = useState(false);
  const [muscleWidgetCollapsed, setMuscleWidgetCollapsed] = useState(false);
  const [muscleWidgetProgress, setMuscleWidgetProgress] = useState(0);
  const [muscleWidgetMessage, setMuscleWidgetMessage] = useState("");
  const [muscleWidgetCount, setMuscleWidgetCount] = useState(0);
  const [floatingWidgetHeight, setFloatingWidgetHeight] = useState(0);
  const muscleWidgetProgressTimerRef = useRef<number | null>(null);
  const muscleWidgetAutoDismissTimerRef = useRef<number | null>(null);
  const muscleWidgetExitTimerRef = useRef<number | null>(null);

  // Toast notifications
  const addToast = useAppStore((state) => state.addToast);
  const visibleGenerationWidgetTaskCount = useGenerationStore((state) => {
    let visible = 0;
    for (let i = state.taskOrder.length - 1; i >= 0; i -= 1) {
      const task = state.tasks[state.taskOrder[i]];
      if (!task || task.dismissedAt) continue;
      visible += 1;
      if (visible >= 4) break;
    }
    return visible;
  });
  const hasGlobalGenerationWidget = visibleGenerationWidgetTaskCount > 0;

  const clearMuscleWidgetTimers = useCallback(() => {
    if (muscleWidgetProgressTimerRef.current !== null) {
      window.clearInterval(muscleWidgetProgressTimerRef.current);
      muscleWidgetProgressTimerRef.current = null;
    }
    if (muscleWidgetAutoDismissTimerRef.current !== null) {
      window.clearTimeout(muscleWidgetAutoDismissTimerRef.current);
      muscleWidgetAutoDismissTimerRef.current = null;
    }
    if (muscleWidgetExitTimerRef.current !== null) {
      window.clearTimeout(muscleWidgetExitTimerRef.current);
      muscleWidgetExitTimerRef.current = null;
    }
  }, []);

  const closeMuscleWidget = useCallback(() => {
    clearMuscleWidgetTimers();
    setMuscleWidgetExiting(true);
    muscleWidgetExitTimerRef.current = window.setTimeout(() => {
      setMuscleWidgetVisible(false);
      setMuscleWidgetExiting(false);
      setMuscleWidgetCollapsed(false);
      setMuscleWidgetStatus("idle");
      setMuscleWidgetProgress(0);
      setMuscleWidgetMessage("");
      setMuscleWidgetCount(0);
      muscleWidgetExitTimerRef.current = null;
    }, MUSCLE_WIDGET_EXIT_ANIMATION_MS);
  }, [clearMuscleWidgetTimers]);

  useEffect(() => {
    return () => {
      clearMuscleWidgetTimers();
    };
  }, [clearMuscleWidgetTimers]);

  useEffect(() => {
    const floatingRoot = document.querySelector<HTMLElement>(
      '[data-generation-floating-root="true"]',
    );
    if (!floatingRoot || typeof ResizeObserver === "undefined") {
      setFloatingWidgetHeight(0);
      return;
    }
    const syncHeight = () => {
      setFloatingWidgetHeight(floatingRoot.offsetHeight);
    };
    syncHeight();
    const observer = new ResizeObserver(syncHeight);
    observer.observe(floatingRoot);
    return () => observer.disconnect();
  }, [visibleGenerationWidgetTaskCount]);

  const refreshCategories = useCallback(() => {
    categoriesApi.getAll().then(setCategories).catch(console.error);
  }, []);

  const fetchPoseWithRetry = useCallback(async (poseId: number) => {
    const maxAttempts = 4;
    for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
      try {
        // eslint-disable-next-line no-await-in-loop
        return await posesApi.getById(poseId);
      } catch (err) {
        const anyErr = err as Error & { status?: number; isRateLimited?: boolean; retryAfter?: number };
        const status = anyErr.status ?? (anyErr.isRateLimited ? 429 : undefined);
        const isRetryable = status === 409 || status === 429 || status === 503;
        if (!isRetryable || attempt >= maxAttempts - 1) {
          throw err;
        }

        const retryAfterMs =
          status === 429 && anyErr.isRateLimited && typeof anyErr.retryAfter === "number"
            ? Math.max(250, Math.floor(anyErr.retryAfter * 1000))
            : null;
        const backoffMs =
          Math.min(retryAfterMs ?? Math.min(250 * 2 ** attempt, 3000), 5_000) +
          Math.floor(Math.random() * 100);
        // eslint-disable-next-line no-await-in-loop
        await new Promise((r) => setTimeout(r, backoffMs));
      }
    }
    // Unreachable.
    throw new Error("Failed to refresh pose");
  }, []);

  useEffect(() => {
    if (!id) return;
    if (initialPose && initialPose.id === routePoseId) {
      setPose((prev) => (prev?.id === initialPose.id ? prev : initialPose));
      setEditData((prev) => ({
        ...prev,
        name: initialPose.name,
        name_en: initialPose.name_en || "",
        description: "",
        category_id: initialPose.category_id ? String(initialPose.category_id) : "",
        change_note: "",
      }));
      setIsLoading(false);
      return;
    }

    // Prevent showing stale content when moving between pose pages without preloaded state.
    setPose((prev) => (prev?.id === routePoseId ? prev : null));
  }, [id, initialPose, routePoseId]);

  useEffect(() => {
    const fetchData = async () => {
      if (!id) return;
      const hasRenderablePose = Boolean(initialPose && initialPose.id === routePoseId);
      if (!hasRenderablePose) {
        setIsLoading(true);
      }
      setError(null);
      try {
        const [poseData, categoriesData] = await Promise.all([
          fetchPoseWithRetry(parseInt(id, 10)),
          categoriesApi.getAll(),
        ]);
        setPose(poseData);
        setCategories(categoriesData);
        setEditData({
          name: poseData.name,
          name_en: poseData.name_en || "",
          description: decodeHtmlEntities(poseData.description || ""),
          category_id: poseData.category_id ? String(poseData.category_id) : "",
          change_note: "",
        });
      } catch (err) {
        setError(
          err instanceof Error ? err.message : t("pose.detail.not_found"),
        );
      } finally {
        setIsLoading(false);
      }
    };

    void fetchData();
  }, [fetchPoseWithRetry, id, initialPose, routePoseId, t]);

  const handleSave = async () => {
    if (!pose) return;
    setIsSaving(true);
    try {
      const updated = await posesApi.update(pose.id, {
        name: editData.name,
        name_en: editData.name_en || undefined,
        description: editData.description || undefined,
        category_id: editData.category_id
          ? parseInt(editData.category_id, 10)
          : undefined,
        change_note: editData.change_note || undefined,
      });
      setPose(updated);
      setIsEditing(false);
      // Clear change note after successful save
      setEditData((prev) => ({ ...prev, change_note: "" }));
      // Reload version history
      setVersionHistoryKey((prev) => prev + 1);
      // Show success toast
      addToast({
        type: "success",
        message: t("pose.detail.save_success"),
      });
    } catch (err) {
      const message =
        err instanceof Error ? err.message : t("pose.detail.save_error");
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
      const message =
        err instanceof Error ? err.message : t("pose.detail.delete_error");
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
    { enabled: Boolean(pose && activeDirectPath), version: pose?.version },
  );
  const { src: studioImageSrc } = usePoseImageSrc(
    pose?.photo_path,
    pose?.id ?? 0,
    "photo",
    { enabled: Boolean(pose?.photo_path), version: pose?.version },
  );
  const { src: muscleLayerImageSrc } = usePoseImageSrc(
    pose?.muscle_layer_path,
    pose?.id ?? 0,
    "muscle_layer",
    { enabled: Boolean(pose?.muscle_layer_path), version: pose?.version },
  );

  const { src: schemaImageSrc, refresh: refreshSchemaImage } = usePoseImageSrc(
    pose?.schema_path,
    pose?.id ?? 0,
    "schema",
    { enabled: Boolean(pose?.schema_path), version: pose?.version },
  );
  const canIncludeStudioPhoto = Boolean(pose?.photo_path);
  const canIncludeMusclePhoto = Boolean(pose?.muscle_layer_path);
  const canIncludeActiveMuscles = Boolean(pose?.muscles?.length);

  const openPdfExportModal = useCallback(() => {
    if (!pose) return;
    const preferMuscles = activeTab === "muscles" && canIncludeMusclePhoto;
    const includeStudioPhoto = canIncludeStudioPhoto && !preferMuscles;
    const includeMusclePhoto = canIncludeMusclePhoto && preferMuscles;
    const fallbackIncludeStudio = !includeStudioPhoto && !includeMusclePhoto && canIncludeStudioPhoto;
    const fallbackIncludeMuscle = !includeStudioPhoto && !includeMusclePhoto && !fallbackIncludeStudio && canIncludeMusclePhoto;
    setPdfExportSettings({
      includeStudioPhoto: includeStudioPhoto || fallbackIncludeStudio,
      includeMusclePhoto: includeMusclePhoto || fallbackIncludeMuscle,
      includeActiveMuscles: canIncludeActiveMuscles,
    });
    setShowPdfExportModal(true);
  }, [
    activeTab,
    canIncludeActiveMuscles,
    canIncludeMusclePhoto,
    canIncludeStudioPhoto,
    pose,
  ]);

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

  const tryFastClientPdfExport = useCallback(
    async (
      filename: string,
      options: {
        poseTitle: string;
        categoryName?: string | null;
        poseDescription?: string | null;
        images: Array<{ label: string; urls: string[] }>;
        includeActiveMuscles: boolean;
        muscles?: Pose["muscles"];
      },
      onProgress?: (value: number) => void,
    ): Promise<boolean> => {
      try {
        onProgress?.(8);
        const authToken = getAuthToken();
        const loadImageCanvas = async (urls: string[]): Promise<HTMLCanvasElement> => {
          let lastError: unknown = null;
          for (const url of urls) {
            if (!url) continue;
            try {
              const response = await fetch(url, {
                cache: "force-cache",
                credentials: "include",
                headers: authToken
                  ? { Authorization: `Bearer ${authToken}` }
                  : undefined,
              });
              if (!response.ok) {
                throw new Error(`Image fetch failed: ${response.status}`);
              }
              const blob = await response.blob();
              if (!blob.type.startsWith("image/")) {
                throw new Error("Invalid image blob");
              }
              const bitmap = await createImageBitmap(blob);
              const canvas = document.createElement("canvas");
              canvas.width = bitmap.width;
              canvas.height = bitmap.height;
              const ctx = canvas.getContext("2d");
              if (!ctx) {
                bitmap.close();
                throw new Error("Failed to create canvas context");
              }
              ctx.drawImage(bitmap, 0, 0);
              bitmap.close();
              return canvas;
            } catch (err) {
              lastError = err;
            }
          }
          throw lastError ?? new Error("Failed to load image from all sources");
        };

        const preparedImagesSettled = await Promise.allSettled(
          options.images
            .filter((img) => img.urls.some(Boolean))
            .map(async (img) => ({
              label: img.label,
              canvas: await loadImageCanvas(img.urls),
            })),
        );
        const preparedImages = preparedImagesSettled
          .filter(
            (entry): entry is PromiseFulfilledResult<{ label: string; canvas: HTMLCanvasElement }> =>
              entry.status === "fulfilled",
          )
          .map((entry) => entry.value);
        onProgress?.(34);

        const { jsPDF } = await import("jspdf");
        const doc = new jsPDF({
          orientation: "portrait",
          unit: "pt",
          format: "a4",
          compress: true,
        });
        const hasUnicodeFont = await registerPdfUnicodeFonts(doc);
        if (!hasUnicodeFont) {
          return false;
        }
        onProgress?.(50);

        const pageW = doc.internal.pageSize.getWidth();
        const pageH = doc.internal.pageSize.getHeight();
        const margin = 24;
        const headerX = margin;
        const headerY = margin;
        const headerW = pageW - margin * 2;
        const headerH = 110;
        const tagMaxWidth = Math.max(120, Math.min(210, headerW * 0.34));
        const tagHorizontalPad = 10;
        const tagHeight = 20;
        const tagRightInset = 18;
        const tagTop = headerY + 16;
        const tagGap = 8;
        const exportedAt = new Date().toLocaleString("uk-UA");
        const title = options.poseTitle.trim() || "Поза";
        const categoryTag = options.categoryName?.trim() || "Без категорії";
        const descriptionText = options.poseDescription?.trim() || "";
        const hasDescription = descriptionText.length > 0;
        const muscles =
          options.includeActiveMuscles && options.muscles
            ? [...options.muscles].sort(
                (a, b) => (b.activation_level || 0) - (a.activation_level || 0),
              )
            : [];
        const mergeMusclePhotoIntoPrimary =
          !hasDescription &&
          Boolean(preparedImages[0]) &&
          Boolean(preparedImages[1]);
        const layerTag =
          preparedImages.length >= 2
            ? "Комбінований PDF"
            : preparedImages[0]?.label || "Без зображень";

        const fitTagText = (rawText: string): string => {
          doc.setFont(PDF_UNICODE_FONT_FAMILY, "bold");
          doc.setFontSize(9);
          const maxContentWidth = tagMaxWidth - tagHorizontalPad * 2;
          const source = (rawText || "").trim() || "-";
          if (doc.getTextWidth(source) <= maxContentWidth) return source;
          let trimmed = source;
          while (trimmed.length > 1 && doc.getTextWidth(`${trimmed}…`) > maxContentWidth) {
            trimmed = trimmed.slice(0, -1).trimEnd();
          }
          return `${trimmed}…`;
        };

        const drawTag = (y: number, text: string, bg: [number, number, number], fg: [number, number, number]) => {
          const label = fitTagText(text);
          doc.setFont(PDF_UNICODE_FONT_FAMILY, "bold");
          doc.setFontSize(9);
          const width = Math.max(92, Math.min(tagMaxWidth, doc.getTextWidth(label) + tagHorizontalPad * 2));
          const x = headerX + headerW - tagRightInset - width;
          doc.setFillColor(bg[0], bg[1], bg[2]);
          doc.roundedRect(x, y, width, tagHeight, 10, 10, "F");
          doc.setTextColor(fg[0], fg[1], fg[2]);
          doc.text(label, x + tagHorizontalPad, y + 13.2);
          return { height: tagHeight };
        };
        const unifiedTagBg: [number, number, number] = [209, 213, 219];
        const unifiedTagFg: [number, number, number] = [31, 41, 55];

        const drawRoundedImage = (sourceCanvas: HTMLCanvasElement, x: number, y: number, areaW: number, areaH: number) => {
          const sourceW = Math.max(sourceCanvas.width, 1);
          const sourceH = Math.max(sourceCanvas.height, 1);
          // Never upscale tiny sources; this avoids blocky artifacts.
          const displayScale = Math.min(areaW / sourceW, areaH / sourceH, 1);
          const displayW = Math.max(1, Math.round(sourceW * displayScale));
          const displayH = Math.max(1, Math.round(sourceH * displayScale));

          // Embed at higher pixel density to preserve sharpness in PDF viewers/print.
          const sourceDensityScale = Math.min(sourceW / displayW, sourceH / displayH);
          const resolutionBoost = Math.min(2.5, Math.max(1, sourceDensityScale));
          const embedW = Math.max(1, Math.round(displayW * resolutionBoost));
          const embedH = Math.max(1, Math.round(displayH * resolutionBoost));

          const roundedCanvas = document.createElement("canvas");
          roundedCanvas.width = embedW;
          roundedCanvas.height = embedH;
          const roundedCtx = roundedCanvas.getContext("2d");
          if (!roundedCtx) return;
          roundedCtx.imageSmoothingEnabled = true;
          roundedCtx.imageSmoothingQuality = "high";
          const r = Math.max(8, Math.round(Math.min(embedW, embedH) * 0.04));
          roundedCtx.beginPath();
          roundedCtx.moveTo(r, 0);
          roundedCtx.lineTo(embedW - r, 0);
          roundedCtx.quadraticCurveTo(embedW, 0, embedW, r);
          roundedCtx.lineTo(embedW, embedH - r);
          roundedCtx.quadraticCurveTo(embedW, embedH, embedW - r, embedH);
          roundedCtx.lineTo(r, embedH);
          roundedCtx.quadraticCurveTo(0, embedH, 0, embedH - r);
          roundedCtx.lineTo(0, r);
          roundedCtx.quadraticCurveTo(0, 0, r, 0);
          roundedCtx.closePath();
          roundedCtx.clip();
          roundedCtx.drawImage(sourceCanvas, 0, 0, sourceW, sourceH, 0, 0, embedW, embedH);
          doc.addImage(roundedCanvas.toDataURL("image/png"), "PNG", x, y, displayW, displayH);
        };

        const drawRoundedCoverImage = (sourceCanvas: HTMLCanvasElement, x: number, y: number, areaW: number, areaH: number) => {
          const sourceW = Math.max(sourceCanvas.width, 1);
          const sourceH = Math.max(sourceCanvas.height, 1);
          const targetW = Math.max(1, Math.round(areaW));
          const targetH = Math.max(1, Math.round(areaH));
          const scale = Math.max(targetW / sourceW, targetH / sourceH);
          const cropW = Math.max(1, Math.round(targetW / scale));
          const cropH = Math.max(1, Math.round(targetH / scale));
          const sx = Math.max(0, Math.floor((sourceW - cropW) / 2));
          const sy = Math.max(0, Math.floor((sourceH - cropH) / 2));

          const densityScale = Math.min(2.5, Math.max(1, sourceW / targetW, sourceH / targetH));
          const embedW = Math.max(1, Math.round(targetW * densityScale));
          const embedH = Math.max(1, Math.round(targetH * densityScale));
          const roundedCanvas = document.createElement("canvas");
          roundedCanvas.width = embedW;
          roundedCanvas.height = embedH;
          const roundedCtx = roundedCanvas.getContext("2d");
          if (!roundedCtx) return;
          roundedCtx.imageSmoothingEnabled = true;
          roundedCtx.imageSmoothingQuality = "high";
          const r = Math.max(8, Math.round(Math.min(embedW, embedH) * 0.04));
          roundedCtx.beginPath();
          roundedCtx.moveTo(r, 0);
          roundedCtx.lineTo(embedW - r, 0);
          roundedCtx.quadraticCurveTo(embedW, 0, embedW, r);
          roundedCtx.lineTo(embedW, embedH - r);
          roundedCtx.quadraticCurveTo(embedW, embedH, embedW - r, embedH);
          roundedCtx.lineTo(r, embedH);
          roundedCtx.quadraticCurveTo(0, embedH, 0, embedH - r);
          roundedCtx.lineTo(0, r);
          roundedCtx.quadraticCurveTo(0, 0, r, 0);
          roundedCtx.closePath();
          roundedCtx.clip();
          roundedCtx.drawImage(sourceCanvas, sx, sy, cropW, cropH, 0, 0, embedW, embedH);
          doc.addImage(roundedCanvas.toDataURL("image/png"), "PNG", x, y, targetW, targetH);
        };

        const drawCard = (x: number, y: number, w: number, h: number) => {
          doc.setFillColor(255, 255, 255);
          doc.roundedRect(x, y, w, h, 14, 14, "F");
          doc.setDrawColor(225, 230, 237);
          doc.roundedRect(x, y, w, h, 14, 14, "S");
        };

        const drawGradientBar = (
          x: number,
          y: number,
          width: number,
          height: number,
          percent: number,
        ) => {
          const safePercent = Math.max(0, Math.min(100, percent));
          doc.setFillColor(226, 232, 240);
          doc.roundedRect(x, y, width, height, height / 2, height / 2, "F");
          const fillWidth = Math.max(0, Math.round((width * safePercent) / 100));
          if (fillWidth <= 0) return;
          // Level-based color: 0% -> blue, 100% -> red (no red tail for low levels).
          const start = { r: 59, g: 130, b: 246 }; // #3B82F6
          const end = { r: 239, g: 68, b: 68 }; // #EF4444
          const t = safePercent / 100;
          const r = Math.round(start.r + (end.r - start.r) * t);
          const g = Math.round(start.g + (end.g - start.g) * t);
          const b = Math.round(start.b + (end.b - start.b) * t);
          doc.setFillColor(r, g, b);
          doc.roundedRect(x, y, fillWidth, height, height / 2, height / 2, "F");
        };

        // Page background + header
        doc.setFillColor(243, 244, 246);
        doc.rect(0, 0, pageW, pageH, "F");
        doc.setFillColor(229, 231, 235);
        doc.roundedRect(headerX, headerY, headerW, headerH, 16, 16, "F");
        doc.setDrawColor(209, 213, 219);
        doc.roundedRect(headerX, headerY, headerW, headerH, 16, 16, "S");
        doc.setTextColor(31, 41, 55);
        doc.setFont(PDF_UNICODE_FONT_FAMILY, "bold");
        doc.setFontSize(21);
        const titleLines = doc.splitTextToSize(title, headerW - tagMaxWidth - 56);
        doc.text(titleLines, headerX + 18, headerY + 33);
        doc.setFont(PDF_UNICODE_FONT_FAMILY, "normal");
        doc.setFontSize(10.5);
        doc.setTextColor(75, 85, 99);
        // Pin export timestamp to the lower-left corner area of the header card.
        doc.text(`Експортовано: ${exportedAt}`, headerX + 18, headerY + headerH - 14);
        let nextTagY = tagTop;
        const layer = drawTag(nextTagY, layerTag, unifiedTagBg, unifiedTagFg);
        nextTagY += layer.height + tagGap;
        drawTag(nextTagY, categoryTag, unifiedTagBg, unifiedTagFg);
        nextTagY += layer.height + tagGap;
        if (muscles.length > 0) {
          drawTag(nextTagY, `Активні м'язи: ${muscles.length}`, unifiedTagBg, unifiedTagFg);
        }
        onProgress?.(72);

        const bodyX = margin;
        const bodyY = headerY + headerH + 14;
        const bodyW = pageW - margin * 2;
        const bodyMaxH = pageH - bodyY - margin - 28;
        const sectionGap = 12;
        const sections: Array<"primary" | "secondary" | "muscles" | "description" | "empty"> = [];
        if (preparedImages[0]) sections.push("primary");
        if (preparedImages[1] && !mergeMusclePhotoIntoPrimary) sections.push("secondary");
        if (muscles.length > 0) sections.push("muscles");
        if (sections.length === 0 && hasDescription) sections.push("description");
        if (sections.length === 0) sections.push("empty");
        const baseHeights: Record<string, number> = { primary: 270, secondary: 200, muscles: 180, description: 140, empty: 110 };
        const minHeights: Record<string, number> = { primary: 170, secondary: 120, muscles: 120, description: 100, empty: 80 };
        const baseSum = sections.reduce((acc, key) => acc + baseHeights[key], 0);
        const gapsTotal = Math.max(0, sections.length - 1) * sectionGap;
        const scale = Math.min(1, Math.max(0.45, (bodyMaxH - gapsTotal) / Math.max(baseSum, 1)));
        const heights = sections.map((key) => Math.max(minHeights[key], Math.round(baseHeights[key] * scale)));
        let used = heights.reduce((acc, h) => acc + h, 0) + gapsTotal;
        if (used > bodyMaxH) {
          let overflow = used - bodyMaxH;
          for (let i = heights.length - 1; i >= 0 && overflow > 0; i -= 1) {
            const key = sections[i];
            const canReduce = Math.max(0, heights[i] - minHeights[key]);
            const reduceBy = Math.min(canReduce, overflow);
            heights[i] -= reduceBy;
            overflow -= reduceBy;
          }
        }

        let cursorY = bodyY;
        sections.forEach((section, idx) => {
          const sectionH = heights[idx];
          drawCard(bodyX, cursorY, bodyW, sectionH);
          const pad = 12;
          const innerX = bodyX + pad;
          const innerY = cursorY + pad;
          const innerW = bodyW - pad * 2;
          const innerH = sectionH - pad * 2;

          if (section === "primary" && preparedImages[0]) {
            const hasSidePanel = hasDescription || mergeMusclePhotoIntoPrimary;
            const gap = hasSidePanel ? 12 : 0;
            const descW = hasSidePanel
              ? mergeMusclePhotoIntoPrimary
                ? Math.max(180, Math.floor((innerW - gap) / 2))
                : Math.max(130, Math.min(180, innerW * 0.28))
              : 0;
            const imageAreaW = hasSidePanel
              ? mergeMusclePhotoIntoPrimary
                ? Math.max(180, innerW - gap - descW)
                : innerW - descW - gap
              : innerW;
            if (mergeMusclePhotoIntoPrimary) {
              drawRoundedCoverImage(preparedImages[0].canvas, innerX, innerY, imageAreaW, innerH);
            } else {
              drawRoundedImage(preparedImages[0].canvas, innerX, innerY, imageAreaW, innerH);
            }
            if (hasSidePanel) {
              const panelX = innerX + imageAreaW + gap;
              const panelH = hasDescription
                ? Math.min(innerH, 124)
                : mergeMusclePhotoIntoPrimary
                  ? innerH
                  : Math.min(innerH, 124);
              const panelY = hasDescription
                ? innerY
                : mergeMusclePhotoIntoPrimary
                  ? innerY
                  : innerY + Math.max(0, Math.round((innerH - panelH) / 2));
              doc.setFillColor(248, 250, 252);
              doc.roundedRect(panelX, panelY, descW, panelH, 10, 10, "F");
              doc.setDrawColor(226, 232, 240);
              doc.roundedRect(panelX, panelY, descW, panelH, 10, 10, "S");
              if (hasDescription) {
                doc.setFont(PDF_UNICODE_FONT_FAMILY, "bold");
                doc.setFontSize(11);
                doc.setTextColor(30, 41, 59);
                doc.text("Опис пози", panelX + 10, panelY + 16);
                doc.setFont(PDF_UNICODE_FONT_FAMILY, "normal");
                doc.setFontSize(9.2);
                doc.setTextColor(71, 85, 105);
                const maxW = descW - 20;
                const lines = doc.splitTextToSize(descriptionText, maxW) as string[];
                const maxLines = Math.max(2, Math.floor((panelH - 42) / 12));
                const drawLines = lines.slice(0, maxLines);
                if (lines.length > maxLines && drawLines.length > 0) {
                  let tail = drawLines[drawLines.length - 1];
                  while (tail.length > 1 && doc.getTextWidth(`${tail}…`) > maxW) {
                    tail = tail.slice(0, -1).trimEnd();
                  }
                  drawLines[drawLines.length - 1] = `${tail}…`;
                }
                doc.text(drawLines, panelX + 10, panelY + 31, { lineHeightFactor: 1.25 });
              } else if (mergeMusclePhotoIntoPrimary && preparedImages[1]) {
                drawRoundedCoverImage(preparedImages[1].canvas, panelX, panelY, descW, panelH);
              }
            }
          } else if (section === "secondary" && preparedImages[1]) {
            doc.setFont(PDF_UNICODE_FONT_FAMILY, "bold");
            doc.setFontSize(10.2);
            doc.setTextColor(59, 130, 246);
            doc.text(preparedImages[1].label, innerX, innerY + 12);
            drawRoundedImage(preparedImages[1].canvas, innerX, innerY + 20, innerW, innerH - 20);
          } else if (section === "muscles") {
            doc.setFont(PDF_UNICODE_FONT_FAMILY, "bold");
            doc.setFontSize(10.8);
            doc.setTextColor(15, 23, 42);
            doc.text("Активні м'язи", innerX, innerY + 12);
            const rows = muscles.slice(0, Math.max(3, Math.floor((innerH - 22) / 22)));
            const rowBaseY = innerY + 26;
            rows.forEach((muscle, rowIdx) => {
              const y = rowBaseY + rowIdx * 22;
              const level = Math.max(0, Math.min(100, muscle.activation_level || 0));
              const nameRaw = muscle.muscle_name || "М'яз";
              const name = nameRaw.length > 18 ? `${nameRaw.slice(0, 17)}…` : nameRaw;
              doc.setFont(PDF_UNICODE_FONT_FAMILY, "normal");
              doc.setFontSize(9.2);
              doc.setTextColor(51, 65, 85);
              doc.text(name, innerX, y + 9);
              const barX = innerX + 130;
              const barW = Math.max(80, innerW - 170);
              drawGradientBar(barX, y + 2, barW, 8, level);
              doc.setTextColor(71, 85, 105);
              doc.text(`${level}%`, barX + barW + 8, y + 9);
            });
          } else if (section === "description") {
            doc.setFont(PDF_UNICODE_FONT_FAMILY, "bold");
            doc.setFontSize(11);
            doc.setTextColor(30, 41, 59);
            doc.text("Опис пози", innerX, innerY + 14);
            doc.setFont(PDF_UNICODE_FONT_FAMILY, "normal");
            doc.setFontSize(10);
            doc.setTextColor(71, 85, 105);
            doc.text(doc.splitTextToSize(descriptionText, innerW) as string[], innerX, innerY + 32, {
              lineHeightFactor: 1.3,
            });
          } else {
            doc.setFont(PDF_UNICODE_FONT_FAMILY, "normal");
            doc.setFontSize(10);
            doc.setTextColor(100, 116, 139);
            doc.text("Обрано експорт без зображень та активних м'язів.", innerX, innerY + 18);
          }

          cursorY += sectionH + sectionGap;
        });
        onProgress?.(90);

        onProgress?.(98);
        doc.save(filename);
        onProgress?.(100);
        return true;
      } catch (err) {
        logger.warn("Fast client PDF export failed, falling back to backend:", err);
        return false;
      }
    },
    [],
  );

  const handleExportPdf = async (settings: PdfExportSettings) => {
    if (!pose) return;
    setIsExportingPdf(true);
    setPdfExportProgress(2);
    let backendProgressTimer: number | null = null;
    const pushProgress = (next: number) => {
      setPdfExportProgress((prev) => Math.max(prev, Math.min(100, Math.round(next))));
    };
    try {
      const safeName = pose.name.replace(/[^a-zA-Z0-9-_]/g, "_");
      const filename = `${pose.code}_${safeName}.pdf`;

      const includeStudioPhoto = settings.includeStudioPhoto && Boolean(pose.photo_path);
      const includeMusclePhoto = settings.includeMusclePhoto && Boolean(pose.muscle_layer_path);
      const includeActiveMuscles = settings.includeActiveMuscles && Boolean(pose.muscles?.length);

      const selectedImageCandidates: Array<{
        src: string;
        proxySrc: string;
        layerLabel: string;
      }> = [];
      if (includeStudioPhoto && studioImageSrc) {
        selectedImageCandidates.push({
          src: studioImageSrc,
          proxySrc: getImageProxyUrl(pose.id, "photo"),
          layerLabel: "Шар фото",
        });
      }
      if (includeMusclePhoto && muscleLayerImageSrc) {
        selectedImageCandidates.push({
          src: muscleLayerImageSrc,
          proxySrc: getImageProxyUrl(pose.id, "muscle_layer"),
          layerLabel: "Шар м'язів",
        });
      }

      const canUseFastClient =
        selectedImageCandidates.length > 0 ||
        includeActiveMuscles ||
        Boolean(decodeHtmlEntities(pose.description || "").trim());

      if (canUseFastClient) {
        pushProgress(6);
        const fastDone = await tryFastClientPdfExport(
          filename,
          {
            poseTitle: pose.name,
            categoryName: pose.category_name,
            poseDescription: decodeHtmlEntities(pose.description || ""),
            images: selectedImageCandidates.map((item) => ({
              label: item.layerLabel,
              urls: [item.src, item.proxySrc],
            })),
            includeActiveMuscles,
            muscles: pose.muscles,
          },
          pushProgress,
        );
        if (fastDone) {
          pushProgress(100);
          return;
        }
      }

      pushProgress(28);
      const includePhoto = includeStudioPhoto;
      const includeMuscleLayer = includeMusclePhoto;

      // Fast export profile for the Pose Detail button:
      // include only the currently relevant visualization and skip heavy extras.
      backendProgressTimer = window.setInterval(() => {
        setPdfExportProgress((prev) => (prev >= 93 ? prev : prev + 2));
      }, 260);
      const blob = await exportApi.posePdf(pose.id, {
        include_photo: includePhoto,
        include_schema: false,
        include_muscle_layer: includeMuscleLayer,
        include_muscles_list: includeActiveMuscles,
        include_description: true,
        page_size: "A4",
      }, {
        onProgress: (networkPercent) => {
          // Map transport progress into the latter half of the indicator.
          const mapped = 36 + (networkPercent * 0.6);
          pushProgress(mapped);
        },
      });
      pushProgress(98);
      downloadBlob(blob, filename);
      pushProgress(100);
    } catch (err) {
      logger.error("PDF export failed:", err);
    } finally {
      if (backendProgressTimer !== null) {
        window.clearInterval(backendProgressTimer);
      }
      setIsExportingPdf(false);
      window.setTimeout(() => setPdfExportProgress(0), 250);
    }
  };

  const handleConfirmPdfExport = () => {
    if (isExportingPdf) return;
    setShowPdfExportModal(false);
    void handleExportPdf(pdfExportSettings);
  };

  const selectedPdfOptionCount =
    Number(pdfExportSettings.includeStudioPhoto) +
    Number(pdfExportSettings.includeMusclePhoto) +
    Number(pdfExportSettings.includeActiveMuscles);

  const handleReanalyzeMuscles = async () => {
    if (!pose) return;
    setIsReanalyzingMuscles(true);
    clearMuscleWidgetTimers();
    setMuscleWidgetVisible(true);
    setMuscleWidgetExiting(false);
    setMuscleWidgetCollapsed(false);
    setMuscleWidgetStatus("processing");
    setMuscleWidgetProgress(8);
    setMuscleWidgetMessage(t("pose.muscles.analyzing"));
    setMuscleWidgetCount(0);
    muscleWidgetProgressTimerRef.current = window.setInterval(() => {
      setMuscleWidgetProgress((prev) => {
        if (prev >= 92) return prev;
        return Math.min(92, prev + (Math.floor(Math.random() * 6) + 2));
      });
    }, 260);
    try {
      const updatedPose = await posesApi.reanalyzeMuscles(pose.id);
      setPose(updatedPose);
      if (muscleWidgetProgressTimerRef.current !== null) {
        window.clearInterval(muscleWidgetProgressTimerRef.current);
        muscleWidgetProgressTimerRef.current = null;
      }
      const analyzedCount = updatedPose.muscles?.length ?? 0;
      setMuscleWidgetStatus("success");
      setMuscleWidgetProgress(100);
      setMuscleWidgetCount(analyzedCount);
      setMuscleWidgetMessage(
        t("pose.viewer.active_muscles_toast", { count: analyzedCount }),
      );
      muscleWidgetAutoDismissTimerRef.current = window.setTimeout(() => {
        closeMuscleWidget();
      }, 5200);
    } catch (err) {
      logger.error("Failed to reanalyze muscles:", err);
      if (muscleWidgetProgressTimerRef.current !== null) {
        window.clearInterval(muscleWidgetProgressTimerRef.current);
        muscleWidgetProgressTimerRef.current = null;
      }
      const message =
        err instanceof Error ? err.message : t("pose.muscles.reanalyze_error");
      setMuscleWidgetStatus("error");
      setMuscleWidgetProgress((prev) => Math.max(prev, 18));
      setMuscleWidgetMessage(message);
      muscleWidgetAutoDismissTimerRef.current = window.setTimeout(() => {
        closeMuscleWidget();
      }, 6200);
    } finally {
      setIsReanalyzingMuscles(false);
    }
  };

  if (isLoading) {
    return <PoseDetailSkeleton />;
  }

  if (error || !pose) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="text-center">
          <AlertCircle className="w-12 h-12 text-red-400 mx-auto mb-4" />
          <h2 className="text-xl font-medium text-foreground mb-2">
            {t("pose.detail.not_found")}
          </h2>
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
                <Button
                  variant="ghost"
                  size="icon"
                  className="text-muted-foreground"
                >
                  <ArrowLeft className="w-5 h-5" />
                </Button>
              </Link>
              <div>
                <h1 className="text-xl font-semibold text-foreground">
                  {pose.name}
                </h1>
                <div className="flex items-center gap-2 mt-1">
                  <Badge
                    className={
                      pose.photo_path
                        ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400"
                        : "bg-muted text-muted-foreground"
                    }
                  >
                    {pose.photo_path
                      ? t("pose.badge.complete")
                      : t("pose.badge.draft")}
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
                  <Button
                    onClick={() => setShowRegenerateModal(true)}
                    variant="outline"
                    data-testid="pose-regenerate"
                  >
                    <RefreshCw className="w-4 h-4 mr-2" />
                    {t("pose.detail.regenerate")}
                  </Button>
                </>
              ) : (
                <Button
                  onClick={() => setShowGenerateModal(true)}
                  className="bg-primary hover:bg-primary/90"
                  data-testid="pose-generate"
                >
                  <Sparkles className="w-4 h-4 mr-2" />
                  {t("pose.generate_cta")}
                </Button>
              )}
              <Button
                onClick={openPdfExportModal}
                variant="outline"
                disabled={isExportingPdf}
                data-testid="pose-export-pdf"
              >
                {isExportingPdf ? (
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                ) : (
                  <FileText className="w-4 h-4 mr-2" />
                )}
                {isExportingPdf
                  ? `${Math.max(1, Math.min(100, pdfExportProgress))}%`
                  : t("export.pdf")}
              </Button>
              <Button
                variant="ghost"
                size="icon"
                onClick={() => setShowDeleteConfirm(true)}
                className="text-red-500 hover:text-red-700 hover:bg-red-50"
                aria-label={t("pose.detail.delete")}
                data-testid="pose-delete-open"
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
                  <Tabs
                    value={activeTab}
                    onValueChange={(value) =>
                      setActiveTab(value as "photo" | "muscles")
                    }
                  >
                    <TabsList className="relative grid grid-cols-2 bg-muted p-1 h-12 overflow-hidden">
                      <span
                        aria-hidden="true"
                        className={`pointer-events-none absolute top-1 bottom-1 left-1 w-[calc(50%-0.25rem)] rounded-lg bg-background shadow-sm transition-transform duration-300 ease-out ${
                          activeTab === "muscles"
                            ? "translate-x-[calc(100%+0.25rem)]"
                            : "translate-x-0"
                        }`}
                      />
                      <TabsTrigger
                        value="photo"
                        className="group relative z-10 h-10 text-sm transition-[color,transform] duration-200 ease-out data-[state=active]:bg-transparent data-[state=active]:shadow-none data-[state=active]:scale-[1.01]"
                        data-testid="pose-tab-photo"
                      >
                        <Eye className="w-4 h-4 mr-1 transition-transform duration-200 group-data-[state=active]:scale-110" />
                        {t("pose.tabs.photo")}
                      </TabsTrigger>
                      <TabsTrigger
                        value="muscles"
                        disabled={!pose.muscle_layer_path}
                        className="group relative z-10 h-10 text-sm transition-[color,transform] duration-200 ease-out data-[state=active]:bg-transparent data-[state=active]:shadow-none data-[state=active]:scale-[1.01]"
                        data-testid="pose-tab-muscles"
                      >
                        <Activity className="w-4 h-4 mr-1 transition-transform duration-200 group-data-[state=active]:scale-110" />
                        {t("pose.tabs.muscles")}
                      </TabsTrigger>
                    </TabsList>
                  </Tabs>
                </div>
                <div className="p-4">
                  <div
                    key={activeTab}
                    className="aspect-square bg-muted/40 rounded-xl overflow-hidden"
                  >
                    <img
                      src={activeImageSrc || undefined}
                      alt={pose.name}
                      className="w-full h-full object-contain"
                      data-testid="pose-active-image"
                      onError={() => void refreshActiveImage(true)}
                    />
                  </div>
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
                <h3 className="text-lg font-medium text-foreground mb-2">
                  {t("pose.detail.no_image")}
                </h3>
                <p className="text-muted-foreground">
                  {t("pose.detail.no_image_hint")}
                </p>
              </div>
            )}

            {pose.schema_path && (
              <div className="bg-card rounded-2xl border border-border p-6">
                <h3 className="text-sm font-medium text-muted-foreground mb-4">
                  {t("pose.detail.source_schematic")}
                </h3>
                <div className="aspect-square bg-muted/40 rounded-xl border border-border overflow-hidden">
                  <img
                    src={schemaImageSrc || undefined}
                    alt={t("pose.file_alt")}
                    className="w-full h-full object-contain"
                    data-testid="pose-schema-image"
                    onError={() => void refreshSchemaImage(true)}
                  />
                </div>
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
                      data-testid="pose-reanalyze-muscles"
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
                  <p className="text-muted-foreground mb-4">
                    {t("pose.muscles.not_analyzed")}
                  </p>
                  <Button
                    onClick={handleReanalyzeMuscles}
                    disabled={isReanalyzingMuscles}
                    variant="outline"
                    data-testid="pose-analyze-muscles"
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
                <h3 className="text-lg font-medium text-foreground">
                  {t("pose.detail.details")}
                </h3>
                {!isEditing ? (
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => setIsEditing(true)}
                  >
                    <Edit2 className="w-4 h-4 mr-2" />
                    {t("pose.detail.edit")}
                  </Button>
                ) : (
                  <div className="flex gap-2">
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => setIsEditing(false)}
                      disabled={isSaving}
                    >
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
                  <Label className="text-muted-foreground">
                    {t("pose.detail.name")}
                  </Label>
                  {isEditing ? (
                    <Input
                      value={editData.name}
                      onChange={(e) =>
                        setEditData({ ...editData, name: e.target.value })
                      }
                    />
                  ) : (
                    <p className="text-foreground font-medium">{pose.name}</p>
                  )}
                </div>

                <div className="space-y-2">
                  <Label className="text-muted-foreground">
                    {t("pose.detail.name_en")}
                  </Label>
                  {isEditing ? (
                    <Input
                      value={editData.name_en}
                      onChange={(e) =>
                        setEditData({ ...editData, name_en: e.target.value })
                      }
                    />
                  ) : (
                    <p className="text-foreground">{pose.name_en || "-"}</p>
                  )}
                </div>

                <div className="space-y-2">
                  <Label className="text-muted-foreground">
                    {t("pose.detail.category")}
                  </Label>
                  {isEditing ? (
                    <Select
                      value={editData.category_id || "__none__"}
                      onValueChange={(value) =>
                        setEditData({
                          ...editData,
                          category_id: value === "__none__" ? "" : value,
                        })
                      }
                    >
                      <SelectTrigger>
                        <SelectValue
                          placeholder={t("upload.category_placeholder")}
                        />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="__none__">
                          {t("pose.uncategorized")}
                        </SelectItem>
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
                    <p className="text-foreground">
                      {pose.category_name || "-"}
                    </p>
                  )}
                </div>

                <div className="space-y-2">
                  <Label className="text-muted-foreground">
                    {t("pose.detail.description")}
                  </Label>
                  {isEditing ? (
                    <Textarea
                      value={editData.description}
                      onChange={(e) =>
                        setEditData({
                          ...editData,
                          description: e.target.value,
                        })
                      }
                      rows={3}
                    />
                  ) : (
                    <p className="text-foreground">
                      {decodeHtmlEntities(pose.description || "") ||
                        t("pose.detail.no_description")}
                    </p>
                  )}
                </div>

                {/* Change note - only shown when editing */}
                {isEditing && (
                  <div className="space-y-2 pt-4 border-t border-border">
                    <Label className="text-muted-foreground">
                      {t("versions.change_note_label")}
                    </Label>
                    <Input
                      value={editData.change_note}
                      onChange={(e) =>
                        setEditData({
                          ...editData,
                          change_note: e.target.value,
                        })
                      }
                      placeholder={t("versions.change_note_placeholder")}
                      maxLength={500}
                    />
                    <p className="text-xs text-muted-foreground">
                      {t("versions.change_note_hint")}
                    </p>
                  </div>
                )}
              </div>
            </div>

            {/* Version History */}
            <VersionHistory
              key={versionHistoryKey}
              poseId={pose.id}
              onViewVersion={(versionId) => setShowVersionDetail(versionId)}
              onRestoreVersion={(versionId, versionNumber) =>
                setShowRestoreModal({ versionId, versionNumber })
              }
              onCompareVersions={(v1, v2) => setShowVersionDiff({ v1, v2 })}
            />
          </div>
        </div>
      </main>

      {muscleWidgetVisible && (
        <aside
          className="fixed right-4 z-50 w-[min(92vw,380px)] flex flex-col"
          style={{
            bottom: hasGlobalGenerationWidget
              ? `${16 + floatingWidgetHeight + 8}px`
              : "16px",
          }}
        >
          <div
            className={`generation-widget-item ${
              muscleWidgetExiting ? "generation-widget-item--exit pointer-events-none" : ""
            }`}
          >
            <div
              className={`generation-widget-card rounded-2xl border shadow-lg p-3 ${
                muscleWidgetStatus === "error"
                  ? "border-red-300 bg-red-50/95"
                  : "border-red-200 bg-gradient-to-br from-red-50/90 to-orange-50/85"
              }`}
            >
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-semibold text-stone-900 truncate">
                    {pose.name}
                  </p>
                  <span className="mt-1 inline-flex max-w-full items-center rounded-full px-2 py-0.5 text-[11px] font-medium leading-none bg-red-100 text-red-800">
                    {t("pose.viewer.muscles")}
                  </span>
                  <div className="mt-1 h-4 flex items-center gap-2 text-xs text-stone-700">
                    <p
                      className={`truncate transition-opacity duration-150 ${
                        muscleWidgetCollapsed ? "opacity-100" : "opacity-0"
                      }`}
                      aria-hidden={!muscleWidgetCollapsed}
                    >
                      {muscleWidgetMessage}
                    </p>
                    {muscleWidgetStatus === "processing" ? (
                      <span
                        className={`ml-auto tabular-nums text-stone-600 transition-opacity duration-150 ${
                          muscleWidgetCollapsed ? "opacity-100" : "opacity-0"
                        }`}
                        aria-hidden={!muscleWidgetCollapsed}
                      >
                        {Math.min(muscleWidgetProgress, 100)}%
                      </span>
                    ) : null}
                  </div>
                </div>
                <div className="flex items-center gap-1">
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="h-7 w-7 p-0 text-stone-500 hover:text-stone-700"
                    onClick={() =>
                      setMuscleWidgetCollapsed((prevCollapsed) => !prevCollapsed)
                    }
                    aria-label={
                      muscleWidgetCollapsed
                        ? t("aria.expand_menu")
                        : t("aria.collapse_menu")
                    }
                    title={
                      muscleWidgetCollapsed
                        ? t("aria.expand_menu")
                        : t("aria.collapse_menu")
                    }
                  >
                    <ChevronDown
                      className={`h-4 w-4 transition-transform duration-200 ease-out ${
                        muscleWidgetCollapsed ? "-rotate-90" : "rotate-0"
                      }`}
                    />
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="h-7 w-7 p-0 text-stone-500 hover:text-stone-700"
                    onClick={closeMuscleWidget}
                    aria-label={t("generate.bg.dismiss")}
                  >
                    <X className="h-4 w-4" />
                  </Button>
                </div>
              </div>

              <div
                className={`overflow-hidden transition-[max-height,opacity,margin-top] duration-300 ease-out will-change-[max-height,opacity] ${
                  muscleWidgetCollapsed
                    ? "max-h-0 opacity-0 mt-0 pointer-events-none"
                    : "max-h-44 opacity-100 mt-2"
                }`}
                aria-hidden={muscleWidgetCollapsed}
              >
                <div className="generation-widget-body-inner">
                  <div
                    className={`flex items-center gap-2 text-xs ${
                      muscleWidgetStatus === "error"
                        ? "text-red-700"
                        : muscleWidgetStatus === "success"
                          ? "text-emerald-700"
                          : "text-red-700"
                    }`}
                  >
                    {muscleWidgetStatus === "processing" ? (
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    ) : muscleWidgetStatus === "error" ? (
                      <AlertCircle className="h-3.5 w-3.5" />
                    ) : (
                      <CheckCircle2 className="h-3.5 w-3.5" />
                    )}
                    <span className="generation-widget-status-text truncate">
                      {muscleWidgetMessage}
                    </span>
                    {muscleWidgetStatus === "processing" ? (
                      <span className="ml-auto text-stone-600 tabular-nums">
                        {Math.min(muscleWidgetProgress, 100)}%
                      </span>
                    ) : null}
                  </div>

                  <div
                    className={`mt-2 h-1.5 transition-opacity duration-200 ${
                      muscleWidgetStatus === "processing" ? "opacity-100" : "opacity-0"
                    }`}
                    aria-hidden={muscleWidgetStatus !== "processing"}
                  >
                    <div className="generation-widget-progress h-1.5 rounded-full overflow-hidden bg-red-200/80">
                      <div
                        className="generation-widget-progress-fill h-full rounded-full bg-gradient-to-r from-red-500 via-orange-500 to-red-600"
                        style={{ width: `${Math.min(muscleWidgetProgress, 100)}%` }}
                      />
                    </div>
                  </div>

                  <div className="mt-3 flex items-center gap-2">
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      className="h-8 text-xs shrink-0 whitespace-nowrap transition-none"
                      onClick={() => setShowViewer(true)}
                      disabled={!pose.photo_path}
                    >
                      <Eye className="w-3.5 h-3.5 mr-1" />
                      {t("generate.bg.open_pose")}
                    </Button>
                    {muscleWidgetStatus === "success" ? (
                      <span className="text-xs text-stone-600">
                        {t("pose.viewer.active_muscles")}: {muscleWidgetCount}
                      </span>
                    ) : null}
                  </div>
                </div>
              </div>
            </div>
          </div>
        </aside>
      )}

      <Dialog open={showPdfExportModal} onOpenChange={setShowPdfExportModal}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader className="space-y-2">
            <DialogTitle className="flex items-center gap-2">
              <FileText className="h-5 w-5 text-primary" />
              Створення PDF
            </DialogTitle>
            <DialogDescription>
              Налаштуй вміст файлу перед експортом.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-3">
            <button
              type="button"
              className={`w-full rounded-2xl border px-3.5 py-3 text-left transition-all duration-200 ${
                pdfExportSettings.includeStudioPhoto
                  ? "border-primary/40 bg-gradient-to-r from-primary/10 to-primary/5"
                  : "border-border/80 bg-background hover:border-border hover:bg-accent/30"
              } ${!canIncludeStudioPhoto ? "opacity-55 cursor-not-allowed" : ""}`}
              onClick={() => {
                if (!canIncludeStudioPhoto) return;
                setPdfExportSettings((prev) => ({
                  ...prev,
                  includeStudioPhoto: !prev.includeStudioPhoto,
                }));
              }}
              disabled={!canIncludeStudioPhoto}
            >
              <div className="flex items-center justify-between gap-4">
                <div className="flex items-center gap-3">
                  <span className="inline-flex h-9 w-9 items-center justify-center rounded-xl bg-primary/10 text-primary">
                    <ImageIcon className="h-4 w-4" />
                  </span>
                  <span>
                    <span className="block text-sm font-semibold text-foreground">Фото студії</span>
                    <span className="block text-xs text-muted-foreground">
                      {canIncludeStudioPhoto ? "Основне фото пози" : "Недоступно для цієї пози"}
                    </span>
                  </span>
                </div>
                <div
                  className={`relative h-7 w-12 rounded-full transition-colors ${
                    pdfExportSettings.includeStudioPhoto
                      ? "bg-primary"
                      : "bg-muted border border-border"
                  }`}
                >
                  <span
                    className={`absolute top-0.5 h-6 w-6 rounded-full bg-white shadow-sm transition-transform duration-200 ${
                      pdfExportSettings.includeStudioPhoto
                        ? "translate-x-[22px]"
                        : "translate-x-0.5"
                    }`}
                  />
                </div>
              </div>
            </button>

            <button
              type="button"
              className={`w-full rounded-2xl border px-3.5 py-3 text-left transition-all duration-200 ${
                pdfExportSettings.includeMusclePhoto
                  ? "border-primary/40 bg-gradient-to-r from-primary/10 to-primary/5"
                  : "border-border/80 bg-background hover:border-border hover:bg-accent/30"
              } ${!canIncludeMusclePhoto ? "opacity-55 cursor-not-allowed" : ""}`}
              onClick={() => {
                if (!canIncludeMusclePhoto) return;
                setPdfExportSettings((prev) => ({
                  ...prev,
                  includeMusclePhoto: !prev.includeMusclePhoto,
                }));
              }}
              disabled={!canIncludeMusclePhoto}
            >
              <div className="flex items-center justify-between gap-4">
                <div className="flex items-center gap-3">
                  <span className="inline-flex h-9 w-9 items-center justify-center rounded-xl bg-primary/10 text-primary">
                    <Layers className="h-4 w-4" />
                  </span>
                  <span>
                    <span className="block text-sm font-semibold text-foreground">Фото м&apos;язів</span>
                    <span className="block text-xs text-muted-foreground">
                      {canIncludeMusclePhoto ? "Анатомічний оверлей" : "Немає шару м&apos;язів"}
                    </span>
                  </span>
                </div>
                <div
                  className={`relative h-7 w-12 rounded-full transition-colors ${
                    pdfExportSettings.includeMusclePhoto
                      ? "bg-primary"
                      : "bg-muted border border-border"
                  }`}
                >
                  <span
                    className={`absolute top-0.5 h-6 w-6 rounded-full bg-white shadow-sm transition-transform duration-200 ${
                      pdfExportSettings.includeMusclePhoto
                        ? "translate-x-[22px]"
                        : "translate-x-0.5"
                    }`}
                  />
                </div>
              </div>
            </button>

            <button
              type="button"
              className={`w-full rounded-2xl border px-3.5 py-3 text-left transition-all duration-200 ${
                pdfExportSettings.includeActiveMuscles
                  ? "border-primary/40 bg-gradient-to-r from-primary/10 to-primary/5"
                  : "border-border/80 bg-background hover:border-border hover:bg-accent/30"
              } ${!canIncludeActiveMuscles ? "opacity-55 cursor-not-allowed" : ""}`}
              onClick={() => {
                if (!canIncludeActiveMuscles) return;
                setPdfExportSettings((prev) => ({
                  ...prev,
                  includeActiveMuscles: !prev.includeActiveMuscles,
                }));
              }}
              disabled={!canIncludeActiveMuscles}
            >
              <div className="flex items-center justify-between gap-4">
                <div className="flex items-center gap-3">
                  <span className="inline-flex h-9 w-9 items-center justify-center rounded-xl bg-primary/10 text-primary">
                    <Activity className="h-4 w-4" />
                  </span>
                  <span>
                    <span className="block text-sm font-semibold text-foreground">Активні м&apos;язи</span>
                    <span className="block text-xs text-muted-foreground">
                      {canIncludeActiveMuscles ? "Таблиця з рівнем активації" : "Дані ще не проаналізовані"}
                    </span>
                  </span>
                </div>
                <div
                  className={`relative h-7 w-12 rounded-full transition-colors ${
                    pdfExportSettings.includeActiveMuscles
                      ? "bg-primary"
                      : "bg-muted border border-border"
                  }`}
                >
                  <span
                    className={`absolute top-0.5 h-6 w-6 rounded-full bg-white shadow-sm transition-transform duration-200 ${
                      pdfExportSettings.includeActiveMuscles
                        ? "translate-x-[22px]"
                        : "translate-x-0.5"
                    }`}
                  />
                </div>
              </div>
            </button>
          </div>

          <DialogFooter className="gap-2 sm:gap-2 sm:items-center sm:justify-between">
            <span className="hidden sm:inline text-xs text-muted-foreground">
              Обрано: {selectedPdfOptionCount} / 3
            </span>
            <Button
              type="button"
              variant="outline"
              onClick={() => setShowPdfExportModal(false)}
              disabled={isExportingPdf}
            >
              Скасувати
            </Button>
            <Button
              type="button"
              onClick={handleConfirmPdfExport}
              disabled={isExportingPdf}
            >
              {isExportingPdf ? `${Math.max(1, Math.min(100, pdfExportProgress))}%` : "Створити PDF"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {showViewer && (
        <PoseViewer
          pose={pose}
          isOpen={showViewer}
          onClose={() => setShowViewer(false)}
        />
      )}

      <GenerateModal
        pose={pose}
        isOpen={showGenerateModal}
        onClose={() => setShowGenerateModal(false)}
        onComplete={async (poseFromApply) => {
          // Refresh pose data after generation
          if (id) {
            const isUsefulPose =
              poseFromApply &&
              (typeof (poseFromApply as any)?.photo_path === "string" ||
                typeof (poseFromApply as any)?.schema_path === "string" ||
                typeof (poseFromApply as any)?.version === "number");
            if (isUsefulPose) {
              setPose(poseFromApply);
            } else {
              const updatedPose = await fetchPoseWithRetry(parseInt(id, 10));
              setPose(updatedPose);
            }
            // Force version history to reload (generation creates a new version on apply-generation)
            setVersionHistoryKey((prev) => prev + 1);
          }
        }}
      />

      <RegenerateModal
        pose={pose}
        isOpen={showRegenerateModal}
        onClose={() => setShowRegenerateModal(false)}
        activeTab={activeTab}
        onComplete={async (poseFromApply) => {
          // Refresh pose data after regeneration
          if (id) {
            const isUsefulPose =
              poseFromApply &&
              (typeof (poseFromApply as any)?.photo_path === "string" ||
                typeof (poseFromApply as any)?.schema_path === "string" ||
                typeof (poseFromApply as any)?.version === "number");
            if (isUsefulPose) {
              setPose(poseFromApply);
            } else {
              const updatedPose = await fetchPoseWithRetry(parseInt(id, 10));
              setPose(updatedPose);
            }
            // Force version history to reload
            setVersionHistoryKey((prev) => prev + 1);
          }
        }}
      />

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
              const updatedPose = await fetchPoseWithRetry(parseInt(id, 10));
              setPose(updatedPose);
              setEditData({
                name: updatedPose.name,
                name_en: updatedPose.name_en || "",
                description: updatedPose.description || "",
                category_id: updatedPose.category_id
                  ? String(updatedPose.category_id)
                  : "",
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
        description={t("pose.detail.delete_confirm_message", {
          name: pose.name,
        })}
        confirmText={t("pose.detail.delete")}
        cancelText={t("pose.detail.cancel")}
        variant="danger"
        isLoading={isDeleting}
        testId="pose-delete-confirm"
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
