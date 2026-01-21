import React from "react";
import { cn } from "../../lib/utils";
import { LucideIcon, Image, Layers, FileQuestion, Search, Inbox } from "lucide-react";

type EmptyStateVariant = "poses" | "sequences" | "search" | "generic" | "inbox";

interface EmptyStateProps {
  variant?: EmptyStateVariant;
  icon?: LucideIcon;
  title: string;
  description?: string;
  action?: React.ReactNode;
  className?: string;
}

const variantIcons: Record<EmptyStateVariant, LucideIcon> = {
  poses: Image,
  sequences: Layers,
  search: Search,
  generic: FileQuestion,
  inbox: Inbox,
};

// SVG illustration component for visual appeal
const EmptyIllustration: React.FC<{ variant: EmptyStateVariant }> = ({ variant }) => {
  // Simple, clean illustration for empty states
  return (
    <svg
      viewBox="0 0 200 160"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className="w-48 h-40 mx-auto mb-4"
      aria-hidden="true"
    >
      {/* Background shape */}
      <ellipse
        cx="100"
        cy="140"
        rx="80"
        ry="12"
        className="fill-stone-100"
      />

      {/* Main container/box shape */}
      <rect
        x="50"
        y="40"
        width="100"
        height="90"
        rx="8"
        className="fill-stone-50 stroke-stone-200"
        strokeWidth="2"
      />

      {/* Inner decorative elements based on variant */}
      {variant === "poses" && (
        <>
          {/* Person silhouette placeholder */}
          <circle cx="100" cy="65" r="12" className="fill-stone-200" />
          <path
            d="M85 95 L100 75 L115 95 L100 110 Z"
            className="fill-stone-200"
          />
          {/* Image icon lines */}
          <path
            d="M70 115 L85 100 L95 108 L110 90 L130 115"
            className="stroke-stone-300"
            strokeWidth="2"
            fill="none"
          />
        </>
      )}

      {variant === "sequences" && (
        <>
          {/* Stacked layers */}
          <rect x="65" y="55" width="70" height="12" rx="3" className="fill-stone-200" />
          <rect x="70" y="72" width="60" height="12" rx="3" className="fill-stone-200" />
          <rect x="75" y="89" width="50" height="12" rx="3" className="fill-stone-200" />
          {/* Play button */}
          <circle cx="100" cy="115" r="8" className="fill-stone-300" />
          <path d="M98 112 L104 115 L98 118 Z" className="fill-white" />
        </>
      )}

      {variant === "search" && (
        <>
          {/* Magnifying glass */}
          <circle cx="90" cy="75" r="20" className="stroke-stone-300" strokeWidth="3" fill="none" />
          <path d="M105 90 L120 105" className="stroke-stone-300" strokeWidth="4" strokeLinecap="round" />
          {/* Question mark */}
          <text x="85" y="82" className="fill-stone-300" fontSize="20" fontWeight="bold">?</text>
        </>
      )}

      {(variant === "generic" || variant === "inbox") && (
        <>
          {/* Document lines */}
          <rect x="70" y="55" width="60" height="6" rx="2" className="fill-stone-200" />
          <rect x="70" y="67" width="45" height="6" rx="2" className="fill-stone-200" />
          <rect x="70" y="79" width="55" height="6" rx="2" className="fill-stone-200" />
          <rect x="70" y="91" width="35" height="6" rx="2" className="fill-stone-200" />
          {/* Empty indicator */}
          <circle cx="100" cy="115" r="6" className="stroke-stone-300" strokeWidth="2" fill="none" />
        </>
      )}

      {/* Decorative dots */}
      <circle cx="40" cy="60" r="3" className="fill-stone-200" />
      <circle cx="160" cy="80" r="2" className="fill-stone-200" />
      <circle cx="45" cy="100" r="2" className="fill-stone-200" />
      <circle cx="155" cy="50" r="3" className="fill-stone-200" />
    </svg>
  );
};

export const EmptyState: React.FC<EmptyStateProps> = ({
  variant = "generic",
  icon,
  title,
  description,
  action,
  className,
}) => {
  const IconComponent = icon || variantIcons[variant];

  return (
    <div className={cn("text-center py-12 sm:py-16 px-4", className)}>
      {/* Illustration */}
      <EmptyIllustration variant={variant} />

      {/* Icon badge */}
      <div className="w-14 h-14 sm:w-16 sm:h-16 rounded-full bg-muted flex items-center justify-center mx-auto mb-4 -mt-8 relative z-10 border-4 border-background shadow-sm">
        <IconComponent className="w-6 h-6 sm:w-7 sm:h-7 text-muted-foreground" />
      </div>

      {/* Title */}
      <h3 className="text-lg sm:text-xl font-semibold text-foreground mb-2">
        {title}
      </h3>

      {/* Description */}
      {description && (
        <p className="text-muted-foreground text-sm sm:text-base max-w-md mx-auto mb-6">
          {description}
        </p>
      )}

      {/* Action */}
      {action && (
        <div className="flex justify-center">
          {action}
        </div>
      )}
    </div>
  );
};

export default EmptyState;
