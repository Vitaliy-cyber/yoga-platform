import React, { useMemo, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import type { MuscleStats } from '../../types';
import { useI18n } from '../../i18n';
import { cn } from '../../lib/utils';

interface MuscleHeatmapProps {
  muscles: MuscleStats[];
  className?: string;
}

// Muscle positions on the body SVG (relative coordinates 0-100)
// These map muscle names to positions on a simplified human body
const musclePositions: Record<string, { x: number; y: number; width: number; height: number; side: 'front' | 'back' | 'both' }> = {
  // Back muscles
  erector_spinae: { x: 50, y: 38, width: 12, height: 20, side: 'back' },
  latissimus_dorsi: { x: 50, y: 32, width: 24, height: 18, side: 'back' },
  trapezius: { x: 50, y: 18, width: 20, height: 14, side: 'back' },
  rhomboids: { x: 50, y: 24, width: 14, height: 10, side: 'back' },

  // Core muscles
  rectus_abdominis: { x: 50, y: 36, width: 10, height: 18, side: 'front' },
  obliques: { x: 50, y: 38, width: 18, height: 14, side: 'front' },
  transverse_abdominis: { x: 50, y: 42, width: 16, height: 10, side: 'front' },

  // Leg muscles
  quadriceps: { x: 50, y: 58, width: 18, height: 18, side: 'front' },
  hamstrings: { x: 50, y: 60, width: 16, height: 16, side: 'back' },
  gluteus_maximus: { x: 50, y: 50, width: 20, height: 10, side: 'back' },
  gluteus_medius: { x: 50, y: 48, width: 18, height: 8, side: 'back' },
  calves: { x: 50, y: 78, width: 12, height: 14, side: 'both' },
  hip_flexors: { x: 50, y: 50, width: 16, height: 8, side: 'front' },

  // Shoulder muscles
  deltoids: { x: 50, y: 18, width: 28, height: 10, side: 'both' },
  rotator_cuff: { x: 50, y: 20, width: 22, height: 8, side: 'back' },

  // Arm muscles
  biceps: { x: 50, y: 28, width: 30, height: 10, side: 'front' },
  triceps: { x: 50, y: 30, width: 30, height: 10, side: 'back' },
  forearms: { x: 50, y: 40, width: 34, height: 10, side: 'both' },

  // Chest muscles
  pectoralis: { x: 50, y: 24, width: 20, height: 10, side: 'front' },
  serratus_anterior: { x: 50, y: 30, width: 22, height: 8, side: 'front' },
};

// Get color based on activation level
const getHeatColor = (activationLevel: number, maxActivation: number): string => {
  if (maxActivation === 0) return 'rgba(200, 200, 200, 0.3)'; // Gray for no data

  const normalizedLevel = activationLevel / maxActivation;

  if (normalizedLevel >= 0.7) {
    // High activation - red/orange
    return `rgba(239, 68, 68, ${0.4 + normalizedLevel * 0.5})`;
  } else if (normalizedLevel >= 0.3) {
    // Medium activation - yellow/amber
    return `rgba(245, 158, 11, ${0.3 + normalizedLevel * 0.4})`;
  } else if (normalizedLevel > 0) {
    // Low activation - green/teal
    return `rgba(34, 197, 94, ${0.2 + normalizedLevel * 0.3})`;
  } else {
    // No activation - gray
    return 'rgba(200, 200, 200, 0.3)';
  }
};

export const MuscleHeatmap: React.FC<MuscleHeatmapProps> = ({ muscles, className }) => {
  const { locale } = useI18n();
  const [hoveredMuscle, setHoveredMuscle] = useState<MuscleStats | null>(null);
  const [view, setView] = useState<'front' | 'back'>('front');

  // Calculate max activation for normalization
  // Handle empty muscles array to avoid Math.max(...[]) returning -Infinity
  const maxActivation = useMemo(() => {
    if (muscles.length === 0) {
      return 1; // Default to 1 to avoid division by zero issues
    }
    return Math.max(...muscles.map(m => m.total_activations), 1);
  }, [muscles]);

  // Create a map for quick lookup
  const muscleMap = useMemo(() => {
    const map = new Map<string, MuscleStats>();
    muscles.forEach(m => map.set(m.name, m));
    return map;
  }, [muscles]);

  // Filter muscles for current view
  const visibleMuscles = useMemo(() => {
    return Object.entries(musclePositions).filter(([, pos]) =>
      pos.side === 'both' || pos.side === view
    );
  }, [view]);

  return (
    <div className={cn('relative', className)}>
      {/* View Toggle */}
      <div className="absolute right-4 top-4 z-10 flex rounded-lg bg-card/80 p-1 shadow-sm backdrop-blur-sm">
        <button
          onClick={() => setView('front')}
          className={cn(
            'rounded-md px-3 py-1.5 text-sm font-medium transition-colors',
            view === 'front'
              ? 'bg-primary text-primary-foreground shadow-sm'
              : 'text-muted-foreground hover:bg-accent'
          )}
        >
          {locale === 'ua' ? 'Спереду' : 'Front'}
        </button>
        <button
          onClick={() => setView('back')}
          className={cn(
            'rounded-md px-3 py-1.5 text-sm font-medium transition-colors',
            view === 'back'
              ? 'bg-primary text-primary-foreground shadow-sm'
              : 'text-muted-foreground hover:bg-accent'
          )}
        >
          {locale === 'ua' ? 'Ззаду' : 'Back'}
        </button>
      </div>

      {/* SVG Body */}
      <svg
        viewBox="0 0 100 100"
        className="h-full w-full"
        style={{ maxHeight: '400px' }}
      >
        {/* Background body silhouette */}
        <defs>
          <linearGradient id="bodyGradient" x1="0%" y1="0%" x2="0%" y2="100%">
            <stop offset="0%" stopColor="#e5e7eb" />
            <stop offset="100%" stopColor="#d1d5db" />
          </linearGradient>
        </defs>

        {/* Head */}
        <ellipse cx="50" cy="10" rx="8" ry="9" fill="url(#bodyGradient)" />

        {/* Neck */}
        <rect x="46" y="17" width="8" height="5" fill="url(#bodyGradient)" />

        {/* Torso */}
        <path
          d="M 35 22
             Q 30 24 28 30
             Q 26 40 30 52
             L 35 54
             L 35 52
             L 50 54
             L 65 52
             L 65 54
             L 70 52
             Q 74 40 72 30
             Q 70 24 65 22
             L 50 20 Z"
          fill="url(#bodyGradient)"
        />

        {/* Left Arm */}
        <path
          d="M 28 22
             Q 20 24 16 30
             Q 12 38 14 48
             L 18 48
             Q 20 38 24 30
             Q 26 26 30 24 Z"
          fill="url(#bodyGradient)"
        />

        {/* Right Arm */}
        <path
          d="M 72 22
             Q 80 24 84 30
             Q 88 38 86 48
             L 82 48
             Q 80 38 76 30
             Q 74 26 70 24 Z"
          fill="url(#bodyGradient)"
        />

        {/* Left Leg */}
        <path
          d="M 36 54
             L 34 70
             Q 32 80 34 92
             L 40 92
             Q 42 80 40 70
             L 44 54 Z"
          fill="url(#bodyGradient)"
        />

        {/* Right Leg */}
        <path
          d="M 64 54
             L 66 70
             Q 68 80 66 92
             L 60 92
             Q 58 80 60 70
             L 56 54 Z"
          fill="url(#bodyGradient)"
        />

        {/* Muscle highlights */}
        {visibleMuscles.map(([name, pos]) => {
          const muscleData = muscleMap.get(name);
          const activation = muscleData?.total_activations || 0;
          const color = getHeatColor(activation, maxActivation);
          const isHovered = hoveredMuscle?.name === name;

          return (
            <motion.ellipse
              key={name}
              cx={pos.x}
              cy={pos.y}
              rx={pos.width / 2}
              ry={pos.height / 2}
              fill={color}
              stroke={isHovered ? '#3b82f6' : 'transparent'}
              strokeWidth={isHovered ? 2 : 0}
              initial={{ opacity: 0, scale: 0.8 }}
              animate={{
                opacity: 1,
                scale: isHovered ? 1.1 : 1,
              }}
              transition={{ duration: 0.3 }}
              className="cursor-pointer"
              onMouseEnter={() => muscleData && setHoveredMuscle(muscleData)}
              onMouseLeave={() => setHoveredMuscle(null)}
            />
          );
        })}
      </svg>

      {/* Tooltip */}
      <AnimatePresence>
        {hoveredMuscle && (
          <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 10 }}
            transition={{ duration: 0.15 }}
            className="absolute bottom-4 left-1/2 -translate-x-1/2 rounded-xl bg-card px-4 py-3 shadow-lg"
          >
            <p className="font-semibold text-foreground">
              {locale === 'ua' ? hoveredMuscle.name_ua || hoveredMuscle.name : hoveredMuscle.name}
            </p>
            <div className="mt-1 flex items-center gap-4 text-sm text-muted-foreground">
              <span>
                {locale === 'ua' ? 'Поз:' : 'Poses:'} {hoveredMuscle.pose_count}
              </span>
              <span>
                {locale === 'ua' ? 'Сер. активація:' : 'Avg:'} {hoveredMuscle.avg_activation_level.toFixed(0)}%
              </span>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Legend */}
      <div className="absolute bottom-4 right-4 flex items-center gap-2 rounded-lg bg-card/80 px-3 py-2 text-xs backdrop-blur-sm">
        <div className="flex items-center gap-1">
          <div className="h-3 w-3 rounded-full bg-red-500/60" />
          <span>{locale === 'ua' ? 'Високо' : 'High'}</span>
        </div>
        <div className="flex items-center gap-1">
          <div className="h-3 w-3 rounded-full bg-amber-500/50" />
          <span>{locale === 'ua' ? 'Середньо' : 'Medium'}</span>
        </div>
        <div className="flex items-center gap-1">
          <div className="h-3 w-3 rounded-full bg-green-500/40" />
          <span>{locale === 'ua' ? 'Низько' : 'Low'}</span>
        </div>
        <div className="flex items-center gap-1">
          <div className="h-3 w-3 rounded-full bg-gray-300" />
          <span>{locale === 'ua' ? 'Немає' : 'None'}</span>
        </div>
      </div>
    </div>
  );
};

export default MuscleHeatmap;
