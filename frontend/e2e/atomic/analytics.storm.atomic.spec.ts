import { test, expect } from "@playwright/test";
import { assertNo5xx, concurrentAll, getEnvInt } from "./atomic-helpers";
import { authedFetch, loginWithToken, safeJson } from "./atomic-http";

const USER1_TOKEN =
  process.env.E2E_TEST_TOKEN || "e2e-test-token-playwright-2024";

const endpoints = [
  "/api/v1/analytics/overview",
  "/api/v1/analytics/muscles",
  "/api/v1/analytics/muscle-heatmap",
  "/api/v1/analytics/categories",
  "/api/v1/analytics/recent-activity",
  "/api/v1/analytics/body-part-balance",
  "/api/v1/analytics/summary",
] as const;

type Overview = {
  total_poses: number;
  total_categories: number;
  poses_with_photos: number;
  poses_with_muscles: number;
  total_muscles: number;
  completion_rate: number;
};

test.describe("Atomic analytics storm (no 5xx)", () => {
  test.describe.configure({ mode: "serial" });

  const concurrency = getEnvInt("ATOMIC_CONCURRENCY", 12);
  const iterations = getEnvInt("ATOMIC_ANALYTICS_ITER", 60);
  let accessToken = "";

  test.beforeAll(async () => {
    accessToken = (await loginWithToken(USER1_TOKEN)).accessToken;
  });

  test("overview schema is sane", async () => {
    const res = await authedFetch(accessToken, "/api/v1/analytics/overview");
    assertNo5xx(res.status, "analytics overview");
    expect(res.status).toBe(200);
    const json = (await res.json()) as Overview;
    expect(json.total_poses).toBeGreaterThanOrEqual(0);
    expect(json.total_categories).toBeGreaterThanOrEqual(0);
    expect(json.poses_with_photos).toBeGreaterThanOrEqual(0);
    expect(json.poses_with_muscles).toBeGreaterThanOrEqual(0);
    expect(json.total_muscles).toBeGreaterThanOrEqual(0);
    expect(json.completion_rate).toBeGreaterThanOrEqual(0);
    expect(json.completion_rate).toBeLessThanOrEqual(100);
  });

  for (const ep of endpoints) {
    test(`GET ${ep} returns JSON (no 5xx)`, async () => {
      const res = await authedFetch(accessToken, ep + "?e2e=1", {
        headers: { "Accept-Language": "uk" },
      });
      assertNo5xx(res.status, ep);
      expect(res.status).toBe(200);
      const json = await safeJson(res);
      expect(json).toBeDefined();
    });
  }

  test("storm: analytics endpoints under concurrency never 5xx", async () => {
    const tasks = Array.from({ length: iterations }, (_, i) => async () => {
      const ep = endpoints[i % endpoints.length];
      const res = await authedFetch(
        accessToken,
        `${ep}?storm=1&i=${i}`,
        {
          headers: { "Accept-Language": i % 2 ? "uk" : "en" },
        },
      );
      assertNo5xx(res.status, `${ep}#${i}`);
      await safeJson(res);
      return res.status;
    });

    const statuses = await concurrentAll(tasks, Math.min(concurrency, 16));
    expect(statuses.length).toBe(iterations);
    expect(statuses.every((s) => s === 200)).toBeTruthy();
  });
});
