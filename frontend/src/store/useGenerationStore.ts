import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";

import { generateApi, posesApi } from "../services/api";
import {
  createGenerationTransport,
  type GenerationTransportSnapshot,
} from "../services/generationTransport";
import { logger } from "../lib/logger";
import {
  broadcastInvalidation,
  useAppStore,
} from "./useAppStore";
import type {
  BackgroundGenerationTask,
  GenerationMode,
} from "../types";

interface StartFromPoseParams {
  poseId: number;
  poseName: string;
  mode: GenerationMode;
  additionalNotes?: string;
  generateMuscles?: boolean;
}

interface StartFromUploadParams extends StartFromPoseParams {
  file: File;
}

interface StartRegenerationParams extends StartFromPoseParams {
  schemaFile?: File;
  referencePhoto: File;
}

interface GenerationStoreState {
  tasks: Record<string, BackgroundGenerationTask>;
  taskOrder: string[];
  ownerUserId: number | null;
  bootstrapped: boolean;

  syncOwner: (userId: number | null) => void;
  bootstrap: () => void;
  startFromPose: (params: StartFromPoseParams) => Promise<string>;
  startFromUpload: (params: StartFromUploadParams) => Promise<string>;
  startRegenerationUpload: (params: StartRegenerationParams) => Promise<string>;
  retryApply: (taskId: string) => Promise<void>;
  dismissTask: (taskId: string) => void;
  clearDismissed: () => void;
}

const transportByTask = new Map<string, ReturnType<typeof createGenerationTransport>>();
const autoApplyInFlight = new Set<string>();

const isTaskProcessing = (status: BackgroundGenerationTask["status"]): boolean =>
  status === "pending" || status === "processing";

const isTaskTerminal = (status: BackgroundGenerationTask["status"]): boolean =>
  status === "completed" || status === "failed";

const now = () => Date.now();

const createTaskRecord = (
  taskId: string,
  poseId: number,
  poseName: string,
  mode: GenerationMode,
  generateMuscles: boolean,
  status: BackgroundGenerationTask["status"],
  progress: number,
  statusMessage: string | null,
): BackgroundGenerationTask => ({
  taskId,
  poseId,
  poseName,
  mode,
  generateMuscles,
  status,
  progress,
  statusMessage,
  errorMessage: null,
  photoUrl: null,
  musclesUrl: null,
  quotaWarning: false,
  analyzedMuscles: null,
  autoApplyStatus: "pending",
  autoApplyError: null,
  appliedAt: null,
  appliedPose: null,
  startedAt: now(),
  updatedAt: now(),
  dismissedAt: null,
});

export const selectLatestTaskForPose = (
  poseId: number,
  mode?: GenerationMode,
) =>
  (state: GenerationStoreState): BackgroundGenerationTask | null => {
    for (let i = state.taskOrder.length - 1; i >= 0; i -= 1) {
      const task = state.tasks[state.taskOrder[i]];
      if (!task || task.dismissedAt) continue;
      if (task.poseId !== poseId) continue;
      if (mode && task.mode !== mode) continue;
      return task;
    }
    return null;
  };

