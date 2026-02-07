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

  // Polling fallback (for environments where WebSocket is blocked/unreliable).
  // Note: backend rate limiting may apply to /generate/status, so we use adaptive delays.
  const pollTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pollingTaskRef = useRef<string | null>(null);
  const pollDelayRef = useRef<number>(0);

  const wsOpenedRef = useRef<boolean>(false);
  const wsFallbackTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const wsSilentFallbackTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const wsGotProgressRef = useRef<boolean>(false);

  // Guard against double finalize/toasts from WS + polling.
  const finalizedTaskRef = useRef<string | null>(null);

  const WS_FALLBACK_DELAY_MS = 2500;
  const WS_SILENT_FALLBACK_DELAY_MS = 3500;
  const POLL_BASE_DELAY_MS = 2000;
  const POLL_MAX_DELAY_MS = 15_000;

  const stopPolling = useCallback(() => {
    pollingTaskRef.current = null;
    pollDelayRef.current = 0;
    if (pollTimeoutRef.current) {
      clearTimeout(pollTimeoutRef.current);
      pollTimeoutRef.current = null;
    }
  }, []);

  /**
   * Clean up WebSocket connection and timers.
   */
  const cleanup = useCallback(() => {
    stopPolling();
    finalizedTaskRef.current = null;
    wsOpenedRef.current = false;
    wsGotProgressRef.current = false;
    if (wsFallbackTimeoutRef.current) {
      clearTimeout(wsFallbackTimeoutRef.current);
      wsFallbackTimeoutRef.current = null;
    }
    if (wsSilentFallbackTimeoutRef.current) {
      clearTimeout(wsSilentFallbackTimeoutRef.current);
      wsSilentFallbackTimeoutRef.current = null;
    }
    if (wsRef.current) {
      const oldWs = wsRef.current;
      wsRef.current = null;
      // Neutralize handlers to prevent stale onclose/onerror callbacks
      oldWs.onopen = null;
      oldWs.onmessage = null;
      oldWs.onerror = null;
      oldWs.onclose = null;
      if (oldWs.readyState === WebSocket.OPEN ||
          oldWs.readyState === WebSocket.CONNECTING) {
        oldWs.close(1000, "Cleanup");
      }
    }
    taskIdRef.current = null;
    reconnectAttemptRef.current = 0;
    if (reconnectTimeoutRef.current) {
      clearTimeout(reconnectTimeoutRef.current);
      reconnectTimeoutRef.current = null;
    }
  }, [stopPolling]);

  const handleTerminalState = useCallback(
    (taskId: string, status: GenerateStatus, opts: { quotaWarning?: boolean; errorMessage?: string | null } = {}) => {
      if (finalizedTaskRef.current === taskId) return;
      finalizedTaskRef.current = taskId;

      if (status === "completed") {
        if (opts.quotaWarning) {
          addToast({ type: "warning", message: t("generate.toast_placeholder") });
        } else {
          addToast({ type: "success", message: t("generate.toast_complete") });
        }
      } else if (status === "failed") {
        const fallbackError = t("generate.error_failed");
        const mismatchError = t("generate.error_pose_mismatch");
        const rawError = opts.errorMessage || "";
        const isPoseMismatch =
          rawError.toLowerCase().includes("does not match source pose") ||
          rawError.toLowerCase().includes("pose closely enough");
        addToast({
          type: "error",
          message: isPoseMismatch ? mismatchError : (opts.errorMessage || fallbackError),
        });
      }

      // Always cleanup transport resources for terminal tasks.
      stopPolling();
      cleanup();
    },
    [addToast, cleanup, stopPolling, t],
  );

  const pollStatusOnce = useCallback(
    async (taskId: string) => {
      if (!isMountedRef.current || taskIdRef.current !== taskId) return;
      if (pollingTaskRef.current !== taskId) return;

      try {
        const status = await generateApi.getStatus(taskId);
        if (!isMountedRef.current || taskIdRef.current !== taskId) return;

        const isCompleted = status.status === "completed";
        const isFailed = status.status === "failed";

        setState((prev) => ({
          ...prev,
          isGenerating: !isCompleted && !isFailed,
          progress: isCompleted ? 100 : Math.max(prev.progress, status.progress ?? 0),
          status: status.status ?? prev.status,
          statusMessage: status.status_message ?? prev.statusMessage,
          error: status.error_message ?? prev.error,
          photoUrl: status.photo_url ?? prev.photoUrl,
          musclesUrl: status.muscles_url ?? prev.musclesUrl,
          quotaWarning: status.quota_warning ?? prev.quotaWarning,
          analyzedMuscles: status.analyzed_muscles ?? prev.analyzedMuscles,
        }));

        if (isCompleted) {
          handleTerminalState(taskId, "completed", { quotaWarning: status.quota_warning });
          return;
        }
        if (isFailed) {
          handleTerminalState(taskId, "failed", { errorMessage: status.error_message });
          return;
        }

        // Backoff gently while processing; keep under common 5/min limits if needed.
        const nextDelay = Math.min(
          pollDelayRef.current ? Math.floor(pollDelayRef.current * 1.2) : POLL_BASE_DELAY_MS,
          POLL_MAX_DELAY_MS,
        );
        pollDelayRef.current = nextDelay;
        pollTimeoutRef.current = setTimeout(() => void pollStatusOnce(taskId), nextDelay);
      } catch (err) {
        if (!isMountedRef.current || taskIdRef.current !== taskId) return;
        const anyErr = err as Error & {
          retryAfter?: number;
          isRateLimited?: boolean;
          status?: number;
        };

        // Terminal polling failures: don't spin forever if the task can't be found or auth is invalid.
        // These can happen if the task was deleted, the backend restarted with a different DB,
        // or the session/token expired.
        if (anyErr?.status === 404) {
          const message = anyErr.message || t("generate.error_failed");
          setState((prev) => ({
            ...prev,
            isGenerating: false,
            status: "failed",
            error: message,
          }));
          handleTerminalState(taskId, "failed", { errorMessage: message });
          return;
        }
        if (anyErr?.status === 401 || anyErr?.status === 403) {
          const message = t("generate.session_expired");
          setState((prev) => ({
            ...prev,
            isGenerating: false,
            status: "failed",
            error: message,
          }));
          handleTerminalState(taskId, "failed", { errorMessage: message });
          return;
        }

        // Respect backend Retry-After to avoid tight loops on 429.
        const retryAfterMs =
          anyErr?.isRateLimited && typeof anyErr.retryAfter === "number"
            ? Math.max(1000, anyErr.retryAfter * 1000)
            : null;
        const nextDelay = Math.min(
          retryAfterMs ?? (pollDelayRef.current ? Math.floor(pollDelayRef.current * 1.5) : POLL_BASE_DELAY_MS),
          POLL_MAX_DELAY_MS,
        );
        pollDelayRef.current = nextDelay;
        pollTimeoutRef.current = setTimeout(() => void pollStatusOnce(taskId), nextDelay);
      }
    },
    [handleTerminalState, t],
  );

  const startPolling = useCallback(
    (taskId: string) => {
      if (!isMountedRef.current || taskIdRef.current !== taskId) return;
      if (pollingTaskRef.current === taskId) return;
      pollingTaskRef.current = taskId;
      pollDelayRef.current = POLL_BASE_DELAY_MS;
      if (pollTimeoutRef.current) {
        clearTimeout(pollTimeoutRef.current);
        pollTimeoutRef.current = null;
      }
      void pollStatusOnce(taskId);
    },
    [pollStatusOnce],
  );

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

    // Close existing connection if any — neutralize handlers first
    if (wsRef.current) {
      const oldWs = wsRef.current;
      wsRef.current = null;
      oldWs.onopen = null;
      oldWs.onmessage = null;
      oldWs.onerror = null;
      oldWs.onclose = null;
      if (oldWs.readyState === WebSocket.OPEN ||
          oldWs.readyState === WebSocket.CONNECTING) {
        oldWs.close(1000, "New connection");
      }
    }

    // CRITICAL: Ensure token is fresh before WebSocket connection.
    // Token is sent via Sec-WebSocket-Protocol (not in URL), so we need a valid one.
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

    // Get WebSocket URL (token will be passed via subprotocol)
    const wsUrl = generateApi.getWebSocketUrl(taskId);
    logger.debug("Connecting to WebSocket:", wsUrl);

    const token = useAuthStore.getState().accessToken;
    const protocols = token ? ["jwt", token] : undefined;
    wsOpenedRef.current = false;
    wsGotProgressRef.current = false;

    let ws: WebSocket;
    try {
      ws = new WebSocket(wsUrl, protocols);
    } catch (err) {
      logger.warn("WebSocket construction failed; falling back to polling", err);
      startPolling(taskId);
      return;
    }

    if (wsFallbackTimeoutRef.current) {
      clearTimeout(wsFallbackTimeoutRef.current);
      wsFallbackTimeoutRef.current = null;
    }
    if (wsSilentFallbackTimeoutRef.current) {
      clearTimeout(wsSilentFallbackTimeoutRef.current);
      wsSilentFallbackTimeoutRef.current = null;
    }
    wsFallbackTimeoutRef.current = setTimeout(() => {
      if (!isMountedRef.current || taskIdRef.current !== taskId) return;
      if (wsOpenedRef.current) return;
      startPolling(taskId);
    }, WS_FALLBACK_DELAY_MS);

    ws.onopen = () => {
      if (!isMountedRef.current || taskIdRef.current !== taskId) {
        ws.close(1000, "Task changed");
        return;
      }
      wsOpenedRef.current = true;
      if (wsFallbackTimeoutRef.current) {
        clearTimeout(wsFallbackTimeoutRef.current);
        wsFallbackTimeoutRef.current = null;
      }
      // Prefer WS when available; stop polling to reduce load.
      stopPolling();
      logger.info("WebSocket connected for task:", taskId);
      reconnectAttemptRef.current = 0; // Reset on successful connection

      // Some proxies allow WS connections but drop/never deliver messages.
      // If we don't see a progress_update soon, fall back to polling to avoid a "stuck" UI.
      if (wsSilentFallbackTimeoutRef.current) {
        clearTimeout(wsSilentFallbackTimeoutRef.current);
        wsSilentFallbackTimeoutRef.current = null;
      }
      wsSilentFallbackTimeoutRef.current = setTimeout(() => {
        if (!isMountedRef.current || taskIdRef.current !== taskId) return;
        if (wsGotProgressRef.current) return;
        startPolling(taskId);
      }, WS_SILENT_FALLBACK_DELAY_MS);
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
          wsGotProgressRef.current = true;
          if (wsSilentFallbackTimeoutRef.current) {
            clearTimeout(wsSilentFallbackTimeoutRef.current);
            wsSilentFallbackTimeoutRef.current = null;
          }
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

          // Stop polling once WS updates are flowing.
          stopPolling();

          if (isCompleted) {
            handleTerminalState(taskId, "completed", { quotaWarning: message.quota_warning });
          } else if (isFailed) {
            handleTerminalState(taskId, "failed", { errorMessage: message.error_message });
          }
        }
      } catch (err) {
        logger.error("Failed to parse WebSocket message:", err);
      }
    };

    ws.onerror = (event) => {
      logger.error("WebSocket error:", event);
      // In some environments, ws errors never transition to onclose reliably.
      // Ensure we keep making progress via polling.
      startPolling(taskId);
    };

    ws.onclose = (event) => {
      if (!isMountedRef.current || taskIdRef.current !== taskId) {
        return;
      }

      if (wsFallbackTimeoutRef.current) {
        clearTimeout(wsFallbackTimeoutRef.current);
        wsFallbackTimeoutRef.current = null;
      }
      if (wsSilentFallbackTimeoutRef.current) {
        clearTimeout(wsSilentFallbackTimeoutRef.current);
        wsSilentFallbackTimeoutRef.current = null;
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

          // Start polling immediately as a fallback (WS may be blocked by network/proxy).
          startPolling(taskId);

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
  }, [addToast, cleanup, handleTerminalState, startPolling, stopPolling, t]);

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

        if (typeof (response as any)?.task_id !== "string" || !(response as any).task_id.trim()) {
          throw new Error(t("generate.error_failed"));
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
        throw err instanceof Error ? err : new Error(message);
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

        if (typeof (response as any)?.task_id !== "string" || !(response as any).task_id.trim()) {
          throw new Error(t("generate.error_failed"));
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
        throw err instanceof Error ? err : new Error(message);
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

        if (typeof (response as any)?.task_id !== "string" || !(response as any).task_id.trim()) {
          throw new Error(t("generate.error_failed"));
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
        throw err instanceof Error ? err : new Error(message);
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

        if (typeof (response as any)?.task_id !== "string" || !(response as any).task_id.trim()) {
          throw new Error(t("generate.error_failed"));
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
        throw err instanceof Error ? err : new Error(message);
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
