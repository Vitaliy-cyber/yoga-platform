import React, { useEffect, useState } from "react";
import { useParams, useNavigate, Link, useLocation } from "react-router-dom";
import {
  ArrowLeft,
  Activity,
  Edit3,
  Trash2,
  Play,
  Settings,
  Loader2,
  Save,
  X,
  GraduationCap,
  ImageIcon,
  Layers,
  Clock,
  FileDown,
  FileText,
} from "lucide-react";
import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
import { Badge } from "../components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "../components/ui/dialog";
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "../components/ui/tabs";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "../components/ui/select";
import { SequenceBuilder, SequencePlayer } from "../components/Sequence";
import { useSequenceStore } from "../store/useSequenceStore";
import { useAppStore } from "../store/useAppStore";
import { getAuthToken } from "../store/useAuthStore";
import { SequenceDetailSkeleton, Skeleton } from "../components/ui/skeleton";
import { useI18n } from "../i18n";
import {
  downloadBlob,
  getImageProxyUrl,
  getSignedImageUrl,
  posesApi,
} from "../services/api";
import type { DifficultyLevel, Pose, Sequence, SequenceListItem } from "../types";

const difficultyColors: Record<DifficultyLevel, string> = {
  beginner: "bg-emerald-100 text-emerald-700",
  intermediate: "bg-amber-100 text-amber-700",
  advanced: "bg-rose-100 text-rose-700",
};

const formatDuration = (seconds: number | null): string => {
  if (!seconds) return "--:--";
  const mins = Math.floor(seconds / 60);
  const secs = seconds % 60;
  return `${mins}:${secs.toString().padStart(2, "0")}`;
};

const PDF_UNICODE_FONT_FAMILY = "DejaVuSans";
const PDF_UNICODE_REGULAR_FILE = "DejaVuSans.ttf";
const PDF_UNICODE_BOLD_FILE = "DejaVuSans-Bold.ttf";

let sequencePdfFontBase64Cache:
  | {
      regular: string;
      bold: string;
    }
  | null = null;
