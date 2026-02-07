import { expect } from "@playwright/test";
import { randomUUID } from "crypto";

const API_BASE_URL = process.env.PLAYWRIGHT_API_URL || "http://localhost:8000";

export type Json = Record<string, unknown> | unknown[] | string | number | boolean | null;

export function makeIsolatedToken(purpose: string): string {
  // Backend enforces max token length (<= 100 chars). Keep this generator safely under that.
  const base = process.env.E2E_TEST_TOKEN || "e2e-test-token-playwright-2024";
  const baseShort = base.replace(/[^a-z0-9-_]/gi, "-").slice(0, 32) || "e2e";
  const safePurpose = purpose.replace(/[^a-z0-9-_]/gi, "-").slice(0, 20) || "atomic";
  const pid = process.pid.toString(36).slice(-4);
  const ts = Date.now().toString(36).slice(-8);
  const rand = randomUUID().replace(/-/g, "").slice(0, 12);
  return `${baseShort}-${safePurpose}-${pid}-${ts}-${rand}`.slice(0, 100);
}

export async function waitForHealthyBackend(timeoutMs: number = 60_000): Promise<void> {
  const startedAt = Date.now();
  // eslint-disable-next-line no-constant-condition
  while (true) {
    try {
      const res = await fetch(`${API_BASE_URL}/health`);
      if (res.ok) return;
    } catch {
      // ignore
    }
    if (Date.now() - startedAt > timeoutMs) {
      throw new Error(`[atomic-http] backend did not become healthy in ${timeoutMs}ms`);
    }
    // eslint-disable-next-line no-await-in-loop
    await new Promise((r) => setTimeout(r, 250));
  }
}

export async function loginWithToken(token: string): Promise<{ accessToken: string; userId: number }> {
  await waitForHealthyBackend();

  const res = await fetch(`${API_BASE_URL}/api/v1/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify({ token }),
  });

  expect(res.status, "loginWithToken should not 5xx").toBeLessThan(500);
  if (!res.ok) {
    const txt = await res.text().catch(() => "");
    throw new Error(`[atomic-http] login failed: ${res.status} ${txt}`);
  }

  const json = (await res.json()) as { access_token: string; user: { id: number } };
  return { accessToken: json.access_token, userId: json.user.id };
}

export async function authedFetch(
  accessToken: string,
  path: string,
  init?: RequestInit,
): Promise<Response> {
  const headers = new Headers(init?.headers);
  headers.set("Authorization", `Bearer ${accessToken}`);
  if (!headers.has("Accept")) headers.set("Accept", "application/json");
  return fetch(`${API_BASE_URL}${path}`, { ...init, headers });
}

export async function safeJson(res: Response): Promise<Json | undefined> {
  const ct = res.headers.get("content-type") || "";
  if (!ct.includes("application/json")) return undefined;
  try {
    return (await res.json()) as Json;
  } catch {
    return undefined;
  }
}
