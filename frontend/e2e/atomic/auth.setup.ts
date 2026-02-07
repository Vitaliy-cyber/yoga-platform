import { test as setup, expect } from "@playwright/test";
import { TEST_TOKEN } from "../fixtures";
import fs from "fs";
import path from "path";
import { gotoWithRetry } from "./atomic-helpers";

const authFile = "playwright/.auth/user.json";
const API_BASE_URL = process.env.PLAYWRIGHT_API_URL || "http://127.0.0.1:8000";

// Atomic suite runs from `e2e/atomic`, so we need a local `*.setup.ts`
// to satisfy the shared project's dependency on `setup`.
setup("authenticate", async ({ page }) => {
  fs.mkdirSync(path.dirname(authFile), { recursive: true });

  // Make setup resilient:
  // - Avoid relying on /login UI mounting under heavy atomic load.
  // - Seed auth via API + localStorage + cookies, then save storageState.
  const loginRes = await page.request.post(`${API_BASE_URL}/api/v1/auth/login`, {
    data: { token: TEST_TOKEN },
  });
  expect(loginRes.status(), "auth.setup login").toBe(200);
  const loginJson = (await loginRes.json()) as { access_token: string; expires_in?: number };
  const accessToken = loginJson.access_token;
  expect(accessToken).toBeTruthy();

  const meRes = await page.request.get(`${API_BASE_URL}/api/v1/auth/me`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  expect(meRes.status(), "auth.setup auth/me").toBe(200);
  const meJson = (await meRes.json()) as
    | { id?: number; name?: string | null; created_at?: string; last_login?: string | null }
    | undefined;
  expect(typeof meJson?.id).toBe("number");

  // Carry refresh+csrf cookies into the browser context (so CSRF-protected endpoints still work).
  const setCookies = loginRes
    .headersArray()
    .filter((h) => h.name.toLowerCase() === "set-cookie")
    .map((h) => h.value);
  const parsedCookies = setCookies
    .map((raw) => raw.split(";").map((p) => p.trim()))
    .map((parts) => {
      const [nameValue, ...attrs] = parts;
      const eq = nameValue.indexOf("=");
      if (eq <= 0) return null;
      const name = nameValue.slice(0, eq);
      const value = nameValue.slice(eq + 1);
      const pathAttr = attrs.find((a) => a.toLowerCase().startsWith("path="));
      const pathValue = pathAttr ? pathAttr.slice("path=".length) : "/";
      const httpOnly = attrs.some((a) => a.toLowerCase() === "httponly");
      const secure = attrs.some((a) => a.toLowerCase() === "secure");
      const sameSiteAttr = attrs.find((a) => a.toLowerCase().startsWith("samesite="));
      const sameSiteRaw = sameSiteAttr ? sameSiteAttr.split("=", 2)[1] : undefined;
      const sameSite =
        sameSiteRaw?.toLowerCase() === "strict"
          ? "Strict"
          : sameSiteRaw?.toLowerCase() === "none"
            ? "None"
            : "Lax";
      return {
        name,
        value,
        domain: "127.0.0.1",
        path: pathValue,
        httpOnly,
        secure,
        sameSite: sameSite as "Lax" | "Strict" | "None",
      };
    })
    .filter((c): c is NonNullable<typeof c> => Boolean(c))
    .filter((c) => c.name === "refresh_token" || c.name === "csrf_token");
  if (parsedCookies.length) await page.context().addCookies(parsedCookies);

  const expiresIn = Number.isFinite(loginJson.expires_in) ? Number(loginJson.expires_in) : 60 * 60;
  const authKey = "yoga_auth_token";
  const authValue = JSON.stringify({
    state: {
      user: {
        id: meJson?.id as number,
        name: (meJson?.name ?? null) as string | null,
        created_at: (meJson?.created_at ?? new Date().toISOString()) as string,
        last_login: (meJson?.last_login ?? null) as string | null,
      },
      accessToken,
      tokenExpiresAt: Date.now() + expiresIn * 1000,
    },
    version: 0,
  });
  await page.addInitScript(
    ({ k, v }) => {
      window.localStorage.setItem(k, v);
    },
    { k: authKey, v: authValue },
  );

  await gotoWithRetry(page, "/", { timeoutMs: 60_000, waitUntil: "domcontentloaded" });

  await page.context().storageState({ path: authFile });
});
