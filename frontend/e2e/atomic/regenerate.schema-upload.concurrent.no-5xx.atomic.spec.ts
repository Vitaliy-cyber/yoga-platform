import { test, expect } from "@playwright/test";
import { TEST_TOKEN } from "../fixtures";
import { authedFetch, loginWithToken, safeJson } from "./atomic-http";
import { assertNo5xx } from "./atomic-helpers";

const tinyPng = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR4nGNgYAAAAAMAASsJTYQAAAAASUVORK5CYII=",
  "base64",
);

test.describe("Atomic regenerate hardening: concurrent schema upload never 5xx", () => {
  test.describe.configure({ mode: "serial" });

  test("concurrent POST /poses/:id/schema returns 200/409 but never 5xx", async () => {
    const { accessToken } = await loginWithToken(TEST_TOKEN);
    expect(accessToken).toBeTruthy();

    const code = `SCHEMA_RACE_${Date.now().toString(36).slice(-10)}`.slice(0, 20);
    const createRes = await authedFetch(accessToken, "/api/v1/poses", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ code, name: `Atomic Schema Race ${code}` }),
    });
    assertNo5xx(createRes.status, "create pose (schema race)");
    expect(createRes.status).toBe(201);
    const poseId = ((await safeJson(createRes)) as { id?: number } | undefined)?.id as number;
    expect(typeof poseId).toBe("number");

    const uploadOnce = async (): Promise<Response> => {
      const form = new FormData();
      form.append("file", new Blob([tinyPng], { type: "image/png" }), "schema.png");
      return authedFetch(accessToken, `/api/v1/poses/${poseId as number}/schema`, {
        method: "POST",
        body: form,
      });
    };

    try {
      // Fire multiple uploads at once to force optimistic-lock races.
      const concurrency = 6;
      const results = await Promise.allSettled(
        Array.from({ length: concurrency }, () => uploadOnce()),
      );

      const statuses: number[] = [];
      for (const r of results) {
        if (r.status === "rejected") {
          throw r.reason;
        }
        statuses.push(r.value.status);
      }

      // Never allow a server error (regression guard against StaleDataError bubbling as 500).
      for (const st of statuses) {
        expect(st, `schema upload should not 5xx (statuses=${statuses.join(",")})`).toBeLessThan(500);
      }

      // At least one attempt should succeed; others may conflict (409) depending on backend locking.
      expect(statuses.some((s) => s === 200)).toBeTruthy();
    } finally {
      await authedFetch(accessToken, `/api/v1/poses/${poseId as number}`, { method: "DELETE" }).catch(
        () => undefined,
      );
    }
  });
});

