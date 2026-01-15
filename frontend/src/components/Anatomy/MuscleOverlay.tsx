import React from 'react';
import type { PoseMuscle } from '../../types';
import { cn } from '../../lib/utils';

interface MuscleOverlayProps {
  muscles: PoseMuscle[];
  className?: string;
}

export const MuscleOverlay: React.FC<MuscleOverlayProps> = ({ muscles, className }) => {
  const groupedMuscles = muscles.reduce((acc, muscle) => {
    const part = muscle.body_part || 'other';
    if (!acc[part]) acc[part] = [];
    acc[part].push(muscle);
    return acc;
  }, {} as Record<string, PoseMuscle[]>);

  const bodyPartLabels: Record<string, string> = {
    back: 'Спина',
    core: 'Корпус',
    legs: 'Ноги',
    arms: 'Руки',
    shoulders: 'Плечі',
    chest: 'Груди',
    other: 'Інше',
  };

  const getActivationClass = (level: number): string => {
    if (level >= 80) return 'border-red-500/50 bg-red-500/10 text-red-700';
    if (level >= 60) return 'border-orange-500/50 bg-orange-500/10 text-orange-700';
    if (level >= 40) return 'border-yellow-500/50 bg-yellow-500/10 text-yellow-700';
    if (level >= 20) return 'border-emerald-500/50 bg-emerald-500/10 text-emerald-700';
    return 'border-blue-500/50 bg-blue-500/10 text-blue-700';
  };

  return (
    <div className={cn('space-y-5', className)}>
      {Object.entries(groupedMuscles).map(([part, partMuscles]) => (
        <div key={part}>
          <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2.5">
            {bodyPartLabels[part] || part}
          </h4>
          <div className="flex flex-wrap gap-2">
            {partMuscles
              .sort((a, b) => b.activation_level - a.activation_level)
              .map((muscle) => (
                <div
                  key={muscle.muscle_id}
                  className={cn(
                    'px-3 py-1 rounded-full border text-sm flex items-center gap-2 backdrop-blur-sm transition-transform hover:scale-105 cursor-default',
                    getActivationClass(muscle.activation_level)
                  )}
                >
                  <span className="font-medium">
                    {muscle.muscle_name_ua || muscle.muscle_name}
                  </span>
                  <span className="text-xs opacity-70 border-l border-current pl-2">
                    {muscle.activation_level}%
                  </span>
                </div>
              ))}
          </div>
        </div>
      ))}
    </div>
  );
};
