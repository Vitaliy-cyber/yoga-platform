import { generateApi, tokenManager } from "./api";
import { useAuthStore } from "../store/useAuthStore";
import type { AnalyzedMuscle, GenerateStatus } from "../types";
import { logger } from "../lib/logger";

export interface GenerationTransportSnapshot {
  taskId: string;
  status: GenerateStatus;
  progress: number;
  statusMessage: string | null;
  errorMessage: string | null;
  photoUrl: string | null;
  musclesUrl: string | null;
  quotaWarning: boolean;
  analyzedMuscles: AnalyzedMuscle[] | null;
}

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

interface GenerationTransportCallbacks {
  onUpdate: (snapshot: GenerationTransportSnapshot) => void;
  onTerminal?: (snapshot: GenerationTransportSnapshot) => void;
}

const WS_FALLBACK_DELAY_MS = 2500;
const WS_SILENT_FALLBACK_DELAY_MS = 3500;
const POLL_BASE_DELAY_MS = 2000;
const POLL_MAX_DELAY_MS = 15_000;

const clampProgress = (value: unknown): number => {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return 0;
  if (numeric <= 0) return 0;
  if (numeric >= 100) return 100;
  return Math.floor(numeric);
};

const isTerminal = (status: GenerateStatus): boolean =>
  status === "completed" || status === "failed";

export class GenerationTransport {
  private readonly taskId: string;
  private readonly callbacks: GenerationTransportCallbacks;

  private ws: WebSocket | null = null;

  private pollTimeout: ReturnType<typeof setTimeout> | null = null;
  private polling = false;
  private pollDelay = 0;

  private wsOpened = false;
  private wsFallbackTimeout: ReturnType<typeof setTimeout> | null = null;
  private wsSilentFallbackTimeout: ReturnType<typeof setTimeout> | null = null;

  private stopped = false;
  private terminalHandled = false;

  private snapshot: GenerationTransportSnapshot;

  constructor(taskId: string, callbacks: GenerationTransportCallbacks) {
    this.taskId = taskId;
    this.callbacks = callbacks;
    this.snapshot = {
      taskId,
      status: "pending",
      progress: 0,
      statusMessage: "In queue...",
      errorMessage: null,
      photoUrl: null,
      musclesUrl: null,
      quotaWarning: false,
      analyzedMuscles: null,
    };
  }

  public async start(): Promise<void> {
    if (this.stopped) return;
    await this.connectWebSocket();
  }

  public stop(): void {
    if (this.stopped) return;
    this.stopped = true;
    this.cleanup();
  }

  private emitUpdate(patch: Partial<GenerationTransportSnapshot>): void {
    if (this.stopped) return;

    const nextStatus = patch.status ?? this.snapshot.status;
    const nextProgress = isTerminal(nextStatus)
      ? nextStatus === "completed"
        ? 100
        : this.snapshot.progress
      : Math.max(this.snapshot.progress, clampProgress(patch.progress ?? this.snapshot.progress));

    this.snapshot = {
      ...this.snapshot,
      ...patch,
      status: nextStatus,
      progress: nextProgress,
    };

    this.callbacks.onUpdate(this.snapshot);

    if (isTerminal(this.snapshot.status)) {
      this.handleTerminal();
    }
  }

  private handleTerminal(): void {
    if (this.terminalHandled) return;
    this.terminalHandled = true;
    this.cleanup();
    this.callbacks.onTerminal?.(this.snapshot);
  }

  private cleanup(): void {
    this.stopPolling();

    if (this.wsFallbackTimeout) {
      clearTimeout(this.wsFallbackTimeout);
      this.wsFallbackTimeout = null;
    }

    if (this.wsSilentFallbackTimeout) {
      clearTimeout(this.wsSilentFallbackTimeout);
      this.wsSilentFallbackTimeout = null;
    }

    if (this.ws) {
      const oldWs = this.ws;
      this.ws = null;
      oldWs.onopen = null;
      oldWs.onmessage = null;
      oldWs.onerror = null;
      oldWs.onclose = null;
      if (
        oldWs.readyState === WebSocket.OPEN ||
        oldWs.readyState === WebSocket.CONNECTING
      ) {
        oldWs.close(1000, "Cleanup");
      }
    }

    this.wsOpened = false;
  }

