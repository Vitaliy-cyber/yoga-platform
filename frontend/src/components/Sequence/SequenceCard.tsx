import React from 'react';
import { Link } from 'react-router-dom';
import { Clock, Layers, ChevronRight, GraduationCap } from 'lucide-react';
import { Badge } from '../ui/badge';
import type { SequenceListItem, DifficultyLevel } from '../../types';
import { useI18n } from '../../i18n';

interface SequenceCardProps {
  sequence: SequenceListItem;
  onClick?: () => void;
}

const difficultyColors: Record<DifficultyLevel, string> = {
  beginner: 'bg-emerald-100 text-emerald-700',
  intermediate: 'bg-amber-100 text-amber-700',
  advanced: 'bg-rose-100 text-rose-700',
};

const formatDuration = (seconds: number | null): string => {
  if (!seconds) return '--:--';
  const mins = Math.floor(seconds / 60);
  const secs = seconds % 60;
  return `${mins}:${secs.toString().padStart(2, '0')}`;
};

export const SequenceCard: React.FC<SequenceCardProps> = ({ sequence, onClick }) => {
  const { t } = useI18n();

  return (
    <Link
      to={`/sequences/${sequence.id}`}
      onClick={onClick}
      className="group block bg-card rounded-2xl border border-border overflow-hidden hover:shadow-lg hover:border-border/80 transition-all duration-200"
    >
      {/* Header with gradient */}
      <div className="h-24 bg-gradient-to-br from-primary/20 via-violet-100 to-primary/10 relative">
        <div className="absolute inset-0 bg-gradient-to-t from-background/80 to-transparent" />
        <div className="absolute bottom-3 left-4 right-4">
          <h3 className="font-semibold text-foreground text-lg truncate group-hover:text-primary transition-colors">
            {sequence.name}
          </h3>
        </div>
      </div>

      {/* Content */}
      <div className="p-4 pt-2">
        {sequence.description && (
          <p className="text-muted-foreground text-sm line-clamp-2 mb-3">
            {sequence.description}
          </p>
        )}

        {/* Stats row */}
        <div className="flex items-center gap-4 text-sm text-muted-foreground mb-3">
          <div className="flex items-center gap-1.5">
            <Layers className="w-4 h-4" />
            <span>{sequence.pose_count} {t('sequences.poses')}</span>
          </div>
          <div className="flex items-center gap-1.5">
            <Clock className="w-4 h-4" />
            <span>{formatDuration(sequence.duration_seconds)}</span>
          </div>
        </div>

        {/* Footer with badge and arrow */}
        <div className="flex items-center justify-between">
          <Badge className={`${difficultyColors[sequence.difficulty]} border-0 font-medium`}>
            <GraduationCap className="w-3 h-3 mr-1" />
            {t(`sequences.difficulty.${sequence.difficulty}`)}
          </Badge>
          <ChevronRight className="w-5 h-5 text-muted-foreground/50 group-hover:text-primary group-hover:translate-x-1 transition-all" />
        </div>
      </div>
    </Link>
  );
};
