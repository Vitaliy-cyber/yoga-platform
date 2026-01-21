import React, { useEffect, useState, useRef, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  BarChart3,
  Image,
  Layers,
  FolderOpen,
  Activity,
  Dumbbell,
  RefreshCw,
  AlertCircle,
} from 'lucide-react';
import { Button } from '../components/ui/button';
import {
  StatCard,
  CategoryPieChart,
  MuscleBarChart,
  ActivityFeed,
  BodyPartBalanceChart,
} from '../components/Analytics';
import { analyticsApi } from '../services/api';
import type { AnalyticsSummary } from '../types';
import { useI18n } from '../i18n';
import { useViewTransition } from '../hooks/useViewTransition';
import { cn } from '../lib/utils';

// Error boundary wrapper for chart components
interface ChartErrorBoundaryProps {
  children: React.ReactNode;
  fallback?: React.ReactNode;
}

interface ChartErrorBoundaryState {
  hasError: boolean;
  error: Error | null;
}

class ChartErrorBoundary extends React.Component<ChartErrorBoundaryProps, ChartErrorBoundaryState> {
  constructor(props: ChartErrorBoundaryProps) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error): ChartErrorBoundaryState {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: React.ErrorInfo): void {
    console.error('Chart rendering error:', error, errorInfo);
  }

  render(): React.ReactNode {
    if (this.state.hasError) {
      return (
        this.props.fallback || (
          <div className="flex flex-col items-center justify-center py-8 text-muted-foreground">
            <AlertCircle className="h-8 w-8 mb-2 text-rose-400" />
            <p className="text-sm">Failed to render chart</p>
          </div>
        )
      );
    }

    return this.props.children;
  }
}

