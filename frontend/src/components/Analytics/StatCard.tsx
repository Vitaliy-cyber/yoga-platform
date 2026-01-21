import React from 'react';
import { motion } from 'framer-motion';
import { LucideIcon, TrendingUp, TrendingDown, Minus } from 'lucide-react';
import { cn } from '../../lib/utils';
import { useI18n } from '../../i18n';

export interface StatCardProps {
  title: string;
  value: number | string;
  subtitle?: string;
  icon?: LucideIcon;
  trend?: 'up' | 'down' | 'neutral';
  trendValue?: string;
  color?: 'default' | 'primary' | 'success' | 'warning' | 'danger' | 'info';
  className?: string;
  delay?: number;
}

const colorStyles = {
  default: 'bg-muted text-foreground',
  primary: 'bg-primary/10 text-primary',
  success: 'bg-emerald-50 dark:bg-emerald-900/30 text-emerald-700 dark:text-emerald-400',
  warning: 'bg-amber-50 dark:bg-amber-900/30 text-amber-700 dark:text-amber-400',
  danger: 'bg-rose-50 dark:bg-rose-900/30 text-rose-700 dark:text-rose-400',
  info: 'bg-sky-50 dark:bg-sky-900/30 text-sky-700 dark:text-sky-400',
};

const iconColorStyles = {
  default: 'bg-muted text-muted-foreground',
  primary: 'bg-primary/20 text-primary',
  success: 'bg-emerald-100 dark:bg-emerald-900/50 text-emerald-600 dark:text-emerald-400',
  warning: 'bg-amber-100 dark:bg-amber-900/50 text-amber-600 dark:text-amber-400',
  danger: 'bg-rose-100 dark:bg-rose-900/50 text-rose-600 dark:text-rose-400',
  info: 'bg-sky-100 dark:bg-sky-900/50 text-sky-600 dark:text-sky-400',
};

const trendIcons = {
  up: TrendingUp,
  down: TrendingDown,
  neutral: Minus,
};

const trendColors = {
  up: 'text-emerald-600',
  down: 'text-rose-600',
  neutral: 'text-muted-foreground',
};

export const StatCard: React.FC<StatCardProps> = ({
  title,
  value,
  subtitle,
  icon: Icon,
  trend,
  trendValue,
  color = 'default',
  className,
  delay = 0,
}) => {
  const { formatNumber } = useI18n();
  const TrendIcon = trend ? trendIcons[trend] : null;

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4, delay: delay * 0.1, ease: 'easeOut' }}
      className={cn(
        'relative overflow-hidden rounded-2xl p-6 transition-all duration-300 hover:shadow-lg',
        colorStyles[color],
        className
      )}
    >
      {/* Background decoration */}
      <div className="absolute -right-4 -top-4 h-24 w-24 rounded-full bg-white/10" />
      <div className="absolute -right-2 -top-2 h-16 w-16 rounded-full bg-white/5" />

      <div className="relative flex items-start justify-between">
        <div className="flex-1">
          <p className="text-sm font-medium opacity-70">{title}</p>
          <div className="mt-2 flex items-baseline gap-2">
            <span className="text-3xl font-bold tracking-tight">
              {typeof value === 'number' ? formatNumber(value) : value}
            </span>
            {trend && trendValue && (
              <span className={cn('flex items-center gap-1 text-sm font-medium', trendColors[trend])}>
                {TrendIcon && <TrendIcon className="h-4 w-4" />}
                {trendValue}
              </span>
            )}
          </div>
          {subtitle && (
            <p className="mt-1 text-sm opacity-60">{subtitle}</p>
          )}
        </div>
        {Icon && (
          <div className={cn('rounded-xl p-3', iconColorStyles[color])}>
            <Icon className="h-6 w-6" />
          </div>
        )}
      </div>
    </motion.div>
  );
};

export default StatCard;