  private stopPolling(): void {
    this.polling = false;
    this.pollDelay = 0;
    if (this.pollTimeout) {
      clearTimeout(this.pollTimeout);
      this.pollTimeout = null;
    }
  }

  private startPolling(): void {
    if (this.stopped || this.polling || isTerminal(this.snapshot.status)) return;
    this.polling = true;
    this.pollDelay = POLL_BASE_DELAY_MS;
    void this.pollStatusOnce();
  }

  private async pollStatusOnce(): Promise<void> {
    if (this.stopped || !this.polling || isTerminal(this.snapshot.status)) return;

    try {
      const status = await generateApi.getStatus(this.taskId);
      if (this.stopped || !this.polling) return;

      this.emitUpdate({
        status: status.status,
        progress: status.progress,
        statusMessage: status.status_message,
        errorMessage: status.error_message,
        photoUrl: status.photo_url,
        musclesUrl: status.muscles_url,
        quotaWarning: status.quota_warning,
        analyzedMuscles: status.analyzed_muscles,
      });

      if (isTerminal(status.status)) {
        return;
      }

      const nextDelay = Math.min(
        this.pollDelay ? Math.floor(this.pollDelay * 1.2) : POLL_BASE_DELAY_MS,
        POLL_MAX_DELAY_MS,
      );

      this.pollDelay = nextDelay;
      this.pollTimeout = setTimeout(() => {
        void this.pollStatusOnce();
      }, nextDelay);
    } catch (err) {
      if (this.stopped || !this.polling) return;

      const anyErr = err as Error & {
        retryAfter?: number;
        isRateLimited?: boolean;
        status?: number;
      };

      if (anyErr?.status === 404 || anyErr?.status === 401 || anyErr?.status === 403) {
        this.emitUpdate({
          status: "failed",
          errorMessage: anyErr.message || "Generation failed",
        });
        return;
      }

      const retryAfterMs =
        anyErr?.isRateLimited && typeof anyErr.retryAfter === "number"
          ? Math.max(1000, Math.floor(anyErr.retryAfter * 1000))
          : null;

      const nextDelay = Math.min(
        retryAfterMs ?? (this.pollDelay ? Math.floor(this.pollDelay * 1.5) : POLL_BASE_DELAY_MS),
        POLL_MAX_DELAY_MS,
      );

      this.pollDelay = nextDelay;
      this.pollTimeout = setTimeout(() => {
        void this.pollStatusOnce();
      }, nextDelay);
    }
  }

