import React from "react";
import type { MuscleComparison, PoseComparisonItem } from "../../types";
import { useI18n } from "../../i18n";

// Color palette for poses (up to 4 poses)
const POSE_COLORS = [
  { bg: "bg-indigo-500", text: "text-indigo-600 dark:text-indigo-400", light: "bg-indigo-100 dark:bg-indigo-900/40" },
  { bg: "bg-emerald-500", text: "text-emerald-600 dark:text-emerald-400", light: "bg-emerald-100 dark:bg-emerald-900/40" },
  { bg: "bg-amber-500", text: "text-amber-600 dark:text-amber-400", light: "bg-amber-100 dark:bg-amber-900/40" },
  { bg: "bg-rose-500", text: "text-rose-600 dark:text-rose-400", light: "bg-rose-100 dark:bg-rose-900/40" },
];

// Body part translation keys - explicit mapping to avoid dynamic key type errors
const BODY_PART_TRANSLATION_KEYS: Record<string, string> = {
  chest: "muscle.part.chest",
  back: "muscle.part.back",
  shoulders: "muscle.part.shoulders",
  arms: "muscle.part.arms",
  core: "muscle.part.core",
  legs: "muscle.part.legs",
  other: "muscle.part.other",
};

interface MuscleComparisonChartProps {
  muscles: MuscleComparison[];
  poses: PoseComparisonItem[];
  className?: string;
}

