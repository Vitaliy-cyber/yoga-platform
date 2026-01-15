import { useState, useCallback, useRef } from "react";
import { generateApi } from "../services/api";
import { useAppStore } from "../store/useAppStore";
import type { GenerateStatus } from "../types";

interface GenerationState {
  isGenerating: boolean;
  progress: number;
  status: GenerateStatus | null;
  statusMessage: string | null;
  error: string | null;
  // Результати - студійне фото та body paint м'язи
  photoUrl: string | null;
  musclesUrl: string | null;
  // Warning when placeholders are used
  quotaWarning: boolean;
}

export function useGenerate() {
  const [state, setState] = useState<GenerationState>({
    isGenerating: false,
    progress: 0,
    status: null,
    statusMessage: null,
    error: null,
    photoUrl: null,
    musclesUrl: null,
    quotaWarning: false,
  });

  const { addToast } = useAppStore();
  const pollingRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const simulationRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const serverProgressRef = useRef(0);

  const clearPolling = useCallback(() => {
    if (pollingRef.current) {
      clearInterval(pollingRef.current);
      pollingRef.current = null;
    }
  }, []);

  const clearSimulation = useCallback(() => {
    if (simulationRef.current) {
      clearInterval(simulationRef.current);
      simulationRef.current = null;
    }
  }, []);

  const startSimulation = useCallback(() => {
    clearSimulation();
    serverProgressRef.current = 0;

    const simulatedSteps = [5, 10, 20, 30, 40, 50, 60, 70, 80, 90];
    let index = 0;

    setState((prev) => ({
      ...prev,
      progress: Math.max(prev.progress, simulatedSteps[index]),
    }));

    simulationRef.current = setInterval(() => {
      if (serverProgressRef.current > 0) {
        clearSimulation();
        return;
      }

      index = Math.min(index + 1, simulatedSteps.length - 1);
      setState((prev) => {
        if (!prev.isGenerating || serverProgressRef.current > 0) {
          return prev;
        }
        if (prev.progress >= simulatedSteps[index]) {
          return prev;
        }
        return {
          ...prev,
          progress: simulatedSteps[index],
        };
      });
    }, 500);
  }, [clearSimulation]);

  const pollStatus = useCallback(
    async (taskId: string) => {
      try {
        const response = await generateApi.getStatus(taskId);
        if (response.progress !== null && response.progress !== undefined) {
          serverProgressRef.current = response.progress;
          if (response.progress > 0) {
            clearSimulation();
          }
        }

        setState((prev) => ({
          ...prev,
          progress: response.progress ?? prev.progress,
          status: response.status,
          statusMessage: response.status_message,
        }));

        if (response.status === "completed") {
          clearPolling();
          clearSimulation();
          setState((prev) => ({
            ...prev,
            isGenerating: false,
            progress: 100,
            photoUrl: response.photo_url,
            musclesUrl: response.muscles_url,
            quotaWarning: response.quota_warning,
          }));
          if (response.quota_warning) {
            addToast({ type: "warning", message: "Показано placeholder зображення. API квота вичерпана." });
          } else {
            addToast({ type: "success", message: "Генерація завершена!" });
          }
        } else if (response.status === "failed") {
          clearPolling();
          clearSimulation();
          setState((prev) => ({
            ...prev,
            isGenerating: false,
            error: response.error_message || "Помилка генерації",
          }));
          addToast({
            type: "error",
            message: response.error_message || "Помилка генерації",
          });
        }
      } catch (err) {
        clearPolling();
        clearSimulation();
        const message =
          err instanceof Error ? err.message : "Помилка перевірки статусу";
        setState((prev) => ({
          ...prev,
          isGenerating: false,
          error: message,
        }));
      }
    },
    [addToast, clearPolling, clearSimulation],
  );

  const generate = useCallback(
    async (file: File) => {
      setState({
        isGenerating: true,
        progress: 0,
        status: "pending",
        statusMessage: "В черзі...",
        error: null,
        photoUrl: null,
        musclesUrl: null,
        quotaWarning: false,
      });

      startSimulation();

      try {
        const response = await generateApi.generate(file);

        addToast({ type: "info", message: "Генерація розпочата..." });

        // Poll immediately, then every 1000ms (1 second)
        pollStatus(response.task_id);
        pollingRef.current = setInterval(() => {
          pollStatus(response.task_id);
        }, 1000);
      } catch (err) {
        clearSimulation();
        const message =
          err instanceof Error ? err.message : "Помилка запуску генерації";
        setState((prev) => ({
          ...prev,
          isGenerating: false,
          error: message,
        }));
        addToast({ type: "error", message });
      }
    },
    [addToast, pollStatus, startSimulation, clearSimulation],
  );

  const reset = useCallback(() => {
    clearPolling();
    clearSimulation();
    setState({
      isGenerating: false,
      progress: 0,
      status: null,
      statusMessage: null,
      error: null,
      photoUrl: null,
      musclesUrl: null,
      quotaWarning: false,
    });
  }, [clearPolling, clearSimulation]);

  return {
    ...state,
    generate,
    reset,
  };
}
