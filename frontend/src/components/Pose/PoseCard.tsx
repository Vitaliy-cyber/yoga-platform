import React, { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { Badge } from "../ui/badge";
import { Button } from "../ui/button";
import {
  Eye,
  Sparkles,
  CheckCircle2,
  ExternalLink,
  ImageIcon,
} from "lucide-react";
import type { PoseListItem } from "../../types";
import { useI18n } from "../../i18n";
import { CompareButton } from "./CompareButton";
import { usePoseImageSrc } from "../../hooks/usePoseImageSrc";

interface PoseCardProps {
  pose: PoseListItem;
  onView?: (pose: PoseListItem) => void;
  onGenerate?: (pose: PoseListItem) => void;
}

export const PoseCard: React.FC<PoseCardProps> = ({
  pose,
  onView,
  onGenerate,
}) => {
  const [imageError, setImageError] = useState(false);
  const [forceSchema, setForceSchema] = useState(false);
  const [renderedSrc, setRenderedSrc] = useState("");
  const [pendingSrc, setPendingSrc] = useState<string | null>(null);
  const retryingRef = useRef(false);
  const { t } = useI18n();

  const status = pose.photo_path ? "complete" : "draft";
  const statusLabel = t(
    status === "complete" ? "pose.status.complete" : "pose.status.draft",
  );
  const statusPillStyle =
    status === "complete"
      ? "bg-emerald-500/95 text-white shadow-lg shadow-emerald-900/25 ring-1 ring-white/30 dark:ring-white/20"
      : "bg-amber-500/95 text-white shadow-lg shadow-amber-900/25 ring-1 ring-white/30 dark:ring-white/20";
  const StatusIcon = status === "complete" ? CheckCircle2 : null;

  // Check for actual non-empty paths
  const hasGeneratedPhoto = Boolean(pose.photo_path && pose.photo_path.trim());
  const hasSchema = Boolean(pose.schema_path && pose.schema_path.trim());
  const showPhoto = hasGeneratedPhoto && !forceSchema;
  const showSchema = !showPhoto && hasSchema;
  const shouldLoadImage = showPhoto || showSchema;

  const imageType = showPhoto ? "photo" : "schema";
  const directPath = showPhoto ? pose.photo_path : pose.schema_path;
  const {
    src,
    loading,
    error: signedError,
    refresh,
  } = usePoseImageSrc(directPath, pose.id, imageType, {
    enabled: shouldLoadImage,
    version: pose.version,
  });

  useEffect(() => {
    setForceSchema(false);
    setImageError(false);
    setRenderedSrc("");
    setPendingSrc(null);
    retryingRef.current = false;
  }, [pose.id, pose.photo_path, pose.schema_path]);

  useEffect(() => {
    if (!signedError) return;
    if (showPhoto && hasSchema) {
      setForceSchema(true);
      setImageError(false);
    } else {
      setImageError(true);
    }
  }, [signedError, showPhoto, hasSchema]);

  useEffect(() => {
    if (!src) return;
    setImageError(false);
    if (!renderedSrc) {
      setRenderedSrc(src);
      return;
    }
    if (src !== renderedSrc) {
      setPendingSrc(src);
    }
  }, [renderedSrc, src]);

  const handleImageError = () => {
    if (!retryingRef.current) {
      retryingRef.current = true;
      void refresh(true).finally(() => {
        retryingRef.current = false;
      });
      return;
    }
    if (showPhoto && hasSchema) {
      setForceSchema(true);
      setImageError(false);
      return;
    }
    setImageError(true);
  };

  const handlePendingLoad: React.ReactEventHandler<HTMLImageElement> = (
    event,
  ) => {
    setRenderedSrc(event.currentTarget.currentSrc || event.currentTarget.src);
    setPendingSrc(null);
  };

  const handlePendingError = () => {
    setPendingSrc(null);
  };

  const activeSrc = renderedSrc || src;
  const showPlaceholder =
    imageError || !shouldLoadImage || (!activeSrc && !loading);

  return (
    <div
      className="group bg-card rounded-2xl border border-border/80 overflow-hidden hover:shadow-lg hover:border-border transition-shadow duration-200"
      data-testid={`pose-card-${pose.id}`}
    >
      <div className="aspect-[4/3] relative overflow-hidden bg-gradient-to-br from-muted to-muted/70 dark:from-muted/80 dark:to-muted/55">
        {/* Generated photo */}
        {showPhoto && !imageError && activeSrc && (
          <img
            src={activeSrc}
            alt=""
            aria-hidden="true"
            className="absolute inset-0 w-full h-full object-cover"
            onError={handleImageError}
          />
        )}

        {/* Schema image */}
        {showSchema && !imageError && activeSrc && (
          <img
            src={activeSrc}
            alt=""
            aria-hidden="true"
            className="absolute inset-0 w-full h-full object-contain p-4 bg-card/90 dark:bg-card/80"
            onError={handleImageError}
          />
        )}

        {pendingSrc && (
          <img
            src={pendingSrc}
            alt=""
            aria-hidden="true"
            className="hidden"
            onLoad={handlePendingLoad}
            onError={handlePendingError}
          />
        )}

        {/* Placeholder - show when no images or image failed to load */}
        {showPlaceholder && (
          <div className="absolute inset-0 flex items-center justify-center">
            <div className="text-center">
              <div className="w-14 h-14 rounded-xl bg-card/90 border border-border/70 shadow-sm flex items-center justify-center mx-auto mb-3">
                <ImageIcon className="w-6 h-6 text-muted-foreground/70" />
              </div>
              <p className="text-muted-foreground text-sm font-medium">
                {t("pose.no_image")}
              </p>
              <p className="text-muted-foreground/70 text-xs mt-0.5">
                {t("pose.hover_generate")}
              </p>
            </div>
          </div>
        )}

        <div className="absolute top-3 left-3">
          <Badge
            aria-label={statusLabel}
            className={`inline-flex h-6 items-center overflow-hidden rounded-full border-0 px-2 text-[11px] font-semibold tracking-[0.01em] backdrop-blur-sm ${statusPillStyle}`}
          >
            {StatusIcon ? (
              <StatusIcon className="h-3 w-3 flex-shrink-0 transition-[margin] duration-200 group-hover:mr-1" />
            ) : (
              <span className="h-1.5 w-1.5 flex-shrink-0 rounded-full bg-white/90 dark:bg-white/80 transition-[margin] duration-200 group-hover:mr-1" />
            )}
            <span
              aria-hidden="true"
              className="max-w-0 overflow-hidden whitespace-nowrap opacity-0 transition-[max-width,opacity] duration-200 ease-out group-hover:max-w-[6.5rem] group-hover:opacity-100"
            >
              {statusLabel}
            </span>
          </Badge>
        </div>

        {/* Compare button */}
        <CompareButton pose={pose} variant="card" />

        <div className="absolute inset-0 bg-gradient-to-t from-black/60 via-transparent to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-300">
          <div className="absolute bottom-4 left-4 right-4 flex gap-2">
            {hasGeneratedPhoto && onView && (
              <Button
                size="sm"
                variant="secondary"
                onClick={() => onView(pose)}
                data-testid={`pose-card-view-${pose.id}`}
                className="flex-1 bg-white/90 text-stone-900 backdrop-blur-sm hover:bg-white dark:bg-black/55 dark:text-white dark:hover:bg-black/70 dark:border dark:border-white/15"
              >
                <Eye className="w-4 h-4 mr-1" />
                {t("pose.view")}
              </Button>
            )}
            {!hasGeneratedPhoto && onGenerate && (
              <Button
                size="sm"
                onClick={() => onGenerate(pose)}
                data-testid={`pose-card-generate-${pose.id}`}
                className="flex-1 bg-stone-900 hover:bg-black text-white dark:bg-white dark:text-stone-900 dark:hover:bg-stone-200"
              >
                <Sparkles className="w-4 h-4 mr-1" />
                {hasSchema ? t("pose.generate") : t("pose.upload_generate")}
              </Button>
            )}
          </div>
        </div>
      </div>

      <div className="p-4">
        <div className="flex items-center justify-between">
          <h3 className="font-medium text-foreground text-lg truncate flex-1">
            {pose.name}
          </h3>
          <Link to={`/poses/${pose.id}`} state={{ preloadedPose: pose }}>
            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8 text-muted-foreground hover:text-foreground"
            >
              <ExternalLink className="w-4 h-4" />
            </Button>
          </Link>
        </div>

        <div className="flex flex-wrap gap-2 mt-2">
          {pose.category_name && (
            <Badge
              variant="outline"
              className="text-xs border-border text-muted-foreground"
            >
              {pose.category_name}
            </Badge>
          )}
        </div>
      </div>
    </div>
  );
};
