import { expect, type Page } from "@playwright/test";

export function getEnvInt(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : fallback;
}

export async function gotoWithRetry(
  page: { goto: (url: string, options?: { waitUntil?: "load" | "domcontentloaded" | "networkidle"; timeout?: number }) => Promise<unknown>; waitForTimeout: (ms: number) => Promise<void> },
  url: string,
  opts?: { timeoutMs?: number; waitUntil?: "load" | "domcontentloaded" | "networkidle" },
): Promise<void> {
  const timeoutMs = opts?.timeoutMs ?? 30_000;
  const waitUntil = opts?.waitUntil ?? "domcontentloaded";
  const startedAt = Date.now();
  let lastErr: unknown = null;

  while (Date.now() - startedAt < timeoutMs) {
    const remaining = timeoutMs - (Date.now() - startedAt);
    try {
      // Keep each attempt short so we can retry quickly on a dev-server restart.
      await page.goto(url, { waitUntil, timeout: Math.min(10_000, Math.max(1_000, remaining)) });
      return;
    } catch (err) {
      lastErr = err;
      const msg = String(err || "");
      const isConnRefused =
        msg.includes("ERR_CONNECTION_REFUSED") ||
        msg.includes("NS_ERROR_CONNECTION_REFUSED") ||
        msg.toLowerCase().includes("connection refused");
      if (!isConnRefused) throw err;
      // eslint-disable-next-line no-await-in-loop
      await page.waitForTimeout(250);
    }
  }

  throw lastErr;
}

export async function uiLoginWithToken(page: Page, token: string): Promise<void> {
  await gotoWithRetry(page, "/login", { timeoutMs: 30_000, waitUntil: "domcontentloaded" });
  await expect(page).toHaveURL(/\/login(?:\?|#|$)/, { timeout: 30_000 });

  const tokenInput = page
    .locator('input[name="token"], input#token, input[placeholder*="token" i]')
    .first();
  await expect(tokenInput).toBeVisible({ timeout: 60_000 });

  const submitButton = page
    .locator(
      'button[type="submit"], button:has-text("Sign In"), button:has-text("Sign"), button:has-text("Login"), button:has-text("Увійти")',
    )
    .first();
  await expect(submitButton).toBeVisible({ timeout: 60_000 });

  await tokenInput.click();
  await tokenInput.fill(token);

  // React hydration race guard: re-type until the submit button becomes enabled.
  for (let attempt = 0; attempt < 10; attempt += 1) {
    if (await submitButton.isEnabled().catch(() => false)) break;
    await page.waitForTimeout(200);
    await tokenInput.fill("");
    await tokenInput.type(token, { delay: 10 });
  }

  await expect(submitButton).toBeEnabled({ timeout: 10_000 });
  await submitButton.click();

  await page.waitForURL("/", { timeout: 30_000 });
  await page.waitForLoadState("domcontentloaded");
}

export function chunk<T>(items: T[], size: number): T[][] {
  if (size <= 0) return [items];
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

export async function concurrentAll<T>(
  tasks: Array<() => Promise<T>>,
  concurrency: number,
): Promise<T[]> {
  const results: T[] = [];
  const batches = chunk(tasks, concurrency);
  for (const batch of batches) {
    // eslint-disable-next-line no-await-in-loop
    const batchResults = await Promise.all(batch.map((fn) => fn()));
    results.push(...batchResults);
  }
  return results;
}

export function assertNo5xx(status: number, detail?: string): void {
  expect(
    status,
    detail ? `Unexpected 5xx: ${status} (${detail})` : `Unexpected 5xx: ${status}`,
  ).toBeLessThan(500);
}
