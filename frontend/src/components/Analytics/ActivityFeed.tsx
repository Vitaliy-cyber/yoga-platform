import React from 'react';
import { Link } from 'react-router-dom';
import { motion } from 'framer-motion';
import { Plus, Edit2, Image, Clock, ArrowRight } from 'lucide-react';
import type { RecentActivity, ActivityAction } from '../../types';
import { useI18n, type Locale } from '../../i18n';
import { cn } from '../../lib/utils';

interface ActivityFeedProps {
  activities: RecentActivity[];
  className?: string;
}

// Icons and colors for different action types
const actionConfig: Record<
  ActivityAction,
  { icon: React.ElementType; color: string; bgColor: string; labelKey: "analytics.activity.created" | "analytics.activity.updated" | "analytics.activity.photo_generated" }
> = {
  created: {
    icon: Plus,
    color: 'text-emerald-600',
    bgColor: 'bg-emerald-100',
    labelKey: 'analytics.activity.created',
  },
  updated: {
    icon: Edit2,
    color: 'text-blue-600',
    bgColor: 'bg-blue-100',
    labelKey: 'analytics.activity.updated',
  },
  photo_generated: {
    icon: Image,
    color: 'text-violet-600',
    bgColor: 'bg-violet-100',
    labelKey: 'analytics.activity.photo_generated',
  },
};

// Format relative time using i18n formatRelativeTime function
const formatActivityTime = (timestamp: string, locale: Locale, formatRelativeTimeFn: (date: Date | string | number) => string): string => {
  const date = new Date(timestamp);

  // Validate the parsed date
  if (isNaN(date.getTime())) {
    return locale === 'ua' ? 'невідомо' : 'unknown';
  }

  return formatRelativeTimeFn(date);
};

interface ActivityItemProps {
  activity: RecentActivity;
  index: number;
}

const ActivityItem: React.FC<ActivityItemProps> = ({ activity, index }) => {
  const { locale, t, formatRelativeTime } = useI18n();
  const config = actionConfig[activity.action];
  const Icon = config.icon;

  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: index * 0.05 }}
    >
      <Link
        to={`/poses/${activity.id}`}
        className="group flex items-start gap-4 rounded-xl p-3 transition-all hover:bg-accent"
      >
        {/* Icon */}
        <div className={cn('rounded-lg p-2 transition-all group-hover:scale-110', config.bgColor)}>
          <Icon className={cn('h-4 w-4', config.color)} />
        </div>

        {/* Content */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className="font-medium text-foreground truncate">
              {activity.pose_name}
            </span>
            {activity.has_photo && (
              <span className="flex-shrink-0 h-2 w-2 rounded-full bg-emerald-500" title={t("analytics.has_photo")} />
            )}
          </div>
          <div className="mt-0.5 flex items-center gap-2 text-sm text-muted-foreground">
            <span className={cn('font-medium', config.color)}>
              {t(config.labelKey)}
            </span>
            <span>&middot;</span>
            <span className="text-xs text-muted-foreground/70">#{activity.pose_code}</span>
            {activity.category_name && (
              <>
                <span>&middot;</span>
                <span className="truncate">{activity.category_name}</span>
              </>
            )}
          </div>
        </div>

        {/* Time and arrow */}
        <div className="flex-shrink-0 flex items-center gap-2 text-muted-foreground/70">
          <div className="flex items-center gap-1 text-xs">
            <Clock className="h-3 w-3" />
            <span>{formatActivityTime(activity.timestamp, locale, formatRelativeTime)}</span>
          </div>
          <ArrowRight className="h-4 w-4 opacity-0 transition-all group-hover:opacity-100 group-hover:translate-x-1" />
        </div>
      </Link>
    </motion.div>
  );
};

export const ActivityFeed: React.FC<ActivityFeedProps> = ({
  activities,
  className,
}) => {
  const { t } = useI18n();

  if (activities.length === 0) {
    return (
      <div className={cn('flex items-center justify-center py-12', className)}>
        <div className="text-center">
          <div className="mx-auto mb-4 h-16 w-16 rounded-full bg-muted flex items-center justify-center">
            <Clock className="h-8 w-8 text-muted-foreground/70" />
          </div>
          <p className="text-sm text-muted-foreground">
            {t("analytics.no_activity")}
          </p>
          <p className="mt-1 text-xs text-muted-foreground/70">
            {t("analytics.no_activity_hint")}
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className={cn('space-y-1', className)}>
      {activities.map((activity, index) => (
        <ActivityItem key={`${activity.id}-${activity.timestamp}`} activity={activity} index={index} />
      ))}

      {/* View all link */}
      <Link
        to="/poses"
        className="flex items-center justify-center gap-2 rounded-lg p-3 text-sm font-medium text-primary transition-all hover:bg-primary/5"
      >
        {t("analytics.view_all_poses")}
        <ArrowRight className="h-4 w-4" />
      </Link>
    </div>
  );
};

export default ActivityFeed;