let sequencePdfFontBase64Promise: Promise<{
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

const ensureSequencePdfUnicodeFontsLoaded = async (): Promise<{
  regular: string;
  bold: string;
}> => {
  if (sequencePdfFontBase64Cache) {
    return sequencePdfFontBase64Cache;
  }
  if (!sequencePdfFontBase64Promise) {
    sequencePdfFontBase64Promise = (async () => {
      const [regular, bold] = await Promise.all([
        fetchFontBase64(`/fonts/${PDF_UNICODE_REGULAR_FILE}`),
        fetchFontBase64(`/fonts/${PDF_UNICODE_BOLD_FILE}`),
      ]);
      sequencePdfFontBase64Cache = { regular, bold };
      return sequencePdfFontBase64Cache;
    })();
  }
  return sequencePdfFontBase64Promise;
};

const registerSequencePdfUnicodeFonts = async (doc: any): Promise<boolean> => {
  try {
    const fonts = await ensureSequencePdfUnicodeFontsLoaded();
    try {
      doc.addFileToVFS(PDF_UNICODE_REGULAR_FILE, fonts.regular);
    } catch {
      // Font already registered in VFS.
    }
    try {
      doc.addFileToVFS(PDF_UNICODE_BOLD_FILE, fonts.bold);
    } catch {
      // Font already registered in VFS.
    }
    try {
      doc.addFont(PDF_UNICODE_REGULAR_FILE, PDF_UNICODE_FONT_FAMILY, "normal");
    } catch {
      // Font already registered in jsPDF.
    }
    try {
      doc.addFont(PDF_UNICODE_BOLD_FILE, PDF_UNICODE_FONT_FAMILY, "bold");
    } catch {
      // Font already registered in jsPDF.
    }
    doc.setFont(PDF_UNICODE_FONT_FAMILY, "normal");
    return true;
  } catch {
    return false;
  }
};

const buildImageSourceCandidates = async (
  poseId: number,
  imageType: "photo" | "muscle_layer" | "schema",
  directPath?: string | null,
): Promise<string[]> => {
  const sources: string[] = [];
  if (directPath) {
    sources.push(directPath);
  }
  try {
    const signed = await getSignedImageUrl(poseId, imageType, {
      allowProxyFallback: false,
    });
    if (signed) sources.push(signed);
  } catch {
    // Signed URL is best-effort; we still fallback to proxy.
  }
  sources.push(getImageProxyUrl(poseId, imageType));
  return [...new Set(sources.filter(Boolean))];
};

const sanitizePdfFilenamePart = (value: string): string =>
  value
    .replace(/[<>:"/\\|?*\x00-\x1F]/g, "_")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 80) || "sequence";

type SequencePdfExportSettings = {
  includeStudioPhoto: boolean;
  includeMusclePhoto: boolean;
  includeActiveMuscles: boolean;
};

const generateSequencePdfBlob = async (
  sequence: Sequence,
  settings: SequencePdfExportSettings,
): Promise<Blob> => {
  const orderedSequencePoses = [...sequence.poses].sort(
    (a, b) => a.order_index - b.order_index,
  );
  if (!orderedSequencePoses.length) {
    throw new Error("У послідовності немає поз для експорту");
  }

  const detailedPoses = await Promise.all(
    orderedSequencePoses.map(async (sequencePose) => {
      try {
        const pose = await posesApi.getById(sequencePose.pose_id);
        return { sequencePose, pose };
      } catch {
        return { sequencePose, pose: null as Pose | null };
      }
    }),
  );

  const { jsPDF } = await import("jspdf");
  const doc = new jsPDF({
    orientation: "portrait",
    unit: "pt",
    format: "a4",
    compress: true,
  });
  const hasUnicodeFont = await registerSequencePdfUnicodeFonts(doc);
  if (!hasUnicodeFont) {
    throw new Error("Не вдалося підготувати PDF-шрифти");
  }

  const pageW = doc.internal.pageSize.getWidth();
  const pageH = doc.internal.pageSize.getHeight();
  const margin = 24;
  const authToken = getAuthToken();

  const loadImageCanvas = async (
    sources: string[],
  ): Promise<HTMLCanvasElement | null> => {
    const getAbsoluteUrl = (value: string) => {
      try {
        return new URL(value, window.location.origin).toString();
      } catch {
        return value;
      }
    };

    for (const source of sources) {
      try {
        const absoluteSource = getAbsoluteUrl(source);
        const isSameOrigin =
          absoluteSource.startsWith(window.location.origin) ||
          source.startsWith("/");
        const response = await fetch(absoluteSource, {
          credentials: isSameOrigin ? "include" : "omit",
          headers:
            isSameOrigin && authToken
              ? { Authorization: `Bearer ${authToken}` }
              : undefined,
        });
        if (!response.ok) continue;
        const blob = await response.blob();
        if (!blob.type.startsWith("image/")) continue;
        const bitmap = await createImageBitmap(blob);
        const canvas = document.createElement("canvas");
        canvas.width = bitmap.width;
        canvas.height = bitmap.height;
        const ctx = canvas.getContext("2d");
        if (!ctx) {
          bitmap.close();
          continue;
        }
        ctx.drawImage(bitmap, 0, 0);
        bitmap.close();
        return canvas;
      } catch {
        // Try next source candidate.
      }
    }
    return null;
  };

  const drawCard = (x: number, y: number, w: number, h: number) => {
    doc.setFillColor(255, 255, 255);
    doc.roundedRect(x, y, w, h, 14, 14, "F");
    doc.setDrawColor(226, 232, 240);
    doc.roundedRect(x, y, w, h, 14, 14, "S");
  };

  const drawRoundedCoverImage = (
    sourceCanvas: HTMLCanvasElement,
    x: number,
    y: number,
    areaW: number,
    areaH: number,
  ) => {
    const sourceW = Math.max(sourceCanvas.width, 1);
    const sourceH = Math.max(sourceCanvas.height, 1);
    const targetW = Math.max(1, Math.round(areaW));
    const targetH = Math.max(1, Math.round(areaH));
    const scale = Math.max(targetW / sourceW, targetH / sourceH);
    const cropW = Math.max(1, Math.round(targetW / scale));
    const cropH = Math.max(1, Math.round(targetH / scale));
    const sx = Math.max(0, Math.floor((sourceW - cropW) / 2));
    const sy = Math.max(0, Math.floor((sourceH - cropH) / 2));

    // Render to a denser offscreen canvas before embedding into PDF.
    // This preserves detail in PDF viewers and prevents visible pixelation.
    const densityScale = Math.min(
      2.5,
      Math.max(1, sourceW / targetW, sourceH / targetH),
    );
    const embedW = Math.max(1, Math.round(targetW * densityScale));
    const embedH = Math.max(1, Math.round(targetH * densityScale));
    const roundedCanvas = document.createElement("canvas");
    roundedCanvas.width = embedW;
    roundedCanvas.height = embedH;
    const roundedCtx = roundedCanvas.getContext("2d");
    if (!roundedCtx) return;
    roundedCtx.imageSmoothingEnabled = true;
    roundedCtx.imageSmoothingQuality = "high";
    const radius = Math.max(8, Math.round(Math.min(embedW, embedH) * 0.04));
    roundedCtx.beginPath();
    roundedCtx.moveTo(radius, 0);
    roundedCtx.lineTo(embedW - radius, 0);
    roundedCtx.quadraticCurveTo(embedW, 0, embedW, radius);
    roundedCtx.lineTo(embedW, embedH - radius);
    roundedCtx.quadraticCurveTo(embedW, embedH, embedW - radius, embedH);
    roundedCtx.lineTo(radius, embedH);
    roundedCtx.quadraticCurveTo(0, embedH, 0, embedH - radius);
    roundedCtx.lineTo(0, radius);
    roundedCtx.quadraticCurveTo(0, 0, radius, 0);
    roundedCtx.closePath();
    roundedCtx.clip();
    roundedCtx.drawImage(
      sourceCanvas,
      sx,
      sy,
      cropW,
      cropH,
      0,
      0,
      embedW,
      embedH,
    );
    doc.addImage(roundedCanvas.toDataURL("image/png"), "PNG", x, y, targetW, targetH);
  };

  const drawActivationBar = (
    x: number,
    y: number,
    width: number,
    height: number,
    level: number,
  ) => {
    const safe = Math.max(0, Math.min(100, level));
    doc.setFillColor(226, 232, 240);
    doc.roundedRect(x, y, width, height, height / 2, height / 2, "F");
    const fillWidth = Math.round((width * safe) / 100);
    if (fillWidth <= 0) return;
    const start = { r: 59, g: 130, b: 246 };
    const end = { r: 239, g: 68, b: 68 };
    const t = safe / 100;
    const r = Math.round(start.r + (end.r - start.r) * t);
    const g = Math.round(start.g + (end.g - start.g) * t);
    const b = Math.round(start.b + (end.b - start.b) * t);
    doc.setFillColor(r, g, b);
    doc.roundedRect(x, y, fillWidth, height, height / 2, height / 2, "F");
  };

  // Cover page
  doc.setFillColor(243, 244, 246);
  doc.rect(0, 0, pageW, pageH, "F");
  const coverCardX = margin;
  const coverCardY = margin;
  const coverCardW = pageW - margin * 2;
  const coverCardH = pageH - margin * 2;
  drawCard(coverCardX, coverCardY, coverCardW, coverCardH);

  const totalDuration = orderedSequencePoses.reduce(
    (acc, item) => acc + (item.duration_seconds || 0),
    0,
  );
  const exportedAt = new Date().toLocaleString("uk-UA");
  doc.setTextColor(31, 41, 55);
  doc.setFont(PDF_UNICODE_FONT_FAMILY, "bold");
  doc.setFontSize(27);
  doc.text(sequence.name || "Послідовність", coverCardX + 24, coverCardY + 48);
  const statsX = coverCardX + 24;
  const statsY = coverCardY + 62;
  const statsW = coverCardW - 48;
  const statsGap = 10;
  const statItems = [
    { label: "Поз", value: String(orderedSequencePoses.length) },
    { label: "Тривалість", value: formatDuration(totalDuration) },
    { label: "Експортовано", value: exportedAt },
  ];

  const measureStatHeight = (width: number, value: string): number => {
    const safeInnerW = Math.max(64, width - 24);
    doc.setFont(PDF_UNICODE_FONT_FAMILY, "bold");
    doc.setFontSize(14);
    const lines = doc.splitTextToSize(value, safeInnerW) as string[];
    const lineCount = Math.max(1, lines.length);
    return 16 + lineCount * 15 + 12;
  };

  const drawStatCard = (
    x: number,
    y: number,
    width: number,
    height: number,
    label: string,
    value: string,
  ) => {
    doc.setFillColor(248, 250, 252);
    doc.roundedRect(x, y, width, height, 10, 10, "F");
    doc.setDrawColor(226, 232, 240);
    doc.roundedRect(x, y, width, height, 10, 10, "S");
    doc.setFont(PDF_UNICODE_FONT_FAMILY, "normal");
    doc.setFontSize(9);
    doc.setTextColor(100, 116, 139);
    doc.text(label, x + 12, y + 16);
    doc.setFont(PDF_UNICODE_FONT_FAMILY, "bold");
    doc.setFontSize(14);
    doc.setTextColor(30, 41, 59);
    const lines = doc.splitTextToSize(value, Math.max(64, width - 24)) as string[];
    doc.text(lines, x + 12, y + 34, { lineHeightFactor: 1.1 });
  };

  let statsBottomY = statsY;
  const prefWidths = statItems.map((item) => {
    doc.setFont(PDF_UNICODE_FONT_FAMILY, "bold");
    doc.setFontSize(14);
    const valueW = doc.getTextWidth(item.value);
    doc.setFont(PDF_UNICODE_FONT_FAMILY, "normal");
    doc.setFontSize(9);
    const labelW = doc.getTextWidth(item.label);
    return Math.max(120, Math.ceil(Math.max(valueW, labelW) + 26));
  });
  const prefTotal = prefWidths.reduce((acc, w) => acc + w, 0) + statsGap * 2;

  if (prefTotal <= statsW) {
    const extra = statsW - prefTotal;
    const widths = [...prefWidths];
    widths[2] += extra;
    const rowH = Math.max(
      measureStatHeight(widths[0], statItems[0].value),
      measureStatHeight(widths[1], statItems[1].value),
      measureStatHeight(widths[2], statItems[2].value),
    );
    let x = statsX;
    statItems.forEach((item, idx) => {
      drawStatCard(x, statsY, widths[idx], rowH, item.label, item.value);
      x += widths[idx] + statsGap;
    });
    statsBottomY = statsY + rowH;
  } else {
    const topW = Math.floor((statsW - statsGap) / 2);
    const topH = Math.max(
      measureStatHeight(topW, statItems[0].value),
      measureStatHeight(topW, statItems[1].value),
    );
    drawStatCard(statsX, statsY, topW, topH, statItems[0].label, statItems[0].value);
    drawStatCard(
      statsX + topW + statsGap,
      statsY,
      topW,
      topH,
      statItems[1].label,
      statItems[1].value,
    );
    const secondRowY = statsY + topH + statsGap;
    const bottomH = measureStatHeight(statsW, statItems[2].value);
    drawStatCard(
      statsX,
      secondRowY,
      statsW,
      bottomH,
      statItems[2].label,
      statItems[2].value,
    );
    statsBottomY = secondRowY + bottomH;
  }

  const tableX = coverCardX + 24;
  const tableY = statsBottomY + 14;
  const tableW = coverCardW - 48;
  const headerH = 28;
  const rowH = 34;
  const colIndexW = 56;
  const colDurationW = 148;
  const colPoseW = tableW - colIndexW - colDurationW;
  const col1X = tableX;
  const col2X = col1X + colIndexW;
  const col3X = col2X + colPoseW;
  const col1CenterX = col1X + colIndexW / 2;
  const col3CenterX = col3X + colDurationW / 2;
  const headerTextY = tableY + headerH / 2 + 4;

  // Table header
  doc.setFillColor(226, 232, 240);
  doc.roundedRect(tableX, tableY, tableW, headerH, 8, 8, "F");
  doc.setDrawColor(226, 232, 240);
  doc.roundedRect(tableX, tableY, tableW, headerH, 8, 8, "S");
  doc.setDrawColor(203, 213, 225);
  doc.line(col2X, tableY + 4, col2X, tableY + headerH - 4);
  doc.line(col3X, tableY + 4, col3X, tableY + headerH - 4);
  doc.setFont(PDF_UNICODE_FONT_FAMILY, "bold");
  doc.setTextColor(30, 41, 59);
  doc.setFontSize(11);
  doc.text("#", col1CenterX, headerTextY, { align: "center" });
  doc.text("Поза", col2X + 10, headerTextY);
  doc.text("Тривалість", col3CenterX, headerTextY, { align: "center" });

  const rowsStartY = tableY + headerH;
  doc.setFont(PDF_UNICODE_FONT_FAMILY, "normal");
  doc.setFontSize(10.5);
  const previewRows = orderedSequencePoses.slice(0, 14);
  const tableTotalH = headerH + previewRows.length * rowH;
  doc.setDrawColor(226, 232, 240);
  doc.roundedRect(tableX, tableY, tableW, tableTotalH, 8, 8, "S");

  previewRows.forEach((sequencePose, idx) => {
    const rowTop = rowsStartY + idx * rowH;
    const rowTextY = rowTop + rowH / 2 + 4;
    const isEven = idx % 2 === 0;
    doc.setFillColor(isEven ? 248 : 255, isEven ? 250 : 255, isEven ? 252 : 255);
    doc.rect(tableX, rowTop, tableW, rowH, "F");
    doc.setDrawColor(226, 232, 240);
    doc.line(tableX, rowTop + rowH, tableX + tableW, rowTop + rowH);
    doc.setDrawColor(237, 242, 247);
    doc.line(col2X, rowTop + 3, col2X, rowTop + rowH - 3);
    doc.line(col3X, rowTop + 3, col3X, rowTop + rowH - 3);

    const poseTitle =
      detailedPoses[idx]?.pose?.name ||
      sequencePose.pose_name ||
      `Поза #${sequencePose.pose_id}`;
    doc.setTextColor(51, 65, 85);
    doc.text(String(idx + 1), col1CenterX, rowTextY, { align: "center" });
    const nameLines = doc.splitTextToSize(poseTitle, colPoseW - 20) as string[];
    doc.text(nameLines.slice(0, 1), col2X + 10, rowTextY);
    doc.text(`${sequencePose.duration_seconds || 0}s`, col3CenterX, rowTextY, {
      align: "center",
    });
  });

  // Pose pages in exact sequence order.
  for (let index = 0; index < detailedPoses.length; index += 1) {
    const { sequencePose, pose } = detailedPoses[index];
    doc.addPage();
    doc.setFillColor(243, 244, 246);
    doc.rect(0, 0, pageW, pageH, "F");

    const headerX = margin;
    const headerY = margin;
    const headerW = pageW - margin * 2;
    const headerH = 90;
    drawCard(headerX, headerY, headerW, headerH);
    const poseTitle = pose?.name || sequencePose.pose_name || `Поза #${sequencePose.pose_id}`;
    doc.setFont(PDF_UNICODE_FONT_FAMILY, "bold");
    doc.setTextColor(15, 23, 42);
    doc.setFontSize(20);
    doc.text(`${index + 1}. ${poseTitle}`, headerX + 18, headerY + 34);
    doc.setFont(PDF_UNICODE_FONT_FAMILY, "normal");
    doc.setFontSize(10.5);
    doc.setTextColor(100, 116, 139);
    const metaParts = [
      pose?.category_name ? `Категорія: ${pose.category_name}` : "",
      `Тривалість: ${sequencePose.duration_seconds || 0}s`,
    ].filter(Boolean);
    doc.text(metaParts.join(" | "), headerX + 18, headerY + 56);

    const bodyX = margin;
    const bodyY = headerY + headerH + 12;
    const bodyW = pageW - margin * 2;
    const innerW = bodyW - 24;
    const contentPadTop = 12;
    const contentPadBottom = 12;

    const includeStudioPhoto = settings.includeStudioPhoto;
    const includeMusclePhoto = settings.includeMusclePhoto;
    const includeActiveMuscles = settings.includeActiveMuscles;

    let studioCanvas: HTMLCanvasElement | null = null;
    let muscleCanvas: HTMLCanvasElement | null = null;
    if (pose) {
      if (includeStudioPhoto) {
        const studioSources = await buildImageSourceCandidates(
          pose.id,
          "photo",
          pose.photo_path,
        );
        studioCanvas = await loadImageCanvas(studioSources);
      }
      if (includeMusclePhoto) {
        const muscleSources = await buildImageSourceCandidates(
          pose.id,
          pose.muscle_layer_path ? "muscle_layer" : "schema",
          pose.muscle_layer_path || pose.schema_path,
        );
        muscleCanvas = await loadImageCanvas(muscleSources);
      }
    }

    const imagesH = 230;
    const descLines = pose?.description
      ? ((doc.splitTextToSize(pose.description, innerW - 20) as string[]).slice(0, 4))
      : [];
    const descH = descLines.length > 0 ? 24 + descLines.length * 12 + 12 : 0;
    const muscles = includeActiveMuscles
      ? (pose?.muscles || [])
          .slice()
          .sort((a, b) => (b.activation_level || 0) - (a.activation_level || 0))
          .slice(0, 8)
      : [];
    const musclesTableH = muscles.length > 0 ? 34 + muscles.length * 22 + 8 : 0;
    const hasContentAfterImage = descH > 0 || musclesTableH > 0;
    const imageBottomGap = hasContentAfterImage ? 14 : 0;

    const estimatedContentH =
      contentPadTop +
      imagesH +
      imageBottomGap +
      (descH > 0 ? descH + 12 : 0) +
      (musclesTableH > 0 ? musclesTableH : 0) +
      contentPadBottom;
    const maxBodyH = pageH - bodyY - margin;
    const bodyH = Math.min(maxBodyH, Math.max(170, estimatedContentH));
    drawCard(bodyX, bodyY, bodyW, bodyH);

    const innerX = bodyX + 12;
    let cursorY = bodyY + contentPadTop;

    const hasStudio = Boolean(studioCanvas);
    const hasMuscle = Boolean(muscleCanvas);
    if (hasStudio && hasMuscle) {
      const gap = 12;
      const colW = Math.floor((innerW - gap) / 2);
      if (studioCanvas) {
        drawRoundedCoverImage(studioCanvas, innerX, cursorY, colW, imagesH);
      }
      if (muscleCanvas) {
        drawRoundedCoverImage(
          muscleCanvas,
          innerX + colW + gap,
          cursorY,
          colW,
          imagesH,
        );
      }
      cursorY += imagesH + imageBottomGap;
    } else if (hasStudio || hasMuscle) {
      const onlyCanvas = studioCanvas || muscleCanvas;
      if (onlyCanvas) {
        drawRoundedCoverImage(onlyCanvas, innerX, cursorY, innerW, imagesH);
      }
      cursorY += imagesH + imageBottomGap;
    } else {
      doc.setFillColor(248, 250, 252);
      doc.roundedRect(innerX, cursorY, innerW, imagesH, 10, 10, "F");
      doc.setDrawColor(226, 232, 240);
      doc.roundedRect(innerX, cursorY, innerW, imagesH, 10, 10, "S");
      doc.setFont(PDF_UNICODE_FONT_FAMILY, "bold");
      doc.setFontSize(14);
      doc.setTextColor(148, 163, 184);
      doc.text("No Image", innerX + innerW / 2, cursorY + imagesH / 2 + 5, {
        align: "center",
      });
      cursorY += imagesH + imageBottomGap;
    }

    if (descH > 0) {
      doc.setFillColor(248, 250, 252);
      doc.roundedRect(innerX, cursorY, innerW, descH, 10, 10, "F");
      doc.setDrawColor(226, 232, 240);
      doc.roundedRect(innerX, cursorY, innerW, descH, 10, 10, "S");
      doc.setFont(PDF_UNICODE_FONT_FAMILY, "bold");
      doc.setFontSize(11);
      doc.setTextColor(30, 41, 59);
      doc.text("Опис пози", innerX + 10, cursorY + 16);
      doc.setFont(PDF_UNICODE_FONT_FAMILY, "normal");
      doc.setFontSize(9.5);
      doc.setTextColor(71, 85, 105);
      doc.text(descLines, innerX + 10, cursorY + 30, { lineHeightFactor: 1.25 });
      cursorY += descH + 12;
    }

    if (musclesTableH > 0) {
      const tableY = cursorY;
      doc.setFillColor(248, 250, 252);
      doc.roundedRect(innerX, tableY, innerW, musclesTableH, 10, 10, "F");
      doc.setDrawColor(226, 232, 240);
      doc.roundedRect(innerX, tableY, innerW, musclesTableH, 10, 10, "S");

      doc.setFont(PDF_UNICODE_FONT_FAMILY, "bold");
      doc.setFontSize(11);
      doc.setTextColor(30, 41, 59);
      doc.text("Активні м'язи", innerX + 10, tableY + 18);

      let rowY = tableY + 36;
      doc.setFont(PDF_UNICODE_FONT_FAMILY, "normal");
      doc.setFontSize(9);
      muscles.forEach((muscle) => {
        const label = muscle.muscle_name_ua || muscle.muscle_name || "М'яз";
        const safeLevel = Math.max(0, Math.min(100, muscle.activation_level || 0));
        const labelMaxW = 150;
        const labelText = (doc.splitTextToSize(label, labelMaxW) as string[])[0] || label;
        doc.setTextColor(51, 65, 85);
        doc.text(labelText, innerX + 10, rowY);
        drawActivationBar(innerX + 170, rowY - 8, innerW - 240, 10, safeLevel);
        doc.setTextColor(71, 85, 105);
        doc.text(`${safeLevel}%`, innerX + innerW - 16, rowY, { align: "right" });
        rowY += 22;
      });
    }
  }

  return doc.output("blob");
};

export const SequenceDetail: React.FC = () => {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const location = useLocation();
  const { t } = useI18n();
  const sequenceId = Number(id);
  const hasValidSequenceId = Number.isInteger(sequenceId) && sequenceId > 0;
  const previewSequence = (
    location.state as { sequencePreview?: SequenceListItem } | null
  )?.sequencePreview;

  const {
    currentSequence,
    isLoadingSequence,
    isSaving,
    error,
    fetchSequence,
    updateSequence,
    deleteSequence,
    clearError,
  } = useSequenceStore();
  const addToast = useAppStore((state) => state.addToast);

  const [isEditing, setIsEditing] = useState(false);
  const [editName, setEditName] = useState("");
  const [editDescription, setEditDescription] = useState("");
  const [editDifficulty, setEditDifficulty] =
    useState<DifficultyLevel>("beginner");
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [activeTab, setActiveTab] = useState<"player" | "builder">("builder");
  const [isExportingPdf, setIsExportingPdf] = useState(false);
  const [pdfExportProgress, setPdfExportProgress] = useState(0);
  const [showPdfExportModal, setShowPdfExportModal] = useState(false);
  const [pdfExportSettings, setPdfExportSettings] =
    useState<SequencePdfExportSettings>({
      includeStudioPhoto: true,
      includeMusclePhoto: true,
      includeActiveMuscles: true,
    });
  const [isInitialLoadPending, setIsInitialLoadPending] = useState(() =>
    hasValidSequenceId && currentSequence?.id !== sequenceId,
  );

  useEffect(() => {
    let cancelled = false;
    if (!hasValidSequenceId) {
      setIsInitialLoadPending(false);
      return () => {
        clearError();
      };
    }
    const hasCachedCurrent = currentSequence?.id === sequenceId;
    setIsInitialLoadPending(!hasCachedCurrent);
    void fetchSequence(sequenceId).finally(() => {
      if (!cancelled) {
        setIsInitialLoadPending(false);
      }
    });
    return () => {
      cancelled = true;
      clearError();
    };
  }, [clearError, fetchSequence, hasValidSequenceId, sequenceId]);

  useEffect(() => {
    if (currentSequence) {
      setEditName(currentSequence.name);
      setEditDescription(currentSequence.description || "");
      setEditDifficulty(currentSequence.difficulty);
    }
  }, [currentSequence]);

  const handleSaveEdit = async () => {
    if (!currentSequence || !editName.trim()) return;

    await updateSequence(currentSequence.id, {
      name: editName.trim(),
      description: editDescription.trim() || undefined,
      difficulty: editDifficulty,
    });
    setIsEditing(false);
  };

  const handleCancelEdit = () => {
    if (currentSequence) {
      setEditName(currentSequence.name);
      setEditDescription(currentSequence.description || "");
      setEditDifficulty(currentSequence.difficulty);
    }
    setIsEditing(false);
  };

  const handleDelete = async () => {
    if (!currentSequence) return;
    try {
      await deleteSequence(currentSequence.id);
      navigate("/sequences");
    } catch (err) {
      // Error is handled by the store and displayed via the error banner
      console.error("Failed to delete sequence:", err);
    }
  };

  const handleExportSequencePdf = async (
    settings: SequencePdfExportSettings = pdfExportSettings,
  ) => {
    if (!currentSequenceMatches || !currentSequence) return;
    setIsExportingPdf(true);
    setPdfExportProgress(6);
    try {
      const blob = await generateSequencePdfBlob(currentSequence, settings);
      setPdfExportProgress(90);
      const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
      const safeName = sanitizePdfFilenamePart(currentSequence.name);
      downloadBlob(blob, `sequence_${safeName}_${timestamp}.pdf`);
      setPdfExportProgress(100);
      addToast({
        type: "success",
        message: "PDF послідовності успішно експортовано",
      });
    } catch (err) {
      addToast({
        type: "error",
        message:
          err instanceof Error
            ? err.message
            : "Не вдалося експортувати послідовність у PDF",
      });
    } finally {
      setIsExportingPdf(false);
      window.setTimeout(() => setPdfExportProgress(0), 250);
    }
  };

  const openSequencePdfExportModal = () => {
    if (!currentSequenceMatches || !currentSequence) return;
    setShowPdfExportModal(true);
  };

  const handleConfirmSequencePdfExport = () => {
    if (isExportingPdf) return;
    setShowPdfExportModal(false);
    void handleExportSequencePdf(pdfExportSettings);
  };

  const selectedPdfOptionCount =
    Number(pdfExportSettings.includeStudioPhoto) +
    Number(pdfExportSettings.includeMusclePhoto) +
    Number(pdfExportSettings.includeActiveMuscles);

  const currentSequenceMatches = Boolean(
    currentSequence && currentSequence.id === sequenceId,
  );
  const fallbackSequence =
    !currentSequenceMatches && previewSequence?.id === sequenceId
      ? previewSequence
      : null;

  const shouldBlockRender =
    (isInitialLoadPending || isLoadingSequence) &&
    !currentSequenceMatches &&
    !fallbackSequence;

  if (shouldBlockRender) {
    return <SequenceDetailSkeleton />;
  }

  if (!hasValidSequenceId || (!currentSequenceMatches && !fallbackSequence)) {
    return (
      <div className="min-h-screen bg-background flex flex-col items-center justify-center">
        <Layers className="w-16 h-16 text-muted-foreground/50 mb-4" />
        <h2 className="text-xl font-semibold text-foreground mb-2">
          {t("sequences.not_found")}
        </h2>
        <Link to="/sequences">
          <Button variant="outline">{t("sequences.back_to_list")}</Button>
        </Link>
      </div>
    );
  }

  const displayName = currentSequenceMatches
    ? currentSequence!.name
    : fallbackSequence!.name;
  const displayDescription = currentSequenceMatches
    ? currentSequence!.description
    : fallbackSequence!.description;
  const displayDifficulty: DifficultyLevel = currentSequenceMatches
    ? currentSequence!.difficulty
    : fallbackSequence!.difficulty;
  const displayPoseCount = currentSequenceMatches
    ? currentSequence!.poses.length
    : fallbackSequence!.pose_count;
  const displayDuration = currentSequenceMatches
    ? currentSequence!.poses.reduce((acc, p) => acc + p.duration_seconds, 0)
    : fallbackSequence!.duration_seconds;

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <header className="bg-card border-b border-border sticky top-0 z-40">
        <div className="max-w-6xl mx-auto px-6 py-4">
          <Link
            to="/sequences"
            className="inline-flex items-center gap-2 text-muted-foreground hover:text-foreground mb-4 transition-colors"
          >
            <ArrowLeft className="w-4 h-4" />
            {t("sequences.back_to_list")}
          </Link>

          <div className="flex items-start justify-between gap-4">
            <div className="flex-1">
              {isEditing ? (
                <div className="space-y-4 animate-sequence-header-edit-in">
                  <Input
                    value={editName}
                    onChange={(e) => setEditName(e.target.value)}
                    className="text-2xl font-semibold h-auto py-1 transition-[border-color,box-shadow,background-color,color] duration-200 ease-out"
                    placeholder={t("sequences.name")}
                    data-testid="sequence-edit-name"
                  />
                  <textarea
                    value={editDescription}
                    onChange={(e) => setEditDescription(e.target.value)}
                    className="w-full h-20 px-3 py-2 rounded-lg border border-input bg-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/20 focus-visible:border-primary resize-none text-sm transition-[border-color,box-shadow,background-color,color] duration-200 ease-out"
                    placeholder={t("sequences.description_placeholder")}
                  />
                  <Select
                    value={editDifficulty}
                    onValueChange={(v) =>
                      setEditDifficulty(v as DifficultyLevel)
                    }
                  >
                    <SelectTrigger className="w-48 transition-[border-color,box-shadow,background-color,color] duration-200 ease-out">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="beginner">
                        {t("sequences.difficulty.beginner")}
                      </SelectItem>
                      <SelectItem value="intermediate">
                        {t("sequences.difficulty.intermediate")}
                      </SelectItem>
                      <SelectItem value="advanced">
                        {t("sequences.difficulty.advanced")}
                      </SelectItem>
                    </SelectContent>
                  </Select>
                  <div className="flex gap-2 animate-sequence-header-actions-in">
                    <Button
                      onClick={handleSaveEdit}
                      disabled={isSaving || !editName.trim()}
                      data-testid="sequence-save"
                    >
                      <Save className="w-4 h-4 mr-2" />
                      {t("app.save")}
                    </Button>
                    <Button variant="outline" onClick={handleCancelEdit}>
                      <X className="w-4 h-4 mr-2" />
                      {t("app.cancel")}
                    </Button>
                  </div>
                </div>
              ) : (
                <div className="animate-sequence-header-view-in">
                  <div className="flex items-center gap-3 mb-2">
                    <h1 className="text-2xl font-semibold text-foreground">
                      {displayName}
                    </h1>
                    <Badge
                      className={`${difficultyColors[displayDifficulty]} border-0`}
                    >
                      <GraduationCap className="w-3 h-3 mr-1" />
                      {t(`sequences.difficulty.${displayDifficulty}`)}
                    </Badge>
                  </div>
                  {displayDescription && (
                    <p className="text-muted-foreground text-sm mb-3">
                      {displayDescription}
                    </p>
                  )}
                  <div className="flex items-center gap-4 text-sm text-muted-foreground">
                    <div className="flex items-center gap-1.5">
                      <Layers className="w-4 h-4" />
                      <span>
                        {displayPoseCount} {t("sequences.poses")}
                      </span>
                    </div>
                    <div className="flex items-center gap-1.5">
                      <Clock className="w-4 h-4" />
                      <span>{formatDuration(displayDuration)}</span>
                    </div>
                  </div>
                </div>
              )}
            </div>

            {!isEditing && currentSequenceMatches && (
              <div className="flex items-center gap-2 animate-sequence-header-actions-in">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setActiveTab("player")}
                  className="hidden sm:flex"
                >
                  <Play className="w-4 h-4 mr-2" />
                  {t("sequences.play")}
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={openSequencePdfExportModal}
                  disabled={isExportingPdf}
                  data-testid="export-pdf"
                >
                  {isExportingPdf ? (
                    <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                  ) : (
                    <FileDown className="w-4 h-4 mr-2" />
                  )}
                  {isExportingPdf
                    ? `${Math.max(1, Math.min(100, pdfExportProgress))}%`
                    : "PDF"}
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setIsEditing(true)}
                  data-testid="sequence-edit"
                >
                  <Edit3 className="w-4 h-4 mr-2" />
                  {t("app.edit")}
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setShowDeleteConfirm(true)}
                  className="text-rose-500 hover:text-rose-600 hover:bg-rose-50"
                  data-testid="sequence-delete"
                >
                  <Trash2 className="w-4 h-4" />
                </Button>
              </div>
            )}
          </div>
        </div>
      </header>

      {/* Error banner */}
      {error && (
        <div className="max-w-6xl mx-auto px-6 mt-4">
          <div className="p-4 bg-rose-50 dark:bg-rose-900/30 border border-rose-200 dark:border-rose-800 rounded-lg text-rose-600 dark:text-rose-400 text-sm flex items-center justify-between">
            <span>{error}</span>
            <button
              onClick={clearError}
              className="text-rose-400 hover:text-rose-600 dark:hover:text-rose-300 transition-colors duration-150"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>
      )}

      {/* Content */}
      <main className="max-w-6xl mx-auto px-6 py-8">
        {currentSequenceMatches ? (
          <Tabs
            value={activeTab}
            onValueChange={(v) => setActiveTab(v as "player" | "builder")}
          >
            <TabsList className="relative mb-6 grid h-11 min-w-[220px] grid-cols-2 items-center rounded-xl border border-border/70 bg-muted/70 p-1">
              <span
                aria-hidden="true"
                className={`pointer-events-none absolute top-1 bottom-1 left-1 w-[calc(50%-0.25rem)] rounded-lg bg-background shadow-sm transition-transform duration-300 ease-out ${
                  activeTab === "player"
                    ? "translate-x-[calc(100%+0.25rem)]"
                    : "translate-x-0"
                }`}
              />
              <TabsTrigger
                value="builder"
                className="group relative z-10 h-9 gap-2 data-[state=active]:bg-transparent data-[state=active]:shadow-none"
              >
                <Settings className="w-4 h-4" />
                {t("sequences.builder")}
              </TabsTrigger>
              <TabsTrigger
                value="player"
                className="group relative z-10 h-9 gap-2 data-[state=active]:bg-transparent data-[state=active]:shadow-none"
              >
                <Play className="w-4 h-4" />
                {t("sequences.player")}
              </TabsTrigger>
            </TabsList>

            <TabsContent
              value="builder"
              forceMount={activeTab === "builder" ? true : undefined}
            >
              <div key="builder" className="animate-fade-in">
                <SequenceBuilder sequence={currentSequence!} />
              </div>
            </TabsContent>

            <TabsContent
              value="player"
              forceMount={activeTab === "player" ? true : undefined}
            >
              <div key="player" className="animate-fade-in">
                <SequencePlayer sequence={currentSequence!} />
              </div>
            </TabsContent>
          </Tabs>
        ) : (
          <div className="space-y-4">
            <div className="flex items-center gap-2 mb-2">
              <Skeleton className="h-9 w-28 rounded-lg" />
              <Skeleton className="h-9 w-24 rounded-lg" />
            </div>
            <Skeleton className="h-12 w-full rounded-xl" />
            <Skeleton className="h-12 w-full rounded-xl" />
            <Skeleton className="h-12 w-full rounded-xl" />
          </div>
        )}
      </main>

      <Dialog open={showPdfExportModal} onOpenChange={setShowPdfExportModal}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader className="space-y-2">
            <DialogTitle className="flex items-center gap-2">
              <FileText className="h-5 w-5 text-primary" />
              Створення PDF
            </DialogTitle>
            <DialogDescription>
              Вибери, що включити до PDF файлу послідовності.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-3">
            <button
              type="button"
              className={`w-full rounded-2xl border px-3.5 py-3 text-left transition-all duration-200 ${
                pdfExportSettings.includeStudioPhoto
                  ? "border-primary/40 bg-gradient-to-r from-primary/10 to-primary/5"
                  : "border-border/80 bg-background hover:border-border hover:bg-accent/30"
              }`}
              onClick={() =>
                setPdfExportSettings((prev) => ({
                  ...prev,
                  includeStudioPhoto: !prev.includeStudioPhoto,
                }))
              }
            >
              <div className="flex items-center justify-between gap-4">
                <div className="flex items-center gap-3">
                  <span className="inline-flex h-9 w-9 items-center justify-center rounded-xl bg-primary/10 text-primary">
                    <ImageIcon className="h-4 w-4" />
                  </span>
                  <span>
                    <span className="block text-sm font-semibold text-foreground">
                      Фото студії
                    </span>
                    <span className="block text-xs text-muted-foreground">
                      Основні фото поз у порядку послідовності
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
              }`}
              onClick={() =>
                setPdfExportSettings((prev) => ({
                  ...prev,
                  includeMusclePhoto: !prev.includeMusclePhoto,
                }))
              }
            >
              <div className="flex items-center justify-between gap-4">
                <div className="flex items-center gap-3">
                  <span className="inline-flex h-9 w-9 items-center justify-center rounded-xl bg-primary/10 text-primary">
                    <Layers className="h-4 w-4" />
                  </span>
                  <span>
                    <span className="block text-sm font-semibold text-foreground">
                      Фото м&apos;язів
                    </span>
                    <span className="block text-xs text-muted-foreground">
                      Анатомічний шар для кожної пози
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
              }`}
              onClick={() =>
                setPdfExportSettings((prev) => ({
                  ...prev,
                  includeActiveMuscles: !prev.includeActiveMuscles,
                }))
              }
            >
              <div className="flex items-center justify-between gap-4">
                <div className="flex items-center gap-3">
                  <span className="inline-flex h-9 w-9 items-center justify-center rounded-xl bg-primary/10 text-primary">
                    <Activity className="h-4 w-4" />
                  </span>
                  <span>
                    <span className="block text-sm font-semibold text-foreground">
                      Активні м&apos;язи
                    </span>
                    <span className="block text-xs text-muted-foreground">
                      Таблиця активації м&apos;язів по кожній позі
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
              onClick={handleConfirmSequencePdfExport}
              disabled={isExportingPdf || selectedPdfOptionCount === 0}
            >
              {isExportingPdf
                ? `${Math.max(1, Math.min(100, pdfExportProgress))}%`
                : "Створити PDF"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete confirmation dialog */}
      {showDeleteConfirm && (
        <div
          className="fixed inset-0 bg-black/50 flex items-center justify-center z-50"
          data-testid="sequence-delete-dialog"
        >
          <div className="bg-card rounded-2xl shadow-xl max-w-md w-full mx-4 p-6">
            <h3 className="text-lg font-semibold text-foreground mb-2">
              {t("sequences.delete_confirm_title")}
            </h3>
            <p className="text-muted-foreground mb-6">
              {t("sequences.delete_confirm_message", {
                name: currentSequence?.name ?? displayName,
              })}
            </p>
            <div className="flex justify-end gap-3">
              <Button
                variant="outline"
                onClick={() => setShowDeleteConfirm(false)}
              >
                {t("app.cancel")}
              </Button>
              <Button
                variant="destructive"
                onClick={handleDelete}
                disabled={isSaving}
                className="bg-rose-500 hover:bg-rose-600"
                data-testid="sequence-delete-confirm"
              >
                {isSaving ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : (
                  <>
                    <Trash2 className="w-4 h-4 mr-2" />
                    {t("app.delete")}
                  </>
                )}
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
