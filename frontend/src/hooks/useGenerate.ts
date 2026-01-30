import { useState, useCallback, useRef, useEffect } from "react";
import { generateApi, tokenManager } from "../services/api";
import { useAppStore } from "../store/useAppStore";
import { useAuthStore } from "../store/useAuthStore";
import type { AnalyzedMuscle, GenerateStatus } from "../types";
import { useI18n } from "../i18n";
import { logger } from "../lib/logger";

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
  // Analyzed muscles from AI
  analyzedMuscles: AnalyzedMuscle[] | null;
  // Task ID for saving to gallery
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

/**
 * WebSocket message type from the server.
 * Matches the ProgressUpdate structure in backend/services/websocket_manager.py
 */
interface WebSocketMessage {
  type: "progress_update" | "pong";
  task_id?: string;
  status?: GenerateStatus;
  progress?: number;
  status_message?: string | null;
  error_message?: string | null;
  photo_url?: string | null;
  muscles_url?: string | null;
  quota_warning?: boolean;
  analyzed_muscles?: AnalyzedMuscle[] | null;
}

/**
 * Hook for managing AI generation with real-time WebSocket updates.
 *
 * Uses WebSocket instead of polling for:
 * - No rate limit issues (single persistent connection)
 * - Real-time updates (instant feedback)
 * - Lower bandwidth and server load
 * - Better user experience
 */
