import { useState, useCallback, useRef, useEffect } from "react";
import { generateApi } from "../services/api";
import {
  createGenerationTransport,
  type GenerationTransportSnapshot,
} from "../services/generationTransport";
import { useAppStore } from "../store/useAppStore";
import type { AnalyzedMuscle, GenerateStatus } from "../types";
import { useI18n } from "../i18n";

interface GenerationState {
  isGenerating: boolean;
  progress: number;
  status: GenerateStatus | null;
  statusMessage: string | null;
  error: string | null;
  photoUrl: string | null;
  musclesUrl: string | null;
  quotaWarning: boolean;
  analyzedMuscles: AnalyzedMuscle[] | null;
  taskId: string | null;
}

const initialState: GenerationState = {
  isGenerating: false,
  progress: 0,
  status: null,
  statusMessage: null,
  error: null,
  photoUrl: null,
  musclesUrl: null,
  quotaWarning: false,
  analyzedMuscles: null,
  taskId: null,
};

const isTerminalStatus = (status: GenerateStatus): boolean =>
  status === "completed" || status === "failed";

export function useGenerate() {
  const [state, setState] = useState<GenerationState>(initialState);
  const { addToast } = useAppStore();
  const { t } = useI18n();

  const transportRef = useRef<ReturnType<typeof createGenerationTransport> | null>(null);
  const taskIdRef = useRef<string | null>(null);
  const isMountedRef = useRef<boolean>(true);

  const cleanup = useCallback(() => {
    const transport = transportRef.current;
    transportRef.current = null;
    taskIdRef.current = null;
    transport?.stop();
  }, []);

  const applySnapshot = useCallback((snapshot: GenerationTransportSnapshot) => {
    const isCompleted = snapshot.status === "completed";
    const isFailed = snapshot.status === "failed";

    setState((prev) => ({
      ...prev,
      isGenerating: !isCompleted && !isFailed,
      progress: isCompleted ? 100 : Math.max(prev.progress, snapshot.progress ?? 0),
      status: snapshot.status,
      statusMessage: snapshot.statusMessage ?? prev.statusMessage,
      error: snapshot.errorMessage ?? prev.error,
      photoUrl: snapshot.photoUrl ?? prev.photoUrl,
      musclesUrl: snapshot.musclesUrl ?? prev.musclesUrl,
      quotaWarning: snapshot.quotaWarning ?? prev.quotaWarning,
      analyzedMuscles: snapshot.analyzedMuscles ?? prev.analyzedMuscles,
    }));
  }, []);

  const handleTerminalSnapshot = useCallback(
    (snapshot: GenerationTransportSnapshot) => {
      if (snapshot.status === "completed") {
        if (snapshot.quotaWarning) {
          addToast({ type: "warning", message: t("generate.toast_placeholder") });
        } else {
          addToast({ type: "success", message: t("generate.toast_complete") });
        }
      } else if (snapshot.status === "failed") {
        const fallbackError = t("generate.error_failed");
        const mismatchError = t("generate.error_pose_mismatch");
        const rawError = snapshot.errorMessage || "";
        const isPoseMismatch =
          rawError.toLowerCase().includes("does not match source pose") ||
          rawError.toLowerCase().includes("pose closely enough");

        addToast({
          type: "error",
          message: isPoseMismatch ? mismatchError : (snapshot.errorMessage || fallbackError),
        });
      }

      cleanup();
    },
    [addToast, cleanup, t],
  );

  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
      cleanup();
    };
  }, [cleanup]);

  const startGeneration = useCallback(
    async (startTask: () => Promise<{ task_id?: unknown }>) => {
      cleanup();

      setState({
        ...initialState,
        isGenerating: true,
        status: "pending",
        statusMessage: t("generate.modal_progress"),
      });

      try {
        const response = await startTask();
        if (!isMountedRef.current) {
          return;
        }

        const taskId = typeof response?.task_id === "string" ? response.task_id.trim() : "";
        if (!taskId) {
          throw new Error(t("generate.error_failed"));
        }

        taskIdRef.current = taskId;
        setState((prev) => ({ ...prev, taskId }));
        addToast({ type: "info", message: t("generate.toast_start") });

        const transport = createGenerationTransport(taskId, {
          onUpdate: (snapshot) => {
            if (!isMountedRef.current || taskIdRef.current !== taskId) return;
            applySnapshot(snapshot);
          },
          onTerminal: (snapshot) => {
            if (!isMountedRef.current || taskIdRef.current !== taskId) return;
            if (!isTerminalStatus(snapshot.status)) return;
            handleTerminalSnapshot(snapshot);
          },
        });

        transportRef.current = transport;
        await transport.start();
      } catch (err) {
        if (!isMountedRef.current) {
          return;
        }

        cleanup();
        const message = err instanceof Error ? err.message : t("generate.error_failed");
        setState((prev) => ({
          ...prev,
          isGenerating: false,
          status: "failed",
          error: message,
        }));
        addToast({ type: "error", message });
        throw err instanceof Error ? err : new Error(message);
      }
    },
    [addToast, applySnapshot, cleanup, handleTerminalSnapshot, t],
  );

  const generate = useCallback(
    async (file: File, additionalNotes?: string, generateMuscles: boolean = true) =>
      startGeneration(() => generateApi.generate(file, additionalNotes, generateMuscles)),
    [startGeneration],
  );

  const generateFromPose = useCallback(
    async (
      poseId: number,
      additionalNotes?: string,
      generateMuscles: boolean = true
    ) =>
      startGeneration(() =>
        generateApi.generateFromPose(poseId, additionalNotes, generateMuscles)
      ),
    [startGeneration],
  );

  const regenerate = useCallback(
    async (options: {
      schemaFile?: File;
      referencePhoto: File;
      additionalNotes?: string;
    }) => startGeneration(() => generateApi.regenerate(options)),
    [startGeneration],
  );

  const generateFromText = useCallback(
    async (
      description: string,
      additionalNotes?: string,
      generateMuscles: boolean = true
    ) =>
      startGeneration(() =>
        generateApi.generateFromText(description, additionalNotes, generateMuscles)
      ),
    [startGeneration],
  );

  const reset = useCallback(() => {
    cleanup();
    setState(initialState);
  }, [cleanup]);

  return {
    ...state,
    generate,
    generateFromPose,
    regenerate,
    generateFromText,
    reset,
  };
}
