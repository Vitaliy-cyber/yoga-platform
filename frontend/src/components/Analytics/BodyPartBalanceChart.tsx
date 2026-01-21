import React, { useMemo } from 'react';
import { motion } from 'framer-motion';
import {
  RadarChart,
  PolarGrid,
  PolarAngleAxis,
  PolarRadiusAxis,
  Radar,
  ResponsiveContainer,
  Tooltip,
} from 'recharts';
import type { BodyPartBalance } from '../../types';
import { useI18n } from '../../i18n';
import { cn } from '../../lib/utils';
import { Activity, AlertTriangle, CheckCircle } from 'lucide-react';

interface BodyPartBalanceChartProps {
  balanceData: BodyPartBalance[];
  balanceScore: number;
  className?: string;
}

// Body part name translations
const bodyPartNames: Record<string, { en: string; ua: string }> = {
  back: { en: 'Back', ua: 'Спина' },
  core: { en: 'Core', ua: 'Корпус' },
  legs: { en: 'Legs', ua: 'Ноги' },
  arms: { en: 'Arms', ua: 'Руки' },
  shoulders: { en: 'Shoulders', ua: 'Плечі' },
  chest: { en: 'Chest', ua: 'Груди' },
  other: { en: 'Other', ua: 'Інше' },
};

// Colors for body parts
const bodyPartColors: Record<string, string> = {
  back: '#6366f1',
  core: '#ec4899',
  legs: '#22c55e',
  arms: '#f97316',
  shoulders: '#8b5cf6',
  chest: '#3b82f6',
  other: '#9ca3af',
};

interface CustomTooltipProps {
  active?: boolean;
  payload?: Array<{
    payload: {
      name: string;
      displayName: string;
      percentage_of_total: number;
      avg_activation: number;
      muscle_count: number;
    };
  }>;
}

const CustomTooltip: React.FC<CustomTooltipProps> = ({ active, payload }) => {
  const { locale } = useI18n();

  if (!active || !payload || !payload[0]) return null;

  const data = payload[0].payload;

  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.9 }}
      animate={{ opacity: 1, scale: 1 }}
      className="rounded-xl bg-card px-4 py-3 shadow-lg ring-1 ring-black/5"
    >
      <p className="font-semibold text-foreground">{data.displayName}</p>
      <div className="mt-2 space-y-1 text-sm text-muted-foreground">
        <p>
          {locale === 'ua' ? 'Частка:' : 'Share:'}{' '}
          <span className="font-medium text-foreground">
            {data.percentage_of_total.toFixed(1)}%
          </span>
        </p>
        <p>
          {locale === 'ua' ? 'Сер. активація:' : 'Avg activation:'}{' '}
          <span className="font-medium text-foreground">
            {data.avg_activation.toFixed(0)}%
          </span>
        </p>
        <p>
          {locale === 'ua' ? "М'язів:" : 'Muscles:'}{' '}
          <span className="font-medium text-foreground">{data.muscle_count}</span>
        </p>
      </div>
    </motion.div>
  );
};

// Balance score indicator component
const BalanceScoreIndicator: React.FC<{ score: number }> = ({ score }) => {
  const { locale } = useI18n();

  const getScoreConfig = () => {
    if (score >= 70) {
      return {
        icon: CheckCircle,
        color: 'text-emerald-600',
        bgColor: 'bg-emerald-100',
        label: locale === 'ua' ? 'Добре збалансовано' : 'Well Balanced',
      };
    } else if (score >= 40) {
      return {
        icon: Activity,
        color: 'text-amber-600',
        bgColor: 'bg-amber-100',
        label: locale === 'ua' ? 'Середній баланс' : 'Moderate Balance',
      };
    } else {
      return {
        icon: AlertTriangle,
        color: 'text-rose-600',
        bgColor: 'bg-rose-100',
        label: locale === 'ua' ? 'Потребує уваги' : 'Needs Attention',
      };
    }
  };

  const config = getScoreConfig();
  const Icon = config.icon;

  return (
    <div className="flex items-center gap-3">
      <div className={cn('rounded-xl p-3', config.bgColor)}>
        <Icon className={cn('h-6 w-6', config.color)} />
      </div>
      <div>
        <div className="flex items-baseline gap-2">
          <span className="text-2xl font-bold text-foreground">
            {score.toFixed(0)}%
          </span>
          <span className={cn('text-sm font-medium', config.color)}>
            {config.label}
          </span>
        </div>
        <p className="text-sm text-muted-foreground">
          {locale === 'ua' ? 'Оцінка балансу тренувань' : 'Training balance score'}
        </p>
      </div>
    </div>
  );
};