  private async connectWebSocket(): Promise<void> {
    if (this.stopped || isTerminal(this.snapshot.status)) return;

    if (this.ws) {
      const oldWs = this.ws;
      this.ws = null;
      // Neutralize handlers BEFORE closing to prevent stale onclose/onerror
      // from triggering reconnection storms.
      oldWs.onopen = null;
      oldWs.onmessage = null;
      oldWs.onerror = null;
      oldWs.onclose = null;
      if (
        oldWs.readyState === WebSocket.OPEN ||
        oldWs.readyState === WebSocket.CONNECTING
      ) {
        oldWs.close(1000, "New connection");
      }
    }

    const authState = useAuthStore.getState();
    const tokenExpiresAt = authState.tokenExpiresAt;
    const isExpiredOrClose = tokenExpiresAt
      ? Date.now() >= tokenExpiresAt - 30_000
      : false;

    if (isExpiredOrClose) {
      const refreshSuccess = await tokenManager.silentRefresh();
      if (!refreshSuccess) {
        this.emitUpdate({
          status: "failed",
          errorMessage: "Session expired",
        });
        return;
      }
    }

    const wsUrl = generateApi.getWebSocketUrl(this.taskId);
    const token = useAuthStore.getState().accessToken;
    const protocols = token ? ["jwt", token] : undefined;

    let ws: WebSocket;
    try {
      ws = new WebSocket(wsUrl, protocols);
    } catch (err) {
      logger.warn("WebSocket construction failed, falling back to polling", err);
      this.startPolling();
      return;
    }

    this.wsOpened = false;

    if (this.wsFallbackTimeout) {
      clearTimeout(this.wsFallbackTimeout);
      this.wsFallbackTimeout = null;
    }

    if (this.wsSilentFallbackTimeout) {
      clearTimeout(this.wsSilentFallbackTimeout);
      this.wsSilentFallbackTimeout = null;
    }

    this.wsFallbackTimeout = setTimeout(() => {
      if (this.stopped || isTerminal(this.snapshot.status)) return;
      if (this.wsOpened) return;
      this.startPolling();
    }, WS_FALLBACK_DELAY_MS);

    ws.onopen = () => {
      if (this.stopped || isTerminal(this.snapshot.status)) {
        ws.close(1000, "Task already finalized");
        return;
      }

      this.wsOpened = true;

      if (this.wsFallbackTimeout) {
        clearTimeout(this.wsFallbackTimeout);
        this.wsFallbackTimeout = null;
      }

      this.stopPolling();

      if (this.wsSilentFallbackTimeout) {
        clearTimeout(this.wsSilentFallbackTimeout);
        this.wsSilentFallbackTimeout = null;
      }

      this.wsSilentFallbackTimeout = setTimeout(() => {
        if (this.stopped || isTerminal(this.snapshot.status)) return;
        this.startPolling();
      }, WS_SILENT_FALLBACK_DELAY_MS);
    };

    ws.onmessage = (event) => {
      if (this.stopped || isTerminal(this.snapshot.status)) return;

      try {
        const message: WebSocketMessage = JSON.parse(event.data);
        if (message.type !== "progress_update") {
          return;
        }

        if (this.wsSilentFallbackTimeout) {
          clearTimeout(this.wsSilentFallbackTimeout);
          this.wsSilentFallbackTimeout = null;
        }

        this.emitUpdate({
          status: message.status ?? this.snapshot.status,
          progress: message.progress,
          statusMessage: message.status_message,
          errorMessage: message.error_message,
          photoUrl: message.photo_url,
          musclesUrl: message.muscles_url,
          quotaWarning: message.quota_warning,
          analyzedMuscles: message.analyzed_muscles,
        });

        this.stopPolling();

        if (!isTerminal(this.snapshot.status)) {
          this.wsSilentFallbackTimeout = setTimeout(() => {
            if (this.stopped || isTerminal(this.snapshot.status)) return;
            this.startPolling();
          }, WS_SILENT_FALLBACK_DELAY_MS);
        }
      } catch (err) {
        logger.error("Failed to parse generation WebSocket message", err);
      }
    };

    ws.onerror = () => {
      if (this.stopped || isTerminal(this.snapshot.status)) return;
      this.startPolling();
    };

    ws.onclose = () => {
      if (this.stopped || isTerminal(this.snapshot.status)) return;

      if (this.wsFallbackTimeout) {
        clearTimeout(this.wsFallbackTimeout);
        this.wsFallbackTimeout = null;
      }

      if (this.wsSilentFallbackTimeout) {
        clearTimeout(this.wsSilentFallbackTimeout);
        this.wsSilentFallbackTimeout = null;
      }

      // Even a "normal" close (1000) can happen when backend reloads gracefully
      // in dev; keep task tracking alive via HTTP polling.
      this.startPolling();
    };

    this.ws = ws;
  }
}

export function createGenerationTransport(
  taskId: string,
  callbacks: GenerationTransportCallbacks,
): GenerationTransport {
  return new GenerationTransport(taskId, callbacks);
}
