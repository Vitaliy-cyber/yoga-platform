import React, { useMemo, useState } from 'react';
import { motion } from 'framer-motion';
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  Cell,
} from 'recharts';
import type { MuscleStats } from '../../types';
import { useI18n } from '../../i18n';
import { cn } from '../../lib/utils';
import { TrendingUp, TrendingDown } from 'lucide-react';

interface MuscleBarChartProps {
  mostTrained: MuscleStats[];
  leastTrained: MuscleStats[];
  className?: string;
}

// Colors for bars
const MOST_TRAINED_COLORS = [
  '#22c55e', // green-500
  '#4ade80', // green-400
  '#86efac', // green-300
  '#bbf7d0', // green-200
  '#dcfce7', // green-100
];

const LEAST_TRAINED_COLORS = [
  '#f87171', // red-400
  '#fca5a5', // red-300
  '#fecaca', // red-200
  '#fee2e2', // red-100
  '#fef2f2', // red-50
];

interface CustomTooltipProps {
  active?: boolean;
  payload?: Array<{
    payload: {
      name: string;
      name_ua: string | null;
      pose_count: number;
      avg_activation_level: number;
      total_activations: number;
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
      <p className="font-semibold text-foreground">
        {locale === 'ua' ? data.name_ua || data.name : data.name}
      </p>
      <div className="mt-2 space-y-1 text-sm text-muted-foreground">
        <p>
          {locale === 'ua' ? 'Поз:' : 'Poses:'}{' '}
          <span className="font-medium text-foreground">{data.pose_count}</span>
        </p>
        <p>
          {locale === 'ua' ? 'Сер. активація:' : 'Avg activation:'}{' '}
          <span className="font-medium text-foreground">{data.avg_activation_level.toFixed(0)}%</span>
        </p>
      </div>
    </motion.div>
  );
};

interface ChartSectionProps {
  title: string;
  icon: React.ReactNode;
  data: MuscleStats[];
  colors: string[];
  iconBg: string;
}

const ChartSection: React.FC<ChartSectionProps> = ({
  title,
  icon,
  data,
  colors,
  iconBg,
}) => {
  const { locale } = useI18n();
  const [hoveredIndex, setHoveredIndex] = useState<number | null>(null);

  const chartData = useMemo(() => {
    return data.map((muscle, index) => ({
      ...muscle,
      displayName: locale === 'ua' ? muscle.name_ua || muscle.name : muscle.name,
      color: colors[index % colors.length],
    }));
  }, [data, locale, colors]);

  if (data.length === 0) {
    return (
      <div className="flex-1 flex flex-col">
        <div className="flex items-center gap-3 mb-4">
          <div className={cn('rounded-lg p-2', iconBg)}>
            {icon}
          </div>
          <h4 className="font-semibold text-foreground">{title}</h4>
        </div>
        <div className="flex-1 flex items-center justify-center py-8">
          <p className="text-sm text-muted-foreground">
            {locale === 'ua' ? 'Немає даних' : 'No data'}
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex-1 flex flex-col">
      <div className="flex items-center gap-3 mb-4">
        <div className={cn('rounded-lg p-2', iconBg)}>
          {icon}
        </div>
        <h4 className="font-semibold text-foreground">{title}</h4>
      </div>

      <div className="flex-1 min-h-[200px]">
        <ResponsiveContainer width="100%" height={200}>
          <BarChart
            data={chartData}
            layout="vertical"
            margin={{ top: 5, right: 20, left: 0, bottom: 5 }}
          >
            <XAxis
              type="number"
              axisLine={false}
              tickLine={false}
              tick={{ fontSize: 12, fill: '#9ca3af' }}
            />
            <YAxis
              type="category"
              dataKey="displayName"
              axisLine={false}
              tickLine={false}
              tick={{ fontSize: 12, fill: '#6b7280' }}
              width={120}
            />
            <Tooltip
              content={<CustomTooltip />}
              cursor={{ fill: 'rgba(0, 0, 0, 0.05)' }}
            />
            <Bar
              dataKey="pose_count"
              radius={[0, 6, 6, 0]}
              onMouseEnter={(_, index) => setHoveredIndex(index)}
              onMouseLeave={() => setHoveredIndex(null)}
            >
              {chartData.map((entry, index) => (
                <Cell
                  key={`cell-${index}`}
                  fill={entry.color}
                  opacity={hoveredIndex === null || hoveredIndex === index ? 1 : 0.5}
                  style={{
                    transition: 'opacity 0.2s ease',
                    cursor: 'pointer',
                  }}
                />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>

      {/* List view for small details */}
      <div className="mt-4 space-y-2">
        {chartData.map((muscle, index) => (
          <motion.div
            key={muscle.muscle_id}
            initial={{ opacity: 0, x: -10 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ delay: index * 0.05 }}
            className={cn(
              'flex items-center justify-between rounded-lg px-3 py-2 text-sm transition-colors',
              hoveredIndex === index ? 'bg-muted' : 'hover:bg-accent'
            )}
            onMouseEnter={() => setHoveredIndex(index)}
            onMouseLeave={() => setHoveredIndex(null)}
          >
            <div className="flex items-center gap-2">
              <div
                className="h-2 w-2 rounded-full"
                style={{ backgroundColor: muscle.color }}
              />
              <span className="text-foreground">{muscle.displayName}</span>
            </div>
            <div className="flex items-center gap-3 text-muted-foreground">
              <span>{muscle.pose_count} {locale === 'ua' ? 'поз' : 'poses'}</span>
              <span className="text-xs bg-muted px-2 py-0.5 rounded-full">
                {muscle.avg_activation_level.toFixed(0)}%
              </span>
            </div>
          </motion.div>
        ))}
      </div>
    </div>
  );
};

export const MuscleBarChart: React.FC<MuscleBarChartProps> = ({
  mostTrained,
  leastTrained,
  className,
}) => {
  const { locale } = useI18n();

  return (
    <div className={cn('grid grid-cols-1 lg:grid-cols-2 gap-8', className)}>
      <ChartSection
        title={locale === 'ua' ? 'Найчастіше тренуються' : 'Most Trained'}
        icon={<TrendingUp className="h-5 w-5 text-emerald-600" />}
        iconBg="bg-emerald-100"
        data={mostTrained}
        colors={MOST_TRAINED_COLORS}
      />
      <ChartSection
        title={locale === 'ua' ? 'Потребують уваги' : 'Need Attention'}
        icon={<TrendingDown className="h-5 w-5 text-rose-600" />}
        iconBg="bg-rose-100"
        data={leastTrained}
        colors={LEAST_TRAINED_COLORS}
      />
    </div>
  );
};

export default MuscleBarChart;