export const AnalyticsDashboard: React.FC = () => {
  const { locale, t } = useI18n();
  const { startTransition } = useViewTransition();
  const [data, setData] = useState<AnalyticsSummary | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Use a ref to track the current request and prevent race conditions
  // when multiple rapid clicks trigger concurrent requests
  const abortControllerRef = useRef<AbortController | null>(null);
  const requestIdRef = useRef<number>(0);

  const fetchData = useCallback(async () => {
    // Cancel any in-flight request to prevent race conditions
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
    }

    // Create new abort controller for this request
    const abortController = new AbortController();
    abortControllerRef.current = abortController;

    // Track request ID to ignore stale responses
    const currentRequestId = ++requestIdRef.current;

    startTransition(() => setIsLoading(true));
    setError(null);

    try {
      const summary = await analyticsApi.getSummary(abortController.signal);

      // Only update state if this is still the most recent request
      // and the request wasn't aborted
      if (currentRequestId === requestIdRef.current && !abortController.signal.aborted) {
        setData(summary);
      }
    } catch (err) {
      // Ignore aborted requests
      if (err instanceof Error && err.name === 'AbortError') {
        return;
      }

      // Only update error state if this is still the most recent request
      if (currentRequestId === requestIdRef.current) {
        console.error('Failed to fetch analytics data:', err);
        setError(t("analytics.error"));
      }
    } finally {
      // Only update loading state if this is still the most recent request
      if (currentRequestId === requestIdRef.current) {
        setIsLoading(false);
      }
    }
  }, [locale]);

  useEffect(() => {
    fetchData();

    // Cleanup: abort any pending request when component unmounts
    return () => {
      if (abortControllerRef.current) {
        abortControllerRef.current.abort();
      }
    };
  }, [fetchData]);

  // Loading state
  if (isLoading) {
    return (
      <div className="min-h-screen bg-background">
        <div className="max-w-7xl mx-auto px-6 py-8">
          <AnimatePresence mode="wait">
            <motion.div
              key="loading"
              className="flex items-center justify-center py-20"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.2 }}
            >
              <motion.div
                animate={{ rotate: 360 }}
                transition={{ duration: 1, repeat: Infinity, ease: 'linear' }}
              >
                <RefreshCw className="h-8 w-8 text-primary" />
              </motion.div>
            </motion.div>
          </AnimatePresence>
        </div>
      </div>
    );
  }

  // Error state
  if (error) {
    return (
      <div className="min-h-screen bg-background">
        <div className="max-w-7xl mx-auto px-6 py-8">
          <AnimatePresence mode="wait">
            <motion.div
              key="error"
              className="flex flex-col items-center justify-center py-20"
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -20 }}
              transition={{ duration: 0.2 }}
            >
              <div className="rounded-full bg-rose-100 p-4 mb-4">
                <AlertCircle className="h-8 w-8 text-rose-600" />
              </div>
              <h3 className="text-lg font-semibold text-foreground mb-2">{error}</h3>
              <Button onClick={fetchData} variant="outline" className="mt-4">
                <RefreshCw className="h-4 w-4 mr-2" />
                {t("analytics.try_again")}
              </Button>
            </motion.div>
          </AnimatePresence>
        </div>
      </div>
    );
  }

  if (!data) return null;

  const { overview, muscle_heatmap, categories, recent_activity, body_part_balance } = data;

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <header className="bg-card border-b border-border sticky top-0 z-40">
        <div className="max-w-7xl mx-auto px-6 py-4">
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-2xl font-semibold text-foreground">
                {locale === 'ua' ? 'Аналітика' : 'Analytics'}
              </h1>
              <p className="text-muted-foreground text-sm mt-0.5">
                {locale === 'ua'
                  ? 'Статистика та візуалізація ваших поз'
                  : 'Statistics and visualization of your poses'}
              </p>
            </div>
            <Button
              onClick={fetchData}
              variant="outline"
              className="rounded-xl"
              disabled={isLoading}
            >
              <RefreshCw className={cn('h-4 w-4 mr-2', isLoading && 'animate-spin')} />
              {locale === 'ua' ? 'Оновити' : 'Refresh'}
            </Button>
          </div>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-6 py-8 space-y-8">
        {/* Overview Stats */}
        <section>
          <h2 className="text-lg font-semibold text-foreground mb-4 flex items-center gap-2">
            <BarChart3 className="h-5 w-5 text-primary" />
            {locale === 'ua' ? 'Загальний огляд' : 'Overview'}
          </h2>
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
            <StatCard
              title={locale === 'ua' ? 'Всього поз' : 'Total Poses'}
              value={overview.total_poses}
              icon={Layers}
              color="primary"
              delay={0}
            />
            <StatCard
              title={locale === 'ua' ? 'Категорій' : 'Categories'}
              value={overview.total_categories}
              icon={FolderOpen}
              color="info"
              delay={1}
            />
            <StatCard
              title={locale === 'ua' ? 'З фото' : 'With Photos'}
              value={overview.poses_with_photos}
              subtitle={`${(overview.completion_rate ?? 0).toFixed(0)}% ${locale === 'ua' ? 'завершено' : 'complete'}`}
              icon={Image}
              color="success"
              delay={2}
            />
            <StatCard
              title={locale === 'ua' ? "З м'язами" : 'With Muscles'}
              value={overview.poses_with_muscles}
              icon={Dumbbell}
              color="warning"
              delay={3}
            />
          </div>
        </section>

        {/* Main Content Grid */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
          {/* Left Column - Charts */}
          <div className="lg:col-span-2 space-y-8">
            {/* Category Distribution */}
            <motion.section
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.2 }}
              className="bg-card rounded-2xl p-6 shadow-sm ring-1 ring-black/5"
            >
              <h3 className="text-lg font-semibold text-foreground mb-4 flex items-center gap-2">
                <FolderOpen className="h-5 w-5 text-primary" />
                {locale === 'ua' ? 'Розподіл по категоріях' : 'Category Distribution'}
              </h3>
              <ChartErrorBoundary>
                <CategoryPieChart categories={categories} />
              </ChartErrorBoundary>
            </motion.section>

            {/* Muscle Training Balance */}
            <motion.section
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.3 }}
              className="bg-card rounded-2xl p-6 shadow-sm ring-1 ring-black/5"
            >
              <h3 className="text-lg font-semibold text-foreground mb-4 flex items-center gap-2">
                <Dumbbell className="h-5 w-5 text-primary" />
                {locale === 'ua' ? "Баланс тренування м'язів" : 'Muscle Training Balance'}
              </h3>
              <ChartErrorBoundary>
                <MuscleBarChart
                  mostTrained={muscle_heatmap.most_trained}
                  leastTrained={muscle_heatmap.least_trained}
                />
              </ChartErrorBoundary>
            </motion.section>
          </div>

          {/* Right Column - Activity & Balance */}
          <div className="space-y-8">
            {/* Body Part Balance */}
            <motion.section
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.4 }}
              className="bg-card rounded-2xl p-6 shadow-sm ring-1 ring-black/5"
            >
              <h3 className="text-lg font-semibold text-foreground mb-4 flex items-center gap-2">
                <Activity className="h-5 w-5 text-primary" />
                {locale === 'ua' ? 'Баланс частин тіла' : 'Body Part Balance'}
              </h3>
              <ChartErrorBoundary>
                <BodyPartBalanceChart
                  balanceData={body_part_balance}
                  balanceScore={muscle_heatmap.balance_score}
                />
              </ChartErrorBoundary>
            </motion.section>

            {/* Recent Activity */}
            <motion.section
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.5 }}
              className="bg-card rounded-2xl p-6 shadow-sm ring-1 ring-black/5"
            >
              <h3 className="text-lg font-semibold text-foreground mb-4">
                {locale === 'ua' ? 'Остання активність' : 'Recent Activity'}
              </h3>
              <ActivityFeed activities={recent_activity} />
            </motion.section>
          </div>
        </div>

      </main>
    </div>
  );
};

export default AnalyticsDashboard;
