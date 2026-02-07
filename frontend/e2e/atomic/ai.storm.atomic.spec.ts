import { test, expect } from "@playwright/test";
import {
  login,
  generateFromSchema,
  waitForGenerateCompleted,
  getAccessToken,
} from "../test-api";
import { concurrentAll, getEnvInt, assertNo5xx } from "./atomic-helpers";

test.describe("Atomic AI storm (real endpoints, no mocks)", () => {
  const concurrency = getEnvInt("ATOMIC_AI_CONCURRENCY", 4);
  const iterations = getEnvInt("ATOMIC_AI_ITERATIONS", 8);

  test.beforeAll(async () => {
    await login();
    expect(getAccessToken()).toBeTruthy();
  });

  test("generation create+poll does not 5xx under small concurrency", async () => {
    // Minimal valid PNG (1x1 pixel).
    const buffer = Uint8Array.from(
      Buffer.from(
        "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAOq2G7kAAAAASUVORK5CYII=",
        "base64",
      ),
    );

    const tasks = Array.from({ length: iterations }, (_, i) => async () => {
      const started = await generateFromSchema(
        buffer,
        `atomic-${i}.png`,
        "image/png",
        "atomic e2e",
      );
      const done = await waitForGenerateCompleted(started.task_id, 60_000);
      expect(done.status).toBe("completed");
      expect(done.photo_url || done.muscles_url).toBeTruthy();
      return done.task_id;
    });

    const taskIds = await concurrentAll(tasks, concurrency);
    expect(taskIds.length).toBe(iterations);
  });

  test("unknown task id returns 4xx (no 5xx)", async () => {
    const apiBase = process.env.PLAYWRIGHT_API_URL || "http://localhost:8000";
    const res = await fetch(
      `${apiBase}/api/v1/generate/status/does-not-exist`,
      {
        headers: { Accept: "application/json" },
      },
    );
    assertNo5xx(res.status, "status unknown task");
    expect([400, 401, 403, 404, 422]).toContain(res.status);
  });
});