export const BodyPartBalanceChart: React.FC<BodyPartBalanceChartProps> = ({
  balanceData,
  balanceScore,
  className,
}) => {
  const { locale } = useI18n();

  // Prepare data for radar chart
  const chartData = useMemo(() => {
    // Ensure we have all body parts represented
    const allParts = ['back', 'core', 'legs', 'arms', 'shoulders', 'chest'];
    const dataMap = new Map(balanceData.map((d) => [d.body_part, d]));

    return allParts.map((part) => {
      const data = dataMap.get(part);
      return {
        name: part,
        displayName: bodyPartNames[part]?.[locale] || part,
        percentage_of_total: data?.percentage_of_total || 0,
        avg_activation: data?.avg_activation || 0,
        muscle_count: data?.muscle_count || 0,
        fullMark: 100,
      };
    });
  }, [balanceData, locale]);

  // Check if we have data
  const hasData = balanceData.length > 0;

  if (!hasData) {
    return (
      <div className={cn('flex items-center justify-center py-12', className)}>
        <div className="text-center">
          <div className="mx-auto mb-4 h-16 w-16 rounded-full bg-muted flex items-center justify-center">
            <Activity className="h-8 w-8 text-muted-foreground/70" />
          </div>
          <p className="text-sm text-muted-foreground">
            {locale === 'ua'
              ? 'Немає даних про баланс'
              : 'No balance data available'}
          </p>
          <p className="mt-1 text-xs text-muted-foreground/70">
            {locale === 'ua'
              ? "Додайте м'язи до поз, щоб бачити баланс"
              : 'Add muscles to poses to see balance'}
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className={cn('space-y-6', className)}>
      {/* Balance Score */}
      <BalanceScoreIndicator score={balanceScore} />

      {/* Radar Chart */}
      <div className="h-[300px]">
        <ResponsiveContainer width="100%" height="100%">
          <RadarChart data={chartData} cx="50%" cy="50%" outerRadius="70%">
            <PolarGrid stroke="#e5e7eb" />
            <PolarAngleAxis
              dataKey="displayName"
              tick={{ fontSize: 12, fill: '#6b7280' }}
            />
            <PolarRadiusAxis
              angle={30}
              domain={[0, 100]}
              tick={{ fontSize: 10, fill: '#9ca3af' }}
            />
            <Radar
              name={locale === 'ua' ? 'Частка' : 'Share'}
              dataKey="percentage_of_total"
              stroke="#6366f1"
              fill="#6366f1"
              fillOpacity={0.4}
              strokeWidth={2}
            />
            <Tooltip content={<CustomTooltip />} />
          </RadarChart>
        </ResponsiveContainer>
      </div>

      {/* Body Part Legend */}
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
        {chartData.map((part) => (
          <motion.div
            key={part.name}
            initial={{ opacity: 0, scale: 0.9 }}
            animate={{ opacity: 1, scale: 1 }}
            className="flex items-center gap-2 rounded-lg bg-muted/50 px-3 py-2"
          >
            <div
              className="h-3 w-3 rounded-full"
              style={{ backgroundColor: bodyPartColors[part.name] || '#9ca3af' }}
            />
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium text-foreground">
                {part.displayName}
              </p>
              <p className="text-xs text-muted-foreground">
                {part.percentage_of_total.toFixed(1)}%
              </p>
            </div>
          </motion.div>
        ))}
      </div>
    </div>
  );
};

export default BodyPartBalanceChart;
