import React, { useState } from "react";
import { Link } from "react-router-dom";
import { Badge } from "../ui/badge";
import { Button } from "../ui/button";
import { Eye, Sparkles, AlertCircle, CheckCircle2, ExternalLink, ImageIcon } from "lucide-react";
import type { PoseListItem } from "../../types";
import { getImageProxyUrl } from "../../services/api";

const statusConfig = {
  draft: { label: "Draft", color: "bg-stone-100 text-stone-600", icon: null },
  complete: { label: "Complete", color: "bg-emerald-100 text-emerald-700", icon: CheckCircle2 },
  error: { label: "Error", color: "bg-red-100 text-red-700", icon: AlertCircle },
};

interface PoseCardProps {
  pose: PoseListItem;
  onView?: (pose: PoseListItem) => void;
  onGenerate?: (pose: PoseListItem) => void;
}

export const PoseCard: React.FC<PoseCardProps> = ({ pose, onView, onGenerate }) => {
  const [imageError, setImageError] = useState(false);
  
  const status = pose.photo_path ? statusConfig.complete : statusConfig.draft;
  const StatusIcon = status.icon;
  
  // Check for actual non-empty paths
  const hasGeneratedPhoto = Boolean(pose.photo_path && pose.photo_path.trim());
  const hasSchema = Boolean(pose.schema_path && pose.schema_path.trim());
  const showPlaceholder = imageError || (!hasGeneratedPhoto && !hasSchema);

  return (
    <div className="group bg-white rounded-2xl border border-stone-200 overflow-hidden hover:shadow-lg hover:border-stone-300 transition-shadow duration-200">
      <div className="aspect-[4/3] relative overflow-hidden bg-gradient-to-br from-stone-200 to-stone-300">
        {/* Generated photo */}
        {hasGeneratedPhoto && !imageError && (
          <img
            src={getImageProxyUrl(pose.id, 'photo')}
            alt={pose.name}
            className="absolute inset-0 w-full h-full object-cover"
            onError={() => setImageError(true)}
          />
        )}
        
        {/* Schema image */}
        {!hasGeneratedPhoto && hasSchema && !imageError && (
          <img
            src={getImageProxyUrl(pose.id, 'schema')}
            alt={pose.name}
            className="absolute inset-0 w-full h-full object-contain p-4 bg-white/90"
            onError={() => setImageError(true)}
          />
        )}
        
        {/* Placeholder - show when no images or image failed to load */}
        {showPlaceholder && (
          <div className="absolute inset-0 flex items-center justify-center">
            <div className="text-center">
              <div className="w-14 h-14 rounded-xl bg-white/90 shadow-sm flex items-center justify-center mx-auto mb-3">
                <ImageIcon className="w-6 h-6 text-stone-400" />
              </div>
              <p className="text-stone-500 text-sm font-medium">No image</p>
              <p className="text-stone-400 text-xs mt-0.5">Hover to generate</p>
            </div>
          </div>
        )}

        <div className="absolute top-3 left-3">
          <Badge className={`${status.color} border-0 font-medium`}>
            {StatusIcon && <StatusIcon className="w-3 h-3 mr-1" />}
            {status.label}
          </Badge>
        </div>

        <div className="absolute inset-0 bg-gradient-to-t from-black/60 via-transparent to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-300">
          <div className="absolute bottom-4 left-4 right-4 flex gap-2">
            {hasGeneratedPhoto && onView && (
              <Button
                size="sm"
                variant="secondary"
                onClick={() => onView(pose)}
                className="flex-1 bg-white/90 backdrop-blur-sm hover:bg-white"
              >
                <Eye className="w-4 h-4 mr-1" />
                View
              </Button>
            )}
            {!hasGeneratedPhoto && onGenerate && (
              <Button
                size="sm"
                onClick={() => onGenerate(pose)}
                className="flex-1 bg-stone-800 hover:bg-stone-900 text-white"
              >
                <Sparkles className="w-4 h-4 mr-1" />
                {hasSchema ? "Generate" : "Upload & Generate"}
              </Button>
            )}
          </div>
        </div>
      </div>

      <div className="p-4">
        <div className="flex items-center justify-between">
          <h3 className="font-medium text-stone-800 text-lg truncate flex-1">{pose.name}</h3>
          <Link to={`/poses/${pose.id}`}>
            <Button variant="ghost" size="icon" className="h-8 w-8 text-stone-400 hover:text-stone-600">
              <ExternalLink className="w-4 h-4" />
            </Button>
          </Link>
        </div>

        <div className="flex flex-wrap gap-2 mt-2">
          {pose.category_name && (
            <Badge variant="outline" className="text-xs border-stone-200 text-stone-500">
              {pose.category_name}
            </Badge>
          )}
        </div>
      </div>
    </div>
  );
};
