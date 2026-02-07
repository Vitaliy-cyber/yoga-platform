import { test, expect } from "@playwright/test";
import { assertNo5xx, getEnvInt } from "./atomic-helpers";
import { authedFetch, loginWithToken, makeIsolatedToken, safeJson } from "./atomic-http";

test.describe("Atomic muscles seed concurrency (break-it; idempotent; never 5xx)", () => {
  test("concurrent POST /muscles/seed never 5xx and always returns JSON list", async () => {
    const { accessToken } = await loginWithToken(makeIsolatedToken("muscle-seed"));
    const concurrency = getEnvInt("ATOMIC_MUSCLE_SEED_CONCURRENCY", 25);

    const tasks = Array.from({ length: concurrency }, () => async () => {
      const res = await authedFetch(accessToken, "/api/v1/muscles/seed", { method: "POST" });
      const status = res.status;
      assertNo5xx(status, "POST /muscles/seed");

      if (status === 200) {
        const json = await safeJson(res);
        expect(Array.isArray(json), "seed should return JSON array").toBeTruthy();
        expect((json as unknown[]).length, "seed should return non-empty list").toBeGreaterThan(10);
      } else {
        expect([200, 409], `unexpected status: ${status}`).toContain(status);
      }

      return status;
    });

    const statuses = await Promise.all(tasks.map((t) => t()));
    expect(statuses, "at least one seed call should succeed").toContain(200);
  });
});

