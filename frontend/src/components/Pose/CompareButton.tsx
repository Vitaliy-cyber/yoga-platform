import React from "react";
import { GitCompareArrows, Check, Plus } from "lucide-react";
import { Button } from "../ui/button";
import { useCompareStore } from "../../store/useCompareStore";
import { useI18n } from "../../i18n";
import type { PoseListItem } from "../../types";

interface CompareButtonProps {
  pose: PoseListItem;
  variant?: "default" | "icon" | "card";
  className?: string;
}

export const CompareButton: React.FC<CompareButtonProps> = ({
  pose,
  variant = "default",
  className = "",
}) => {
  const { t } = useI18n();
  // Subscribe to selectedPoses array directly for proper reactivity
  const selectedPoses = useCompareStore((state) => state.selectedPoses);
  const togglePose = useCompareStore((state) => state.togglePose);

  // Compute derived values - these will update when selectedPoses changes
  const isSelected = selectedPoses.includes(pose.id);
  const canAdd = selectedPoses.length < 4;

  const handleClick = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    togglePose(pose.id, pose);
  };

  // Disabled if can't add more and not already selected
  const isDisabled = !isSelected && !canAdd;

  if (variant === "icon") {
    return (
      <Button
        variant={isSelected ? "default" : "outline"}
        size="icon"
        onClick={handleClick}
        disabled={isDisabled}
        data-testid={`pose-compare-toggle-${pose.id}`}
        className={`h-8 w-8 ${isSelected ? "bg-indigo-600 hover:bg-indigo-700 text-white" : "hover:border-indigo-300 hover:text-indigo-600"} ${className}`}
        aria-label={isSelected ? t("compare.remove") : t("compare.add")}
      >
        {isSelected ? (
          <Check className="w-4 h-4" />
        ) : (
          <GitCompareArrows className="w-4 h-4" />
        )}
      </Button>
    );
  }

  if (variant === "card") {
    return (
      <button
        onClick={handleClick}
        disabled={isDisabled}
        data-testid={`pose-compare-toggle-${pose.id}`}
        aria-label={isSelected ? t("compare.remove") : t("compare.add")}
        className={`
          absolute top-3 right-3 z-10
          w-8 h-8 rounded-full
          flex items-center justify-center
          transition-[opacity,background-color,color,box-shadow,transform] duration-200 ease-out
          active:scale-90
          ${
            isSelected
              ? "bg-indigo-600 text-white shadow-lg opacity-100 translate-y-0"
              : "bg-card/90 text-muted-foreground hover:bg-primary/10 hover:text-primary opacity-0 group-hover:opacity-100 translate-x-1 group-hover:translate-x-0"
          }
          ${isDisabled && !isSelected ? "opacity-50 cursor-not-allowed" : ""}
          ${className}
        `}
      >
        {isSelected ? (
          <Check className="w-4 h-4" />
        ) : (
          <Plus className="w-4 h-4" />
        )}
      </button>
    );
  }

  // Default variant
  return (
    <Button
      variant={isSelected ? "default" : "outline"}
      size="sm"
      onClick={handleClick}
      disabled={isDisabled}
      data-testid={`pose-compare-toggle-${pose.id}`}
      className={`
        ${
          isSelected
            ? "bg-indigo-600 hover:bg-indigo-700 text-white border-indigo-600"
            : "hover:border-indigo-300 hover:text-indigo-600"
        }
        ${className}
      `}
    >
      {isSelected ? (
        <>
          <Check className="w-4 h-4 mr-1.5" />
          {t("compare.added")}
        </>
      ) : (
        <>
          <GitCompareArrows className="w-4 h-4 mr-1.5" />
          {t("compare.add")}
        </>
      )}
    </Button>
  );
};
