import React from 'react';
import { Link } from 'react-router-dom';
import { Clock, Layers, ChevronRight, GraduationCap } from 'lucide-react';
import { Badge } from '../ui/badge';
import type { SequenceListItem, DifficultyLevel } from '../../types';
import { useI18n } from '../../i18n';
import { cn } from '../../lib/utils';

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
      state={{ sequencePreview: sequence }}
      onClick={onClick}
      className="group block h-full rounded-2xl border border-border bg-card p-4 sm:p-5 hover:shadow-lg hover:border-border/80 transition-[color,border-color,box-shadow] duration-200"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <h3 className="font-semibold text-foreground text-lg truncate group-hover:text-primary transition-colors">
            {sequence.name}
          </h3>
          {sequence.description ? (
            <p className="text-muted-foreground text-sm line-clamp-2 mt-1.5 min-h-[2.5rem]">
              {sequence.description}
            </p>
          ) : (
            <div className="mt-1.5 min-h-[2.5rem]" aria-hidden="true" />
          )}
        </div>
        <div className="h-10 w-10 rounded-xl bg-gradient-to-br from-muted to-muted/50 border border-border/60 flex items-center justify-center flex-shrink-0">
          <Layers className="w-4 h-4 text-muted-foreground" />
        </div>
      </div>

      <div className="mt-4 flex flex-wrap gap-2">
        <div className="inline-flex items-center gap-1.5 rounded-full border border-border/70 bg-muted/50 px-2.5 py-1 text-xs text-muted-foreground">
          <Layers className="w-3.5 h-3.5" />
          <span>{sequence.pose_count} {t('sequences.poses')}</span>
        </div>
        <div className="inline-flex items-center gap-1.5 rounded-full border border-border/70 bg-muted/50 px-2.5 py-1 text-xs text-muted-foreground">
          <Clock className="w-3.5 h-3.5" />
          <span>{formatDuration(sequence.duration_seconds)}</span>
        </div>
      </div>

      <div className="mt-4 flex items-center justify-between">
        <Badge className={cn(difficultyColors[sequence.difficulty], 'border-0 font-medium')}>
          <GraduationCap className="w-3 h-3 mr-1" />
          {t(`sequences.difficulty.${sequence.difficulty}`)}
        </Badge>
        <div className="h-8 w-8 rounded-full bg-muted/60 flex items-center justify-center">
          <ChevronRight className="w-4 h-4 text-muted-foreground/70 group-hover:text-primary group-hover:translate-x-0.5 transition-[color,transform] duration-200" />
        </div>
      </div>
    </Link>
  );
};
