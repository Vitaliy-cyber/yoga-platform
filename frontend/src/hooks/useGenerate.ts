import { useState, useCallback, useRef, useEffect } from "react";
import { generateApi } from "../services/api";
import { useAppStore } from "../store/useAppStore";
import type { GenerateStatus } from "../types";
import { useI18n } from "../i18n";

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
  const { t } = useI18n();
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

        const normalizedProgress = response.status === "completed" ? 100 : 0;

        if (response.status === "completed") {
          clearPolling();
          setState((prev) => ({
            ...prev,
            isGenerating: false,
            progress: normalizedProgress,
            status: response.status,
            statusMessage: response.status_message,
            photoUrl: response.photo_url,
            musclesUrl: response.muscles_url,
            quotaWarning: response.quota_warning ?? false,
          }));
          if (response.quota_warning) {
            addToast({ type: "warning", message: t("generate.toast_placeholder") });
          } else {
            addToast({ type: "success", message: t("generate.toast_complete") });
          }
        } else if (response.status === "failed") {
          clearPolling();
          const fallbackError = t("generate.error_failed");
          setState((prev) => ({
            ...prev,
            isGenerating: false,
            progress: normalizedProgress,
            status: response.status,
            statusMessage: response.status_message,
            error: response.error_message || fallbackError,
          }));
          addToast({
            type: "error",
            message: response.error_message || fallbackError,
          });
        } else {
          // Processing or pending - update progress (never go backwards)
          setState((prev) => ({
            ...prev,
            progress: normalizedProgress,
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
        const fallbackMessage = t("generate.status_failed");
        const message =
          err instanceof Error ? err.message : fallbackMessage;
        setState((prev) => ({
          ...prev,
          isGenerating: false,
          error: message,
        }));
      }
    },
    [addToast, clearPolling, t],
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
        statusMessage: t("generate.modal_progress"),
      });

      try {
        const response = await generateApi.generate(file);
        
        // Store task ID for this generation
        taskIdRef.current = response.task_id;

        addToast({ type: "info", message: t("generate.toast_start") });

        // Start polling for status
        pollStatus(response.task_id);
        pollingRef.current = setInterval(() => {
          pollStatus(response.task_id);
        }, 1500); // Poll every 1.5 seconds
      } catch (err) {
        const message =
          err instanceof Error ? err.message : t("generate.error_failed");
        setState((prev) => ({
          ...prev,
          isGenerating: false,
          error: message,
        }));
        addToast({ type: "error", message });
      }
    },
    [addToast, pollStatus, clearPolling, t],
  );

  /**
   * Generate from existing pose schema (server-side fetch)
   * This avoids CORS issues by having the server fetch the schema
   */
  const generateFromPose = useCallback(
    async (poseId: number) => {
      // Clear any existing polling
      clearPolling();

      // Reset state for new generation
      setState({
        ...initialState,
        isGenerating: true,
        status: "pending",
        statusMessage: t("generate.modal_progress"),
      });

      try {
        const response = await generateApi.generateFromPose(poseId);
        
        // Store task ID for this generation
        taskIdRef.current = response.task_id;

        addToast({ type: "info", message: t("generate.toast_start") });

        // Start polling for status
        pollStatus(response.task_id);
        pollingRef.current = setInterval(() => {
          pollStatus(response.task_id);
        }, 1500); // Poll every 1.5 seconds
      } catch (err) {
        const message =
          err instanceof Error ? err.message : t("generate.error_failed");
        setState((prev) => ({
          ...prev,
          isGenerating: false,
          error: message,
        }));
        addToast({ type: "error", message });
      }
    },
    [addToast, pollStatus, clearPolling, t],
  );

  const reset = useCallback(() => {
    clearPolling();
    setState(initialState);
  }, [clearPolling]);

  return {
    ...state,
    generate,
    generateFromPose,
    reset,
  };
}
