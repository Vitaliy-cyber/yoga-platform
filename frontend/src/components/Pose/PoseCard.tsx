import React, { useState, useMemo, useCallback } from "react";
import { Link } from "react-router-dom";
import { Badge } from "../ui/badge";
import { Button } from "../ui/button";
import { Eye, Sparkles, CheckCircle2, ExternalLink, ImageIcon } from "lucide-react";
import type { PoseListItem } from "../../types";
import { getImageUrl } from "../../services/api";
import { useI18n } from "../../i18n";
import { CompareButton } from "./CompareButton";

interface PoseCardProps {
  pose: PoseListItem;
  onView?: (pose: PoseListItem) => void;
  onGenerate?: (pose: PoseListItem) => void;
}

export const PoseCard: React.FC<PoseCardProps> = ({ pose, onView, onGenerate }) => {
  const [imageError, setImageError] = useState(false);
  const { t } = useI18n();

  // Memoize computed values to prevent recalculation on every render
  const { statusLabel, statusColor, StatusIcon, hasGeneratedPhoto, hasSchema } = useMemo(() => {
    const isComplete = Boolean(pose.photo_path);
    const hasGeneratedPhoto = Boolean(pose.photo_path && pose.photo_path.trim());
    const hasSchema = Boolean(pose.schema_path && pose.schema_path.trim());

    return {
      statusLabel: t(isComplete ? "pose.status.complete" : "pose.status.draft"),
      statusColor: isComplete ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-400" : "bg-muted text-muted-foreground",
      StatusIcon: isComplete ? CheckCircle2 : null,
      hasGeneratedPhoto,
      hasSchema,
    };
  }, [pose.photo_path, pose.schema_path, t]);

  const showPlaceholder = imageError || (!hasGeneratedPhoto && !hasSchema);

  // Memoize event handlers to prevent unnecessary re-renders of child components
  const handleImageError = useCallback(() => setImageError(true), []);
  const handleView = useCallback(() => onView?.(pose), [onView, pose]);
  const handleGenerate = useCallback(() => onGenerate?.(pose), [onGenerate, pose]);

  return (
    <div className="group bg-card rounded-2xl border overflow-hidden hover:shadow-lg hover:border-border/80 transition-shadow duration-200 touch-manipulation">
      <div className="aspect-[4/3] relative overflow-hidden bg-gradient-to-br from-muted to-muted/80">
        {/* Generated photo */}
        {hasGeneratedPhoto && !imageError && (
          <img
            src={getImageUrl(pose.photo_path, pose.id, 'photo')}
            alt={pose.name}
            className="absolute inset-0 w-full h-full object-cover"
            onError={handleImageError}
          />
        )}

        {/* Schema image */}
        {!hasGeneratedPhoto && hasSchema && !imageError && (
          <img
            src={getImageUrl(pose.schema_path, pose.id, 'schema')}
            alt={pose.name}
            className="absolute inset-0 w-full h-full object-contain p-4 bg-card/90"
            onError={handleImageError}
          />
        )}

        {/* Placeholder - show when no images or image failed to load */}
        {showPlaceholder && (
          <div className="absolute inset-0 flex items-center justify-center">
            <div className="text-center">
              <div className="w-14 h-14 rounded-xl bg-card/90 shadow-sm flex items-center justify-center mx-auto mb-3">
                <ImageIcon className="w-6 h-6 text-muted-foreground" />
              </div>
              <p className="text-muted-foreground text-sm font-medium">{t("pose.no_image")}</p>
              <p className="text-muted-foreground/70 text-xs mt-0.5">{t("pose.hover_generate")}</p>
            </div>
          </div>
        )}

        <div className="absolute top-3 left-3">
          <Badge className={`${statusColor} border-0 font-medium`}>
            {StatusIcon && <StatusIcon className="w-3 h-3 mr-1" />}
            {statusLabel}
          </Badge>
        </div>

        {/* Compare button */}
        <CompareButton pose={pose} variant="card" />

          {/* Hover overlay for desktop, always visible buttons container for mobile */}
          <div className="absolute inset-0 bg-gradient-to-t from-black/60 via-transparent to-transparent opacity-0 group-hover:opacity-100 md:transition-opacity md:duration-300 touch:opacity-100">
            <div className="absolute bottom-3 left-3 right-3 sm:bottom-4 sm:left-4 sm:right-4 flex gap-2">
              {hasGeneratedPhoto && onView && (
                <Button
                  size="sm"
                  variant="secondary"
                  onClick={handleView}
                  className="flex-1 bg-card/90 backdrop-blur-sm hover:bg-card min-h-[44px] text-sm sm:text-base touch-manipulation active:scale-95 transition-transform"
                >
                  <Eye className="w-4 h-4 mr-1.5" />
                  {t("pose.view")}
                </Button>
              )}
              {!hasGeneratedPhoto && onGenerate && (
                <Button
                  size="sm"
                  onClick={handleGenerate}
                  className="flex-1 bg-primary hover:bg-primary/90 text-primary-foreground min-h-[44px] text-sm sm:text-base touch-manipulation active:scale-95 transition-transform"
                >
                  <Sparkles className="w-4 h-4 mr-1.5" />
                  <span className="truncate">{hasSchema ? t("pose.generate") : t("pose.upload_generate")}</span>
                </Button>
              )}
            </div>
          </div>

      </div>

      <div className="p-3 sm:p-4">
        <div className="flex items-center justify-between gap-2">
          <h3 className="font-medium text-foreground text-base sm:text-lg truncate flex-1">{pose.name}</h3>
          <Link to={`/poses/${pose.id}`}>
            <Button
              variant="ghost"
              size="icon"
              className="h-10 w-10 min-h-[44px] min-w-[44px] text-muted-foreground hover:text-foreground touch-manipulation active:scale-95 transition-transform flex-shrink-0"
              aria-label={t("pose.view_details")}
            >
              <ExternalLink className="w-4 h-4" />
            </Button>
          </Link>
        </div>

        <div className="flex flex-wrap gap-1.5 sm:gap-2 mt-2">
          {pose.category_name && (
            <Badge variant="outline" className="text-xs text-muted-foreground">
              {pose.category_name}
            </Badge>
          )}
        </div>
      </div>
    </div>
  );
};
