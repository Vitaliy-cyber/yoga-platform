import React from 'react';
import { motion } from 'framer-motion';
import type { PoseMuscle } from '../../types';
import { cn } from '../../lib/utils';

interface MuscleBarProps {
  muscle: PoseMuscle;
  showLabel?: boolean;
}

export const MuscleBar: React.FC<MuscleBarProps> = ({ muscle, showLabel = true }) => {
  const getActivationColor = (level: number): string => {
    if (level >= 80) return 'bg-red-500 shadow-[0_0_10px_rgba(239,68,68,0.4)]';
    if (level >= 60) return 'bg-orange-500 shadow-[0_0_10px_rgba(249,115,22,0.4)]';
    if (level >= 40) return 'bg-yellow-500';
    if (level >= 20) return 'bg-emerald-500';
    return 'bg-blue-500';
  };

  return (
    <div className="space-y-1.5">
      {showLabel && (
        <div className="flex justify-between text-sm items-center">
          <span className="font-medium text-foreground/80">
            {muscle.muscle_name_ua || muscle.muscle_name}
          </span>
          <span className="text-xs font-mono bg-muted px-1.5 py-0.5 rounded-md text-muted-foreground">{muscle.activation_level}%</span>
        </div>
      )}
      <div className="h-2.5 bg-secondary/50 rounded-full overflow-hidden border border-white/5">
        <motion.div
          initial={{ width: 0 }}
          whileInView={{ width: `${muscle.activation_level}%` }}
          viewport={{ once: true }}
          transition={{ duration: 0.6, ease: "easeOut" }}
          className={cn(
            'h-full rounded-full relative',
            getActivationColor(muscle.activation_level)
          )}
        >
          <div className="absolute inset-0 bg-gradient-to-r from-transparent via-white/20 to-transparent w-full h-full" />
        </motion.div>
      </div>
    </div>
  );
};

interface MuscleListProps {
  muscles: PoseMuscle[];
  className?: string;
}

export const MuscleList: React.FC<MuscleListProps> = ({ muscles, className }) => {
  const sortedMuscles = [...muscles].sort(
    (a, b) => b.activation_level - a.activation_level
  );

  return (
    <div className={cn('space-y-4', className)}>
      {sortedMuscles.map((muscle) => (
        <MuscleBar key={muscle.muscle_id} muscle={muscle} />
      ))}
    </div>
  );
};
