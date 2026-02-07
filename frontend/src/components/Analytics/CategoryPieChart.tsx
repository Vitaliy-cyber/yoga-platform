import React, { useState } from 'react';
import { motion } from 'framer-motion';
import {
  PieChart,
  Pie,
  Cell,
  Tooltip,
  ResponsiveContainer,
} from 'recharts';
import type { CategoryStats } from '../../types';
import { useI18n } from '../../i18n';
import { cn } from '../../lib/utils';

interface CategoryPieChartProps {
  categories: CategoryStats[];
  className?: string;
}

// Attractive color palette for pie chart segments
const COLORS = [
  '#6366f1', // indigo
  '#8b5cf6', // violet
  '#ec4899', // pink
  '#f43f5e', // rose
  '#f97316', // orange
  '#eab308', // yellow
  '#22c55e', // green
  '#14b8a6', // teal
  '#06b6d4', // cyan
  '#3b82f6', // blue
];

interface CustomTooltipProps {
  active?: boolean;
  payload?: Array<{
    name: string;
    value: number;
    payload: {
      name: string;
      pose_count: number;
      percentage: number;
      poses_with_photos: number;
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
      className="rounded-xl bg-card px-4 py-3 shadow-lg ring-1 ring-black/5 z-30"
    >
      <p className="font-semibold text-foreground">{data.name}</p>
      <div className="mt-2 space-y-1 text-sm text-muted-foreground">
        <p>
          {locale === 'ua' ? 'Поз:' : 'Poses:'}{' '}
          <span className="font-medium text-foreground">{data.pose_count}</span>
        </p>
        <p>
          {locale === 'ua' ? 'Частка:' : 'Share:'}{' '}
          <span className="font-medium text-foreground">{data.percentage.toFixed(1)}%</span>
        </p>
        <p>
          {locale === 'ua' ? 'З фото:' : 'With photos:'}{' '}
          <span className="font-medium text-foreground">{data.poses_with_photos}</span>
        </p>
      </div>
    </motion.div>
  );
};

interface LegendItemProps {
  color: string;
  name: string;
  value: number;
  percentage: number;
  isSelected: boolean;
  onClick: () => void;
}

const LegendItem: React.FC<LegendItemProps> = ({
  color,
  name,
  value,
  percentage,
  isSelected,
  onClick,
}) => (
  <button
    onClick={onClick}
    className={cn(
      'flex w-full items-center justify-between rounded-xl border border-transparent px-3 py-2.5 min-h-[42px] text-left transition-[background-color,border-color,box-shadow,transform] duration-200 ease-out',
      isSelected
        ? 'bg-muted border-primary/30 shadow-[inset_0_0_0_1px_rgba(99,102,241,0.18)]'
        : 'hover:bg-accent hover:border-border/60'
    )}
  >
    <div className="flex min-w-0 items-center gap-2">
      <div
        className="h-3 w-3 rounded-full flex-shrink-0"
        style={{ backgroundColor: color }}
      />
      <span className="truncate text-sm font-medium leading-tight text-foreground">{name}</span>
    </div>
    <div className="ml-3 flex flex-shrink-0 items-center gap-3">
      <span className="text-sm tabular-nums text-muted-foreground">{value}</span>
      <span className="min-w-[52px] whitespace-nowrap rounded-full bg-muted px-2 py-0.5 text-center text-xs font-medium tabular-nums text-muted-foreground">
        {percentage.toFixed(1)}%
      </span>
    </div>
  </button>
);

export const CategoryPieChart: React.FC<CategoryPieChartProps> = ({
  categories,
  className,
}) => {
  const { locale } = useI18n();
  const [selectedCategory, setSelectedCategory] = useState<string | null>(null);

  // Prepare data for the chart
  const chartData = categories.map((cat, index) => ({
    ...cat,
    color: COLORS[index % COLORS.length],
  }));

  // Handle empty state
  if (categories.length === 0) {
    return (
      <div className={cn('flex items-center justify-center py-12', className)}>
        <div className="text-center">
          <div className="mx-auto mb-4 h-16 w-16 rounded-full bg-muted flex items-center justify-center">
            <svg
              className="h-8 w-8 text-muted-foreground/70"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={1.5}
                d="M11 3.055A9.001 9.001 0 1020.945 13H11V3.055z"
              />
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={1.5}
                d="M20.488 9H15V3.512A9.025 9.025 0 0120.488 9z"
              />
            </svg>
          </div>
          <p className="text-sm text-muted-foreground">
            {locale === 'ua' ? 'Немає категорій' : 'No categories'}
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className={cn('flex flex-col lg:flex-row gap-6', className)}>
      {/* Pie Chart */}
      <div className="relative flex-1 min-h-[280px]">
        <ResponsiveContainer width="100%" height={280}>
          <PieChart>
            <Pie
              data={chartData}
              cx="50%"
              cy="50%"
              innerRadius={60}
              outerRadius={100}
              paddingAngle={2}
              dataKey="pose_count"
              nameKey="name"
              animationBegin={0}
              animationDuration={800}
              onMouseEnter={(_, index) =>
                setSelectedCategory(chartData[index].name)
              }
              onMouseLeave={() => setSelectedCategory(null)}
            >
              {chartData.map((entry, index) => (
                <Cell
                  key={`cell-${index}`}
                  fill={entry.color}
                  stroke="#fff"
                  strokeWidth={2}
                  opacity={
                    selectedCategory === null ||
                    selectedCategory === entry.name
                      ? 1
                      : 0.3
                  }
                  style={{
                    filter:
                      selectedCategory === entry.name
                        ? 'drop-shadow(0 4px 6px rgba(0, 0, 0, 0.1))'
                        : 'none',
                    transition: 'opacity 0.2s ease, filter 0.2s ease',
                    cursor: 'pointer',
                  }}
                />
              ))}
            </Pie>
            <Tooltip content={<CustomTooltip />} wrapperStyle={{ zIndex: 30, pointerEvents: 'none' }} />
          </PieChart>
        </ResponsiveContainer>

        {/* Center label */}
        <div className="pointer-events-none absolute inset-0 z-[1] flex items-center justify-center">
          <div className="text-center">
            <p className="text-3xl font-bold text-foreground">
              {categories.reduce((sum, cat) => sum + cat.pose_count, 0)}
            </p>
            <p className="text-sm text-muted-foreground">
              {locale === 'ua' ? 'всього поз' : 'total poses'}
            </p>
          </div>
        </div>
      </div>

      {/* Legend */}
      <div className="lg:w-64 space-y-1.5 max-h-[300px] overflow-y-auto overflow-x-hidden scrollbar-hide py-1 pr-1">
        {chartData.map((cat) => (
          <LegendItem
            key={cat.id}
            color={cat.color}
            name={cat.name}
            value={cat.pose_count}
            percentage={cat.percentage}
            isSelected={selectedCategory === cat.name}
            onClick={() =>
              setSelectedCategory(
                selectedCategory === cat.name ? null : cat.name
              )
            }
          />
        ))}
      </div>
    </div>
  );
};

export default CategoryPieChart;
