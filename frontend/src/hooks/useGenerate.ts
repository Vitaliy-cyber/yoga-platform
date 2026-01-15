import { useState, useCallback, useRef, useEffect } from "react";
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

const initialState: GenerationState = {
  isGenerating: false,
  progress: 0,
  status: null,
  statusMessage: null,
  error: null,
  photoUrl: null,
  musclesUrl: null,
  quotaWarning: false,
};

export function useGenerate() {
  const [state, setState] = useState<GenerationState>(initialState);

  const { addToast } = useAppStore();
  const pollingRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const taskIdRef = useRef<string | null>(null);

  const clearPolling = useCallback(() => {
    if (pollingRef.current) {
      clearInterval(pollingRef.current);
      pollingRef.current = null;
    }
    taskIdRef.current = null;
  }, []);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (pollingRef.current) {
        clearInterval(pollingRef.current);
      }
    };
  }, []);

  const pollStatus = useCallback(
    async (taskId: string) => {
      // Skip if this poll is for an old task
      if (taskIdRef.current !== taskId) {
        return;
      }

      try {
        const response = await generateApi.getStatus(taskId);

        // Skip if task changed during the request
        if (taskIdRef.current !== taskId) {
          return;
        }

        const serverProgress = response.progress ?? 0;

        if (response.status === "completed") {
          clearPolling();
          setState((prev) => ({
            ...prev,
            isGenerating: false,
            progress: 100,
            status: response.status,
            statusMessage: response.status_message,
            photoUrl: response.photo_url,
            musclesUrl: response.muscles_url,
            quotaWarning: response.quota_warning ?? false,
          }));
          if (response.quota_warning) {
            addToast({ type: "warning", message: "Показано placeholder зображення. API квота вичерпана." });
          } else {
            addToast({ type: "success", message: "Генерація завершена!" });
          }
        } else if (response.status === "failed") {
          clearPolling();
          setState((prev) => ({
            ...prev,
            isGenerating: false,
            progress: prev.progress,
            status: response.status,
            statusMessage: response.status_message,
            error: response.error_message || "Помилка генерації",
          }));
          addToast({
            type: "error",
            message: response.error_message || "Помилка генерації",
          });
        } else {
          // Processing or pending - update progress (never go backwards)
          setState((prev) => ({
            ...prev,
            progress: Math.max(prev.progress, serverProgress),
            status: response.status,
            statusMessage: response.status_message,
          }));
        }
      } catch (err) {
        // Skip if task changed
        if (taskIdRef.current !== taskId) {
          return;
        }
        
        clearPolling();
        const message =
          err instanceof Error ? err.message : "Помилка перевірки статусу";
        setState((prev) => ({
          ...prev,
          isGenerating: false,
          error: message,
        }));
      }
    },
    [addToast, clearPolling],
  );

  const generate = useCallback(
    async (file: File) => {
      // Clear any existing polling
      clearPolling();

      // Reset state for new generation
      setState({
        ...initialState,
        isGenerating: true,
        status: "pending",
        statusMessage: "Запуск генерації...",
      });

      try {
        const response = await generateApi.generate(file);
        
        // Store task ID for this generation
        taskIdRef.current = response.task_id;

        addToast({ type: "info", message: "Генерація розпочата..." });

        // Start polling for status
        pollStatus(response.task_id);
        pollingRef.current = setInterval(() => {
          pollStatus(response.task_id);
        }, 1500); // Poll every 1.5 seconds
      } catch (err) {
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
    [addToast, pollStatus, clearPolling],
  );

  const reset = useCallback(() => {
    clearPolling();
    setState(initialState);
  }, [clearPolling]);

  return {
    ...state,
    generate,
    reset,
  };
}
