import { test, expect } from "@playwright/test";
import { assertNo5xx, getEnvInt } from "./atomic-helpers";
import { authedFetch, loginWithToken, makeIsolatedToken, safeJson } from "./atomic-http";

test.describe("Atomic muscles create concurrency (break-it; no 5xx)", () => {
  test("concurrent create (same name) never 5xx (201/400/409 only)", async () => {
    const { accessToken } = await loginWithToken(makeIsolatedToken("muscle-create"));
    const name = `atomic_muscle_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`.slice(
      0,
      80,
    );
    const concurrency = getEnvInt("ATOMIC_MUSCLE_CREATE_CONCURRENCY", 40);

    const tasks = Array.from({ length: concurrency }, () => async () => {
      const res = await authedFetch(accessToken, "/api/v1/muscles", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, name_ua: "Атомік м'яз", body_part: "arms" }),
      });

      const status = res.status;
      assertNo5xx(status, "POST /muscles");

      if (status >= 400) {
        const json = await safeJson(res);
        if (json && typeof json === "object") {
          const detail = (json as { detail?: unknown }).detail;
          // Keep error responses JSON-parseable and non-amplifying.
          expect(String(detail ?? "").length).toBeLessThan(5000);
        }
      }

      return status;
    });

    const statuses = await Promise.all(tasks.map((t) => t()));

    expect(statuses, "at least one request should create the muscle").toContain(201);
    for (const s of statuses) {
      expect([201, 400, 409], `unexpected status: ${s}`).toContain(s);
    }
  });
});