export const useGenerationStore = create<GenerationStoreState>()(
  persist(
    (set, get) => {
      const stopTaskTransport = (taskId: string) => {
        const transport = transportByTask.get(taskId);
        if (!transport) return;
        transport.stop();
        transportByTask.delete(taskId);
      };

      const connectTaskTransport = (taskId: string) => {
        if (transportByTask.has(taskId)) return;

        const transport = createGenerationTransport(taskId, {
          onUpdate: (snapshot: GenerationTransportSnapshot) => {
            const previous = get().tasks[taskId];
            if (!previous) {
              stopTaskTransport(taskId);
              return;
            }

            const wasCompleted = previous.status === "completed";

            set((state) => {
              const current = state.tasks[taskId];
              if (!current) return state;

              const nextStatus = snapshot.status ?? current.status;
              const nextProgress =
                nextStatus === "completed"
                  ? 100
                  : Math.max(current.progress, snapshot.progress ?? 0);

              return {
                tasks: {
                  ...state.tasks,
                  [taskId]: {
                    ...current,
                    status: nextStatus,
                    progress: nextProgress,
                    statusMessage: snapshot.statusMessage ?? current.statusMessage,
                    errorMessage: snapshot.errorMessage ?? current.errorMessage,
                    photoUrl: snapshot.photoUrl ?? current.photoUrl,
                    musclesUrl: snapshot.musclesUrl ?? current.musclesUrl,
                    quotaWarning: snapshot.quotaWarning ?? current.quotaWarning,
                    analyzedMuscles: snapshot.analyzedMuscles ?? current.analyzedMuscles,
                    updatedAt: now(),
                  },
                },
              };
            });

            const currentTask = get().tasks[taskId];
            if (
              currentTask &&
              !wasCompleted &&
              currentTask.status === "completed" &&
              currentTask.autoApplyStatus === "pending"
            ) {
              void runAutoApply(taskId, false);
            }
          },
          onTerminal: () => {
            stopTaskTransport(taskId);
          },
        });

        transportByTask.set(taskId, transport);
        void transport.start().catch((err) => {
          logger.error("Failed to start generation transport", err);
          stopTaskTransport(taskId);
          set((state) => {
            const task = state.tasks[taskId];
            if (!task) return state;
            return {
              tasks: {
                ...state.tasks,
                [taskId]: {
                  ...task,
                  status: "failed",
                  errorMessage:
                    err instanceof Error
                      ? err.message
                      : "Failed to track generation progress",
                  updatedAt: now(),
                },
              },
            };
          });
        });
      };

      const runAutoApply = async (taskId: string, force: boolean) => {
        const task = get().tasks[taskId];
        if (!task) return;
        if (!force && (task.autoApplyStatus === "applied" || task.autoApplyStatus === "applying")) {
          return;
        }
        if (autoApplyInFlight.has(taskId)) return;

        autoApplyInFlight.add(taskId);

        set((state) => {
          const current = state.tasks[taskId];
          if (!current) return state;
          return {
            tasks: {
              ...state.tasks,
              [taskId]: {
                ...current,
                autoApplyStatus: "applying",
                autoApplyError: null,
                updatedAt: now(),
              },
            },
          };
        });

        const maxAttempts = 10;

        try {
          const currentTask = get().tasks[taskId];
          if (!currentTask) return;

          let appliedPose = null;

          for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
            try {
              // eslint-disable-next-line no-await-in-loop
              appliedPose = await posesApi.applyGeneration(
                currentTask.poseId,
                taskId,
              );
              break;
            } catch (err) {
              const anyErr = err as Error & {
                status?: number;
                isRateLimited?: boolean;
                retryAfter?: number;
              };
              const statusCode = anyErr.status ?? (anyErr.isRateLimited ? 429 : undefined);
              const retryable =
                statusCode === 409 || statusCode === 429 || statusCode === 503;

              if (!retryable || attempt >= maxAttempts - 1) {
                throw err;
              }

              const retryAfterMs =
                statusCode === 429 &&
                anyErr.isRateLimited &&
                typeof anyErr.retryAfter === "number"
                  ? Math.max(250, Math.floor(anyErr.retryAfter * 1000))
                  : null;

              const backoffMs =
                Math.min(retryAfterMs ?? Math.min(250 * 2 ** attempt, 3000), 15_000) +
                Math.floor(Math.random() * 100);

              // eslint-disable-next-line no-await-in-loop
              await new Promise((resolve) => setTimeout(resolve, backoffMs));
            }
          }

          if (!appliedPose) {
            throw new Error("Failed to apply generated images");
          }

          set((state) => {
            const current = state.tasks[taskId];
            if (!current) return state;

            return {
              tasks: {
                ...state.tasks,
                [taskId]: {
                  ...current,
                  autoApplyStatus: "applied",
                  autoApplyError: null,
                  appliedAt: now(),
                  appliedPose,
                  updatedAt: now(),
                },
              },
            };
          });

          const appStore = useAppStore.getState();
          appStore.setPoses(
            appStore.poses.map((pose) =>
              pose.id === appliedPose.id
                ? {
                    ...pose,
                    category_id: appliedPose.category_id,
                    category_name: appliedPose.category_name,
                    schema_path: appliedPose.schema_path,
                    photo_path: appliedPose.photo_path,
                    version: appliedPose.version,
                  }
                : pose,
            ),
          );
          appStore.invalidatePoses();
          broadcastInvalidation();
        } catch (err) {
          const message =
            err instanceof Error ? err.message : "Failed to apply generation";

          set((state) => {
            const current = state.tasks[taskId];
            if (!current) return state;

            return {
              tasks: {
                ...state.tasks,
                [taskId]: {
                  ...current,
                  autoApplyStatus: "failed",
                  autoApplyError: message,
                  updatedAt: now(),
                },
              },
            };
          });

          logger.warn("Auto-apply generation failed", err);
        } finally {
          autoApplyInFlight.delete(taskId);
        }
      };

      const startTrackingTask = (
        task: BackgroundGenerationTask,
      ): BackgroundGenerationTask => {
        set((state) => {
          const nextOrder = state.taskOrder.includes(task.taskId)
            ? state.taskOrder
            : [...state.taskOrder, task.taskId];

          return {
            tasks: {
              ...state.tasks,
              [task.taskId]: task,
            },
            taskOrder: nextOrder,
          };
        });

        connectTaskTransport(task.taskId);
        return task;
      };

      const registerStartedTask = (
        response: {
          task_id: string;
          status: BackgroundGenerationTask["status"];
          progress: number;
          status_message: string | null;
        },
        params: {
          poseId: number;
          poseName: string;
          mode: GenerationMode;
          generateMuscles: boolean;
        }
      ): string => {
        const task = createTaskRecord(
          response.task_id,
          params.poseId,
          params.poseName,
          params.mode,
          params.generateMuscles,
          response.status,
          response.progress,
          response.status_message,
        );
        startTrackingTask(task);
        return response.task_id;
      };

      return {
        tasks: {},
        taskOrder: [],
        ownerUserId: null,
        bootstrapped: false,

        syncOwner: (userId: number | null) => {
          const normalizedUserId =
            typeof userId === "number" && Number.isFinite(userId) ? userId : null;
          const currentOwnerUserId = get().ownerUserId;
          if (currentOwnerUserId === normalizedUserId) {
            return;
          }

          const hasLegacyUnownedTasks =
            currentOwnerUserId === null &&
            normalizedUserId !== null &&
            get().taskOrder.length > 0;
          const shouldClearTasks =
            normalizedUserId === null ||
            currentOwnerUserId !== null ||
            hasLegacyUnownedTasks;
          if (shouldClearTasks) {
            const taskIds = [...get().taskOrder];
            taskIds.forEach((taskId) => stopTaskTransport(taskId));
            set({
              tasks: {},
              taskOrder: [],
              ownerUserId: normalizedUserId,
            });
            return;
          }

          set({ ownerUserId: normalizedUserId });
        },

        bootstrap: () => {
          if (get().bootstrapped) return;

          set({ bootstrapped: true });

          const state = get();
          for (const taskId of state.taskOrder) {
            const task = state.tasks[taskId];
            if (!task || task.dismissedAt) continue;

            if (isTaskProcessing(task.status)) {
              connectTaskTransport(task.taskId);
              continue;
            }

            if (
              task.status === "completed" &&
              (task.autoApplyStatus === "pending" ||
                task.autoApplyStatus === "applying")
            ) {
              void runAutoApply(task.taskId, false);
            }
          }
        },

        startFromPose: async ({
          poseId,
          poseName,
          mode,
          additionalNotes,
          generateMuscles,
        }) => {
          const shouldGenerateMuscles = generateMuscles ?? true;
          const response = await generateApi.generateFromPose(
            poseId,
            additionalNotes,
            shouldGenerateMuscles
          );
          return registerStartedTask(response, {
            poseId,
            poseName,
            mode,
            generateMuscles: shouldGenerateMuscles,
          });
        },

        startFromUpload: async ({
          poseId,
          poseName,
          mode,
          file,
          additionalNotes,
          generateMuscles,
        }) => {
          const shouldGenerateMuscles = generateMuscles ?? true;
          // Persist the uploaded source image as pose schema first, so the pose
          // always keeps the latest input reference after generation is applied.
          const updatedPose = await posesApi.uploadSchema(poseId, file);
          const appStore = useAppStore.getState();
          appStore.setPoses(
            appStore.poses.map((pose) =>
              pose.id === updatedPose.id
                ? {
                    ...pose,
                    category_id: updatedPose.category_id,
                    category_name: updatedPose.category_name,
                    schema_path: updatedPose.schema_path,
                    version: updatedPose.version,
                  }
                : pose,
            ),
          );
          appStore.invalidatePoses();
          broadcastInvalidation();

          const response = await generateApi.generate(
            file,
            additionalNotes,
            shouldGenerateMuscles
          );
          return registerStartedTask(response, {
            poseId,
            poseName,
            mode,
            generateMuscles: shouldGenerateMuscles,
          });
        },

        startRegenerationUpload: async ({
          poseId,
          poseName,
          mode,
          schemaFile,
          referencePhoto,
          additionalNotes,
          generateMuscles,
        }) => {
          const shouldGenerateMuscles = generateMuscles ?? true;
          const response = await generateApi.regenerate({
            schemaFile,
            referencePhoto,
            additionalNotes,
            generateMuscles: shouldGenerateMuscles,
          });
          return registerStartedTask(response, {
            poseId,
            poseName,
            mode,
            generateMuscles: shouldGenerateMuscles,
          });
        },

        retryApply: async (taskId: string) => {
          const task = get().tasks[taskId];
          if (!task) return;
          if (!isTaskTerminal(task.status) || task.status !== "completed") return;
          await runAutoApply(taskId, true);
        },

        dismissTask: (taskId: string) => {
          set((state) => {
            const task = state.tasks[taskId];
            if (!task) return state;
            if (isTaskProcessing(task.status) || task.autoApplyStatus === "applying") {
              return state;
            }
            stopTaskTransport(taskId);
            return {
              tasks: {
                ...state.tasks,
                [taskId]: {
                  ...task,
                  dismissedAt: now(),
                  updatedAt: now(),
                },
              },
            };
          });
        },

        clearDismissed: () => {
          set((state) => {
            const nextTasks: Record<string, BackgroundGenerationTask> = {};
            const nextOrder: string[] = [];

            for (const taskId of state.taskOrder) {
              const task = state.tasks[taskId];
              if (!task || task.dismissedAt) {
                stopTaskTransport(taskId);
                continue;
              }
              nextTasks[taskId] = task;
              nextOrder.push(taskId);
            }

            return {
              tasks: nextTasks,
              taskOrder: nextOrder,
            };
          });
        },
      };
    },
    {
      name: "yoga-generation-tasks",
      storage: createJSONStorage(() => sessionStorage),
      partialize: (state) => ({
        tasks: state.tasks,
        taskOrder: state.taskOrder,
        ownerUserId: state.ownerUserId,
      }),
    },
  ),
);
