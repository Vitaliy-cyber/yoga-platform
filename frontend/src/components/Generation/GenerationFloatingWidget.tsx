import React, { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Loader2, X, RefreshCw, ExternalLink, ChevronDown, CheckCircle2, AlertCircle } from "lucide-react";

import { Button } from "../ui/button";
import { useGenerationStore } from "../../store/useGenerationStore";
import { useI18n } from "../../i18n";
import type { BackgroundGenerationTask } from "../../types";
import { cn } from "../../lib/utils";

const isProcessing = (task: BackgroundGenerationTask): boolean =>
  task.status === "pending" || task.status === "processing";

const isActionable = (task: BackgroundGenerationTask): boolean =>
  task.autoApplyStatus === "failed" ||
  task.autoApplyStatus === "applied" ||
  task.status === "failed";

const WIDGET_EXIT_ANIMATION_MS = 220;

type RenderedWidgetTask = {
  task: BackgroundGenerationTask;
  isExiting: boolean;
};

export const GenerationFloatingWidget: React.FC = () => {
  const navigate = useNavigate();
  const { t } = useI18n();
  const [collapsedTasks, setCollapsedTasks] = useState<Record<string, boolean>>({});
  const [renderedTasks, setRenderedTasks] = useState<RenderedWidgetTask[]>([]);
  const [animatingTasks, setAnimatingTasks] = useState<Record<string, boolean>>({});
  const [frozenTasks, setFrozenTasks] = useState<Record<string, BackgroundGenerationTask>>({});
  const exitTimersRef = useRef<Record<string, number>>({});
  const collapseTimersRef = useRef<Record<string, number>>({});

  const tasks = useGenerationStore((state) => state.tasks);
  const taskOrder = useGenerationStore((state) => state.taskOrder);
  const dismissTask = useGenerationStore((state) => state.dismissTask);
  const retryApply = useGenerationStore((state) => state.retryApply);
  const bootstrap = useGenerationStore((state) => state.bootstrap);

  useEffect(() => {
    bootstrap();
  }, [bootstrap]);

  const visibleTasks = useMemo(() => {
    const mapped = [...taskOrder]
      .reverse()
      .map((taskId) => tasks[taskId])
      .filter((task): task is BackgroundGenerationTask => Boolean(task && !task.dismissedAt));

    return mapped.slice(0, 4);
  }, [taskOrder, tasks]);

  useEffect(() => {
    setCollapsedTasks((prev) => {
      const next: Record<string, boolean> = {};
      for (const task of visibleTasks) {
        if (prev[task.taskId]) {
          next[task.taskId] = true;
        }
      }

      const prevKeys = Object.keys(prev);
      const nextKeys = Object.keys(next);
      if (prevKeys.length !== nextKeys.length) {
        return next;
      }
      for (const key of prevKeys) {
        if (prev[key] !== next[key]) {
          return next;
        }
      }
      return prev;
    });
  }, [visibleTasks]);

  useEffect(() => {
    setRenderedTasks((prev) => {
      const next: RenderedWidgetTask[] = [];
      const visibleById = new Map<string, BackgroundGenerationTask>(
        visibleTasks.map((task) => [task.taskId, task]),
      );
      const consumed = new Set<string>();

      // Keep previous visual order to avoid jumpy reordering.
      for (const entry of prev) {
        const visibleTask = visibleById.get(entry.task.taskId);
        if (visibleTask) {
          consumed.add(entry.task.taskId);
          next.push({ task: visibleTask, isExiting: false });
          const existingTimer = exitTimersRef.current[entry.task.taskId];
          if (existingTimer) {
            window.clearTimeout(existingTimer);
            delete exitTimersRef.current[entry.task.taskId];
          }
          continue;
        }

        next.push({ task: entry.task, isExiting: true });
      }

      // Append only truly new tasks.
      for (const task of visibleTasks) {
        if (consumed.has(task.taskId)) continue;
        next.push({ task, isExiting: false });
      }

      return next.slice(0, 4);
    });
  }, [visibleTasks]);

  useEffect(() => {
    const renderedIds = new Set(renderedTasks.map((entry) => entry.task.taskId));

    for (const entry of renderedTasks) {
      const taskId = entry.task.taskId;
      const timer = exitTimersRef.current[taskId];
      if (entry.isExiting && !timer) {
        exitTimersRef.current[taskId] = window.setTimeout(() => {
          setRenderedTasks((prev) => prev.filter((item) => item.task.taskId !== taskId));
          delete exitTimersRef.current[taskId];
        }, WIDGET_EXIT_ANIMATION_MS);
      }
      if (!entry.isExiting && timer) {
        window.clearTimeout(timer);
        delete exitTimersRef.current[taskId];
      }
    }

    for (const [taskId, timer] of Object.entries(exitTimersRef.current)) {
      if (!renderedIds.has(taskId)) {
        window.clearTimeout(timer);
        delete exitTimersRef.current[taskId];
      }
    }
  }, [renderedTasks]);

  useEffect(() => {
    return () => {
      for (const timer of Object.values(exitTimersRef.current)) {
        window.clearTimeout(timer);
      }
      exitTimersRef.current = {};
      for (const timer of Object.values(collapseTimersRef.current)) {
        window.clearTimeout(timer);
      }
      collapseTimersRef.current = {};
    };
  }, []);

  useEffect(() => {
    const visibleIds = new Set(visibleTasks.map((task) => task.taskId));

    setAnimatingTasks((prev) => {
      let changed = false;
      const next = { ...prev };
      for (const taskId of Object.keys(next)) {
        if (!visibleIds.has(taskId)) {
          delete next[taskId];
          changed = true;
        }
      }
      return changed ? next : prev;
    });

    setFrozenTasks((prev) => {
      let changed = false;
      const next = { ...prev };
      for (const taskId of Object.keys(next)) {
        if (!visibleIds.has(taskId)) {
          delete next[taskId];
          changed = true;
        }
      }
      return changed ? next : prev;
    });
  }, [visibleTasks]);

  const handleToggleCollapse = (task: BackgroundGenerationTask) => {
    const taskId = task.taskId;

    setCollapsedTasks((prev) => ({
      ...prev,
      [taskId]: !prev[taskId],
    }));

    // Freeze dynamic values while the height animation is running.
    setFrozenTasks((prev) => ({
      ...prev,
      [taskId]: { ...task },
    }));
    setAnimatingTasks((prev) => ({
      ...prev,
      [taskId]: true,
    }));

    const existingTimer = collapseTimersRef.current[taskId];
    if (existingTimer) {
      window.clearTimeout(existingTimer);
    }
    collapseTimersRef.current[taskId] = window.setTimeout(() => {
      setAnimatingTasks((prev) => {
        const next = { ...prev };
        delete next[taskId];
        return next;
      });
      setFrozenTasks((prev) => {
        const next = { ...prev };
        delete next[taskId];
        return next;
      });
      delete collapseTimersRef.current[taskId];
    }, 320);
  };

  if (renderedTasks.length === 0) {
    return null;
  }

  return (
    <aside
      className="fixed bottom-4 right-4 z-50 w-[min(92vw,380px)] flex flex-col"
      data-generation-floating-root="true"
    >
      {renderedTasks.map(({ task, isExiting }) => {
        const isAnimating = Boolean(animatingTasks[task.taskId]);
        const visualTask =
          isAnimating && frozenTasks[task.taskId] ? frozenTasks[task.taskId] : task;

        const busy = isProcessing(visualTask) || visualTask.autoApplyStatus === "applying";
        const failed =
          visualTask.status === "failed" || visualTask.autoApplyStatus === "failed";
        const completed = !busy && !failed;
        const progressValue = Math.min(visualTask.progress, 100);
        const isRegenerate = visualTask.mode === "regenerate";
        const regenerateBusy = isRegenerate && busy;
        const isCollapsed = Boolean(collapsedTasks[task.taskId]);
        const canDismiss = !busy && (failed || isActionable(visualTask));

        const statusText = busy
          ? visualTask.autoApplyStatus === "applying"
            ? t("generate.bg.applying")
            : (visualTask.statusMessage || t("generate.bg.processing"))
          : failed
            ? (visualTask.autoApplyError || visualTask.errorMessage || t("generate.bg.failed"))
            : t("generate.bg.completed");

        return (
          <div
            key={task.taskId}
            className={cn(
              "generation-widget-item",
              isExiting && "generation-widget-item--exit pointer-events-none"
            )}
          >
          <div
            className={cn(
              "generation-widget-card rounded-2xl border shadow-lg p-3",
              failed
                ? "border-red-200 bg-red-50/95"
                : isRegenerate
                  ? "border-amber-200 bg-gradient-to-br from-amber-50/85 to-orange-50/80"
                  : "border-stone-200 bg-white",
              regenerateBusy && "generation-widget-card--regenerate"
            )}
            data-testid="generation-floating-widget"
          >
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0 flex-1">
                <p className="text-sm font-semibold text-stone-900 truncate">
                  {visualTask.poseName}
                </p>
                <span className={cn(
                  "mt-1 inline-flex max-w-full items-center rounded-full px-2 py-0.5 text-[11px] font-medium leading-none",
                  isRegenerate ? "bg-amber-100 text-amber-800" : "bg-stone-100 text-stone-600"
                )}>
                  {visualTask.mode === "regenerate"
                    ? t("generate.bg.mode_regenerate")
                    : t("generate.bg.mode_generate")}
                </span>
                <div className="mt-1 h-4 flex items-center gap-2 text-xs text-stone-600">
                  <p
                    className={cn(
                      "truncate transition-opacity duration-150",
                      isCollapsed ? "opacity-100" : "opacity-0"
                    )}
                    aria-hidden={!isCollapsed}
                  >
                    {statusText}
                  </p>
                  {isProcessing(visualTask) ? (
                    <span
                      className={cn(
                        "ml-auto tabular-nums text-stone-500 transition-opacity duration-150",
                        isCollapsed ? "opacity-100" : "opacity-0"
                      )}
                      aria-hidden={!isCollapsed}
                    >
                      {progressValue}%
                    </span>
                  ) : null}
                </div>
              </div>
              <div className="flex items-center gap-1">
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="h-7 w-7 p-0 text-stone-500 hover:text-stone-700"
                  onClick={() => handleToggleCollapse(task)}
                  aria-label={isCollapsed ? t("aria.expand_menu") : t("aria.collapse_menu")}
                  title={isCollapsed ? t("aria.expand_menu") : t("aria.collapse_menu")}
                >
                  <ChevronDown
                    className={cn(
                      "h-4 w-4 transition-transform duration-200 ease-out",
                      isCollapsed ? "-rotate-90" : "rotate-0"
                    )}
                  />
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className={cn(
                    "h-7 w-7 p-0 text-stone-500 transition-opacity duration-200",
                    canDismiss ? "opacity-100" : "opacity-0 pointer-events-none"
                  )}
                  onClick={() => dismissTask(task.taskId)}
                  aria-label={t("generate.bg.dismiss")}
                >
                  <X className="h-4 w-4" />
                </Button>
              </div>
            </div>

            <div
              className={cn(
                "overflow-hidden transition-[max-height,opacity,margin-top] duration-300 ease-out will-change-[max-height,opacity]",
                isCollapsed
                  ? "max-h-0 opacity-0 mt-0 pointer-events-none"
                  : "max-h-44 opacity-100 mt-2"
              )}
              aria-hidden={isCollapsed}
            >
              <div className="generation-widget-body-inner">
                <div className={cn(
                  "flex items-center gap-2 text-xs",
                  failed ? "text-red-700" : regenerateBusy ? "text-amber-800" : "text-stone-600"
                )}>
                  {busy ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : failed ? (
                    <AlertCircle className="h-3.5 w-3.5" />
                  ) : completed ? (
                    <CheckCircle2 className="h-3.5 w-3.5 text-emerald-600" />
                  ) : null}
                  <span className="generation-widget-status-text truncate">
                    {statusText}
                  </span>
                  {isProcessing(visualTask) ? (
                    <span className="ml-auto text-stone-500 tabular-nums">{progressValue}%</span>
                  ) : null}
                </div>

                <div
                  className={cn(
                    "mt-2 h-1.5 transition-opacity duration-200",
                    isProcessing(visualTask) ? "opacity-100" : "opacity-0"
                  )}
                  aria-hidden={!isProcessing(visualTask)}
                >
                  <div className={cn(
                    "generation-widget-progress h-1.5 rounded-full overflow-hidden",
                    regenerateBusy ? "bg-amber-200/80" : "bg-stone-200"
                  )}>
                    <div
                      className={cn(
                        "generation-widget-progress-fill h-full rounded-full",
                        regenerateBusy
                          ? "bg-gradient-to-r from-amber-500 via-orange-500 to-amber-600"
                          : "bg-stone-800"
                      )}
                      style={{ width: `${progressValue}%` }}
                    />
                  </div>
                </div>

                <div className="mt-3 flex items-center gap-2">
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="h-8 text-xs shrink-0 whitespace-nowrap transition-none"
                    onClick={() => navigate(`/poses/${visualTask.poseId}`)}
                  >
                    <ExternalLink className="w-3.5 h-3.5 mr-1" />
                    {t("generate.bg.open_pose")}
                  </Button>

                  {visualTask.autoApplyStatus === "failed" ? (
                    <Button
                      type="button"
                      size="sm"
                      className="h-8 text-xs"
                      onClick={() => void retryApply(task.taskId)}
                    >
                      <RefreshCw className="w-3.5 h-3.5 mr-1" />
                      {t("generate.bg.retry_apply")}
                    </Button>
                  ) : null}
                </div>
              </div>
            </div>
          </div>
          </div>
        );
      })}
    </aside>
  );
};