export const MuscleComparisonChart: React.FC<MuscleComparisonChartProps> = ({
  muscles,
  poses,
  className = "",
}) => {
  const { t, locale } = useI18n();

  // Group muscles by body part
  const musclesByBodyPart = React.useMemo(() => {
    const groups: Record<string, MuscleComparison[]> = {};

    for (const muscle of muscles) {
      const bodyPart = muscle.body_part || "other";
      if (!groups[bodyPart]) {
        groups[bodyPart] = [];
      }
      groups[bodyPart].push(muscle);
    }

    // Sort groups by predefined order
    const order = ["chest", "back", "shoulders", "arms", "core", "legs", "other"];
    const sortedGroups: [string, MuscleComparison[]][] = [];

    for (const part of order) {
      if (groups[part]) {
        sortedGroups.push([part, groups[part]]);
      }
    }

    // Add any groups not in the predefined order
    for (const [part, muscleList] of Object.entries(groups)) {
      if (!order.includes(part)) {
        sortedGroups.push([part, muscleList]);
      }
    }

    return sortedGroups;
  }, [muscles]);

  const getMuscleName = (muscle: MuscleComparison): string => {
    if (locale === "ua" && muscle.muscle_name_ua) {
      return muscle.muscle_name_ua;
    }
    return muscle.muscle_name;
  };

  const getBodyPartLabel = (bodyPart: string): string => {
    const translationKey = BODY_PART_TRANSLATION_KEYS[bodyPart];

    if (translationKey) {
      // Use a type-safe approach: check if we have a known translation key
      const translation = t(translationKey as Parameters<typeof t>[0]);
      // If translation returns the key itself, fall back to capitalized body part
      if (translation !== translationKey) {
        return translation;
      }
    }

    // Fallback: capitalize the body part name
    return bodyPart.charAt(0).toUpperCase() + bodyPart.slice(1);
  };

  if (muscles.length === 0) {
    return (
      <div className={`text-center py-8 text-muted-foreground ${className}`}>
        {t("compare.no_muscle_data")}
      </div>
    );
  }

  return (
    <div className={className}>
      {/* Legend */}
      <div className="flex flex-wrap gap-4 mb-6 pb-4 border-b border-border">
        {poses.map((pose, idx) => (
          <div key={pose.id} className="flex items-center gap-2">
            <div
              className={`w-4 h-4 rounded ${POSE_COLORS[idx % POSE_COLORS.length].bg}`}
            />
            <span className="text-sm font-medium text-foreground">
              {pose.name}
            </span>
          </div>
        ))}
      </div>

      {/* Muscle groups */}
      <div className="space-y-6">
        {musclesByBodyPart.map(([bodyPart, muscleList]) => (
          <div key={bodyPart}>
            {/* Body part header */}
            <h4 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide mb-3">
              {getBodyPartLabel(bodyPart)}
            </h4>

            {/* Muscle rows */}
            <div className="space-y-3">
              {muscleList.map((muscle) => (
                <div key={muscle.muscle_id} className="space-y-1">
                  {/* Muscle name */}
                  <div className="text-sm text-foreground font-medium">
                    {getMuscleName(muscle)}
                  </div>

                  {/* Bars for each pose */}
                  <div className="space-y-1">
                    {poses.map((pose, idx) => {
                      const activationValue = muscle.activations[pose.id];
                      const hasActivation = activationValue !== undefined;
                      const activation = hasActivation ? activationValue : 0;
                      const colors = POSE_COLORS[idx % POSE_COLORS.length];

                      return (
                        <div
                          key={pose.id}
                          className="flex items-center gap-2"
                        >
                          {/* Bar container */}
                          <div className={`flex-1 h-5 rounded ${colors.light} relative overflow-hidden`}>
                            {hasActivation ? (
                              <>
                                {/* Filled bar */}
                                <div
                                  className={`absolute inset-y-0 left-0 ${colors.bg} rounded transition-[width] duration-500`}
                                  style={{ width: `${activation}%` }}
                                />

                                {/* Activation value label */}
                                {activation > 0 && (
                                  <span
                                    className={`absolute inset-y-0 flex items-center text-xs font-medium ${
                                      activation > 50 ? "text-white" : colors.text
                                    }`}
                                    style={{
                                      left: activation > 50 ? "8px" : `${activation + 2}%`,
                                    }}
                                  >
                                    {activation}%
                                  </span>
                                )}
                              </>
                            ) : (
                              /* N/A indicator for untracked muscles */
                              <span className="absolute inset-y-0 flex items-center px-2 text-xs font-medium text-muted-foreground/70 italic">
                                {t("compare.not_tracked")}
                              </span>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};

// Compact version for sidebar or summary
interface CompactMuscleChartProps {
  muscles: MuscleComparison[];
  poses: PoseComparisonItem[];
  maxRows?: number;
  className?: string;
}

export const CompactMuscleChart: React.FC<CompactMuscleChartProps> = ({
  muscles,
  poses,
  maxRows = 5,
  className = "",
}) => {
  const { locale } = useI18n();

  // Get top muscles by average activation
  const topMuscles = React.useMemo(() => {
    return [...muscles]
      .map((muscle) => {
        const activationValues = Object.values(muscle.activations);
        const avgActivation =
          activationValues.length > 0
            ? activationValues.reduce((a, b) => a + b, 0) / activationValues.length
            : 0;
        return { ...muscle, avgActivation };
      })
      .sort((a, b) => b.avgActivation - a.avgActivation)
      .slice(0, maxRows);
  }, [muscles, maxRows]);

  const getMuscleName = (muscle: MuscleComparison): string => {
    if (locale === "ua" && muscle.muscle_name_ua) {
      return muscle.muscle_name_ua;
    }
    return muscle.muscle_name;
  };

  return (
    <div className={`space-y-2 ${className}`}>
      {topMuscles.map((muscle) => (
        <div key={muscle.muscle_id} className="flex items-center gap-3">
          <span className="text-xs text-muted-foreground w-24 truncate" title={getMuscleName(muscle)}>
            {getMuscleName(muscle)}
          </span>

          <div className="flex-1 flex items-center gap-1">
            {poses.map((pose, idx) => {
              const activationValue = muscle.activations[pose.id];
              const hasActivation = activationValue !== undefined;
              const activation = hasActivation ? activationValue : 0;
              const colors = POSE_COLORS[idx % POSE_COLORS.length];

              return (
                <div
                  key={pose.id}
                  className={`h-3 rounded ${colors.light} relative overflow-hidden flex-1`}
                  title={hasActivation ? `${pose.name}: ${activation}%` : `${pose.name}: N/A`}
                >
                  {hasActivation ? (
                    <div
                      className={`absolute inset-y-0 left-0 ${colors.bg} rounded`}
                      style={{ width: `${activation}%` }}
                    />
                  ) : (
                    /* Diagonal stripes pattern for N/A */
                    <div className="absolute inset-0 bg-muted opacity-50" />
                  )}
                </div>
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );
};
