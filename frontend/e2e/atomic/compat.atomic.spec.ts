import { test, expect } from "@playwright/test";
import { login, getAccessToken } from "../test-api";
import { assertNo5xx } from "./atomic-helpers";

test.describe("Atomic /api compatibility surface", () => {
  const apiBase = process.env.PLAYWRIGHT_API_URL || "http://localhost:8000";

  test.beforeAll(async () => {
    await login();
    expect(getAccessToken()).toBeTruthy();
  });

  test("deprecated /api routes respond without 5xx", async () => {
    const token = getAccessToken()!;

    const endpoints = [
      "/api/auth/me",
      "/api/categories",
      "/api/poses?skip=0&limit=50",
      "/api/sequences?skip=0&limit=50",
      "/api/analytics/summary",
    ];

    for (const path of endpoints) {
      // eslint-disable-next-line no-await-in-loop
      const res = await fetch(`${apiBase}${path}`, {
        headers: { Authorization: `Bearer ${token}`, Accept: "application/json" },
      });
      assertNo5xx(res.status, path);
      expect([200, 401, 403, 404]).toContain(res.status);
    }
  });
});
