import { describe, it, expect, beforeEach, afterEach, vi, beforeAll, afterAll } from "vitest";
import { setupServer } from "msw/node";
import { http, HttpResponse } from "msw";
import { TokenManager } from "./api";
import { useAuthStore } from "../store/useAuthStore";

const server = setupServer();

const resetTokenManager = () => {
  (TokenManager as unknown as { instance: TokenManager | null }).instance = null;
};

const setAuthState = (overrides: Partial<ReturnType<typeof useAuthStore.getState>> = {}) => {
  useAuthStore.setState({
    user: { id: 1, name: "Test", created_at: "", last_login: "" },
    accessToken: "token",
    refreshToken: null,
    tokenExpiresAt: Date.now() + 3_600_000,
    isAuthenticated: true,
    isLoading: false,
    isRefreshing: false,
    refreshError: null,
    lastRefreshAt: null,
    ...overrides,
  });
};

beforeAll(() => {
  server.listen({ onUnhandledRequest: "error" });
});

afterAll(() => {
  server.close();
});

beforeEach(() => {
  resetTokenManager();
  server.resetHandlers();
  setAuthState();
  document.cookie = "csrf_token=; Max-Age=0; path=/";
});

afterEach(() => {
  const manager = TokenManager.getInstance();
  manager.stop();
});

describe("TokenManager", () => {
  it("skips refresh when token is valid", async () => {
    let refreshCount = 0;
    server.use(
      http.post("http://localhost:3000/api/v1/auth/refresh", () => {
        refreshCount += 1;
        return HttpResponse.json({
          access_token: "new-token",
          expires_in: 300,
          user: { id: 1, name: "Test" },
        });
      })
    );

    const manager = TokenManager.getInstance();
    const result = await manager.silentRefresh();

    expect(result).toBe(true);
    expect(refreshCount).toBe(0);
  });

  it("refreshes token when expired", async () => {
    server.use(
      http.post("http://localhost:3000/api/v1/auth/refresh", () => {
        return HttpResponse.json({
          access_token: "new-token",
          expires_in: 300,
          user: { id: 1, name: "Test" },
        });
      })
    );

    setAuthState({ tokenExpiresAt: Date.now() - 1000 });

    const manager = TokenManager.getInstance();
    const result = await manager.silentRefresh();

    expect(result).toBe(true);
    expect(useAuthStore.getState().accessToken).toBe("new-token");
  });

  it("sends CSRF and Authorization headers on refresh request", async () => {
    document.cookie = "csrf_token=test-csrf-token; path=/";

    server.use(
      http.post("http://localhost:3000/api/v1/auth/refresh", ({ request }) => {
        expect(request.headers.get("x-csrf-token")).toBe("test-csrf-token");
        expect(request.headers.get("authorization")).toBe("Bearer token");
        return HttpResponse.json({
          access_token: "new-token",
          expires_in: 300,
          user: { id: 1, name: "Test" },
        });
      })
    );

    setAuthState({ tokenExpiresAt: Date.now() - 1000 });

    const manager = TokenManager.getInstance();
    const result = await manager.silentRefresh();

    expect(result).toBe(true);
    expect(useAuthStore.getState().accessToken).toBe("new-token");
  });

  it("sends in-memory refresh token in refresh body and stores rotated token", async () => {
    let observedBody: unknown = null;

    server.use(
      http.post("http://localhost:3000/api/v1/auth/refresh", async ({ request }) => {
        observedBody = await request.json();
        return HttpResponse.json({
          access_token: "new-token",
          refresh_token: "rotated-refresh-token",
          expires_in: 300,
          user: { id: 1, name: "Test" },
        });
      })
    );

    setAuthState({
      tokenExpiresAt: Date.now() - 1_000,
      refreshToken: "in-memory-refresh-token",
    });

    const manager = TokenManager.getInstance();
    const result = await manager.silentRefresh();

    expect(result).toBe(true);
    expect(observedBody).toEqual({ refresh_token: "in-memory-refresh-token" });
    expect(useAuthStore.getState().refreshToken).toBe("rotated-refresh-token");
  });

  it("returns false on refresh 400 without throwing", async () => {
    server.use(
      http.post("http://localhost:3000/api/v1/auth/refresh", () => {
        return HttpResponse.json({ detail: "bad" }, { status: 400 });
      })
    );

    setAuthState({ tokenExpiresAt: Date.now() - 1000 });

    const manager = TokenManager.getInstance();
    const result = await manager.silentRefresh();

    expect(result).toBe(false);
    expect(useAuthStore.getState().isRefreshing).toBe(false);
  });

  it("returns false when offline", async () => {
    Object.defineProperty(navigator, "onLine", {
      value: false,
      configurable: true,
    });

    setAuthState({ tokenExpiresAt: Date.now() - 1000 });

    const manager = TokenManager.getInstance();
    const result = await manager.silentRefresh();

    expect(result).toBe(false);
    expect(useAuthStore.getState().refreshError).toBe("Network offline");

    Object.defineProperty(navigator, "onLine", {
      value: true,
      configurable: true,
    });
  });

  it("start is idempotent", () => {
    const addSpy = vi.spyOn(document, "addEventListener");
    const intervalSpy = vi.spyOn(globalThis, "setInterval");

    const manager = TokenManager.getInstance();
    manager.start();
    manager.start();

    expect(intervalSpy).toHaveBeenCalledTimes(1);
    expect(addSpy).toHaveBeenCalledWith("visibilitychange", expect.any(Function));
  });

  it("stop clears timers and listeners", () => {
    const removeSpy = vi.spyOn(document, "removeEventListener");
    const clearSpy = vi.spyOn(globalThis, "clearInterval");

    const manager = TokenManager.getInstance();
    manager.start();
    manager.stop();

    expect(clearSpy).toHaveBeenCalled();
    expect(removeSpy).toHaveBeenCalledWith("visibilitychange", expect.any(Function));
  });
});