export function useGenerate() {
  const [state, setState] = useState<GenerationState>(initialState);

  const { addToast } = useAppStore();
  const { t } = useI18n();

  // WebSocket reference
  const wsRef = useRef<WebSocket | null>(null);
  const taskIdRef = useRef<string | null>(null);
  // Track if component is still mounted to prevent setState after unmount
  const isMountedRef = useRef<boolean>(true);
  // Reconnect attempt counter
  const reconnectAttemptRef = useRef<number>(0);
  const reconnectTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Maximum reconnection attempts
  const MAX_RECONNECT_ATTEMPTS = 5;
  // Base delay for exponential backoff (ms)
  const BASE_RECONNECT_DELAY = 1000;

  /**
   * Clean up WebSocket connection and timers.
   */
  const cleanup = useCallback(() => {
    if (wsRef.current) {
      // Only close if not already closed/closing
      if (wsRef.current.readyState === WebSocket.OPEN ||
          wsRef.current.readyState === WebSocket.CONNECTING) {
        wsRef.current.close(1000, "Cleanup");
      }
      wsRef.current = null;
    }
    taskIdRef.current = null;
    reconnectAttemptRef.current = 0;
    if (reconnectTimeoutRef.current) {
      clearTimeout(reconnectTimeoutRef.current);
      reconnectTimeoutRef.current = null;
    }
  }, []);

  // Cleanup on unmount
  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
      cleanup();
    };
  }, [cleanup]);

  /**
   * Connect to WebSocket for real-time generation updates.
   * Ensures token is fresh before connecting.
   */
  const connectWebSocket = useCallback(async (taskId: string) => {
    // Don't reconnect if task changed or component unmounted
    if (taskIdRef.current !== taskId || !isMountedRef.current) {
      return;
    }

    // Close existing connection if any
    if (wsRef.current) {
      wsRef.current.close(1000, "New connection");
    }

    // CRITICAL: Ensure token is fresh before WebSocket connection
    // WebSocket URL contains the token, so we need a valid one
    const authState = useAuthStore.getState();
    const tokenExpiresAt = authState.tokenExpiresAt;
    const isExpiredOrClose = tokenExpiresAt
      ? Date.now() >= tokenExpiresAt - 30_000 // Refresh if expires within 30 seconds
      : false;

    if (isExpiredOrClose) {
      logger.info("Token expiring soon, refreshing before WebSocket connection...");
      setState((prev) => ({
        ...prev,
        statusMessage: t("generate.refreshing_session"),
      }));

      const refreshSuccess = await tokenManager.silentRefresh();
      if (!refreshSuccess) {
        logger.error("Token refresh failed before WebSocket connection");
        setState((prev) => ({
          ...prev,
          isGenerating: false,
          error: t("generate.session_expired"),
        }));
        addToast({
          type: "error",
          message: t("generate.session_expired"),
        });
        return;
      }
    }

    // Get fresh WebSocket URL with updated token
    const wsUrl = generateApi.getWebSocketUrl(taskId);
    logger.debug("Connecting to WebSocket:", wsUrl.replace(/token=[^&]+/, "token=***"));

    const ws = new WebSocket(wsUrl);

    ws.onopen = () => {
      if (!isMountedRef.current || taskIdRef.current !== taskId) {
        ws.close(1000, "Task changed");
        return;
      }
      logger.info("WebSocket connected for task:", taskId);
      reconnectAttemptRef.current = 0; // Reset on successful connection
    };

    ws.onmessage = (event) => {
      if (!isMountedRef.current || taskIdRef.current !== taskId) {
        return;
      }

      try {
        const message: WebSocketMessage = JSON.parse(event.data);

        if (message.type === "pong") {
          return; // Keep-alive response, ignore
        }

        if (message.type === "progress_update") {
          const isCompleted = message.status === "completed";
          const isFailed = message.status === "failed";

          setState((prev) => ({
            ...prev,
            isGenerating: !isCompleted && !isFailed,
            // Never go backwards on progress
            progress: isCompleted ? 100 : Math.max(prev.progress, message.progress ?? 0),
            status: message.status ?? prev.status,
            statusMessage: message.status_message ?? prev.statusMessage,
            error: message.error_message ?? prev.error,
            photoUrl: message.photo_url ?? prev.photoUrl,
            musclesUrl: message.muscles_url ?? prev.musclesUrl,
            quotaWarning: message.quota_warning ?? prev.quotaWarning,
            analyzedMuscles: message.analyzed_muscles ?? prev.analyzedMuscles,
          }));

          // Show toast on completion or failure
          if (isCompleted) {
            if (message.quota_warning) {
              addToast({ type: "warning", message: t("generate.toast_placeholder") });
            } else {
              addToast({ type: "success", message: t("generate.toast_complete") });
            }
            // Clean up WebSocket after completion
            cleanup();
          } else if (isFailed) {
            const fallbackError = t("generate.error_failed");
            addToast({
              type: "error",
              message: message.error_message || fallbackError,
            });
            // Clean up WebSocket after failure
            cleanup();
          }
        }
      } catch (err) {
        logger.error("Failed to parse WebSocket message:", err);
      }
    };

    ws.onerror = (event) => {
      logger.error("WebSocket error:", event);
    };

    ws.onclose = (event) => {
      if (!isMountedRef.current || taskIdRef.current !== taskId) {
        return;
      }

      // Normal closure (task completed) - code 1000
      if (event.code === 1000) {
        logger.debug("WebSocket closed normally");
        return;
      }

      // Policy violation (1008) typically means token expired
      const isTokenError = event.code === 1008;
      if (isTokenError) {
        logger.warn("WebSocket closed due to policy violation (likely token expired)");
      } else {
        logger.warn(`WebSocket closed with code ${event.code}: ${event.reason}`);
      }

      // FIX: Use setState callback to get fresh state, avoiding stale closure
      setState((currentState) => {
        // Check if generation is still in progress using CURRENT state
        if (currentState.isGenerating &&
            currentState.status !== "completed" &&
            currentState.status !== "failed") {

          // Attempt reconnection with exponential backoff
          if (reconnectAttemptRef.current < MAX_RECONNECT_ATTEMPTS) {
            const delay = BASE_RECONNECT_DELAY * Math.pow(2, reconnectAttemptRef.current);
            reconnectAttemptRef.current++;

            logger.info(`WebSocket reconnect attempt ${reconnectAttemptRef.current}/${MAX_RECONNECT_ATTEMPTS} in ${delay}ms`);

            reconnectTimeoutRef.current = setTimeout(() => {
              if (isMountedRef.current && taskIdRef.current === taskId) {
                connectWebSocket(taskId);
              }
            }, delay);

            return {
              ...currentState,
              statusMessage: t("generate.reconnecting"),
            };
          } else {
            // Max reconnection attempts reached - show error
            logger.error("Max WebSocket reconnection attempts reached");
            addToast({
              type: "error",
              message: t("generate.connection_lost"),
            });

            return {
              ...currentState,
              isGenerating: false,
              error: t("generate.connection_lost"),
            };
          }
        }

        // Generation not in progress, no action needed
        return currentState;
      });
    };

    wsRef.current = ws;
  }, [addToast, cleanup, t]);

  /**
   * Start generation from an uploaded file.
   */
  const generate = useCallback(
    async (file: File, additionalNotes?: string) => {
      // Clear any existing connection
      cleanup();

      // Reset state for new generation
      setState({
        ...initialState,
        isGenerating: true,
        status: "pending",
        statusMessage: t("generate.modal_progress"),
      });

      try {
        const response = await generateApi.generate(file, additionalNotes);

        // Skip if component unmounted during the request
        if (!isMountedRef.current) {
          return;
        }

        // Store task ID for this generation
        taskIdRef.current = response.task_id;
        setState((prev) => ({ ...prev, taskId: response.task_id }));

        addToast({ type: "info", message: t("generate.toast_start") });

        // Connect to WebSocket for real-time updates
        await connectWebSocket(response.task_id);
      } catch (err) {
        // Skip if component unmounted
        if (!isMountedRef.current) {
          return;
        }
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
    [addToast, connectWebSocket, cleanup, t],
  );

  /**
   * Generate from existing pose schema (server-side fetch).
   * This avoids CORS issues by having the server fetch the schema.
   */
  const generateFromPose = useCallback(
    async (poseId: number, additionalNotes?: string) => {
      // Clear any existing connection
      cleanup();

      // Reset state for new generation
      setState({
        ...initialState,
        isGenerating: true,
        status: "pending",
        statusMessage: t("generate.modal_progress"),
      });

      try {
        const response = await generateApi.generateFromPose(poseId, additionalNotes);

        // Skip if component unmounted during the request
        if (!isMountedRef.current) {
          return;
        }

        // Store task ID for this generation
        taskIdRef.current = response.task_id;
        setState((prev) => ({ ...prev, taskId: response.task_id }));

        addToast({ type: "info", message: t("generate.toast_start") });

        // Connect to WebSocket for real-time updates
        await connectWebSocket(response.task_id);
      } catch (err) {
        // Skip if component unmounted
        if (!isMountedRef.current) {
          return;
        }
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
    [addToast, connectWebSocket, cleanup, t],
  );

  /**
   * Regenerate from existing images with feedback.
   * Uses schema + reference photo if both available, otherwise just reference photo.
   */
  const regenerate = useCallback(
    async (options: {
      schemaFile?: File;
      referencePhoto: File;
      additionalNotes?: string;
    }) => {
      // Clear any existing connection
      cleanup();

      // Reset state for new generation
      setState({
        ...initialState,
        isGenerating: true,
        status: "pending",
        statusMessage: t("generate.modal_progress"),
      });

      try {
        const response = await generateApi.regenerate(options);

        // Skip if component unmounted during the request
        if (!isMountedRef.current) {
          return;
        }

        // Store task ID for this generation
        taskIdRef.current = response.task_id;
        setState((prev) => ({ ...prev, taskId: response.task_id }));

        addToast({ type: "info", message: t("generate.toast_start") });

        // Connect to WebSocket for real-time updates
        await connectWebSocket(response.task_id);
      } catch (err) {
        // Skip if component unmounted
        if (!isMountedRef.current) {
          return;
        }
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
    [addToast, connectWebSocket, cleanup, t],
  );

  /**
   * Generate from text description.
   * No image upload required - AI generates from the description.
   */
  const generateFromText = useCallback(
    async (description: string, additionalNotes?: string) => {
      // Clear any existing connection
      cleanup();

      // Reset state for new generation
      setState({
        ...initialState,
        isGenerating: true,
        status: "pending",
        statusMessage: t("generate.modal_progress"),
      });

      try {
        const response = await generateApi.generateFromText(description, additionalNotes);

        // Skip if component unmounted during the request
        if (!isMountedRef.current) {
          return;
        }

        // Store task ID for this generation
        taskIdRef.current = response.task_id;
        setState((prev) => ({ ...prev, taskId: response.task_id }));

        addToast({ type: "info", message: t("generate.toast_start") });

        // Connect to WebSocket for real-time updates
        await connectWebSocket(response.task_id);
      } catch (err) {
        // Skip if component unmounted
        if (!isMountedRef.current) {
          return;
        }
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
    [addToast, connectWebSocket, cleanup, t],
  );

  /**
   * Reset generation state.
   */
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
