import { test, expect } from "@playwright/test";
import { assertNo5xx, concurrentAll, getEnvInt } from "./atomic-helpers";
import { authedFetch, loginWithToken, safeJson } from "./atomic-http";

const USER1_TOKEN =
  process.env.E2E_TEST_TOKEN || "e2e-test-token-playwright-2024";

test.describe("Atomic export + backup (no 5xx)", () => {
  test.describe.configure({ mode: "serial" });

  const concurrency = getEnvInt("ATOMIC_CONCURRENCY", 12);
  let accessToken = "";

  test.beforeAll(async () => {
    accessToken = (await loginWithToken(USER1_TOKEN)).accessToken;
  });

  test("backup returns JSON with expected headers (or 429) but never 5xx", async () => {
    const res = await authedFetch(accessToken, "/api/v1/export/backup");
    assertNo5xx(res.status, "export backup");
    expect([200, 429].includes(res.status)).toBeTruthy();

    if (res.status === 200) {
      expect(res.headers.get("content-type") || "").toContain("application/json");
      expect(res.headers.get("content-disposition") || "").toContain("attachment");
      const json = (await res.json()) as {
        metadata?: { total_poses?: number; total_categories?: number; exported_at?: string };
      };
      expect(json.metadata?.exported_at).toBeTruthy();
      expect(json.metadata?.total_poses).toBeGreaterThanOrEqual(0);
      expect(json.metadata?.total_categories).toBeGreaterThanOrEqual(0);
    } else {
      await safeJson(res);
    }
  });

  test("storm: backup endpoint under concurrency returns only 200/429 and never 5xx", async () => {
    const attempts = getEnvInt("ATOMIC_BACKUP_ATTEMPTS", 8);
    const tasks = Array.from({ length: attempts }, (_v, i) => async () => {
      const res = await authedFetch(accessToken, `/api/v1/export/backup?i=${i}`);
      assertNo5xx(res.status, `backup#${i}`);
      await safeJson(res);
      return res.status;
    });

    const statuses = await concurrentAll(tasks, Math.min(concurrency, 8));
    expect(statuses.length).toBe(attempts);
    expect(statuses.every((s) => s === 200 || s === 429)).toBeTruthy();
    expect(statuses.filter((s) => s === 200).length).toBeLessThanOrEqual(5);
  });

  test("export poses CSV never 5xx and has attachment headers", async () => {
    const res = await authedFetch(accessToken, "/api/v1/export/poses/csv");
    assertNo5xx(res.status, "export poses csv");
    expect([200, 404].includes(res.status)).toBeTruthy();
    if (res.status === 200) {
      expect(res.headers.get("content-type") || "").toContain("text/csv");
      expect(res.headers.get("content-disposition") || "").toContain("attachment");
      const text = await res.text();
      expect(text.length).toBeGreaterThan(0);
    }
  });
});
