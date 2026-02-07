import { test, expect } from "@playwright/test";
import { login, getAccessToken, getPose } from "../test-api";
import { getCorePoseIdA } from "../test-data";
import { authedFetch, safeJson } from "./atomic-http";
import { assertNo5xx } from "./atomic-helpers";

test.describe("Atomic reanalyze muscles (fast mode; break-it; no hangs; no 5xx)", () => {
  test.describe.configure({ mode: "serial" });

  let accessToken = "";
  let poseId: number | null = null;

  test.beforeAll(async () => {
    await login();
    const token = getAccessToken();
    expect(token).toBeTruthy();
    accessToken = token as string;
    poseId = getCorePoseIdA() ?? null;
  });

  test("reanalyze-muscles completes quickly and returns a safe response", async () => {
    test.setTimeout(45_000);
    test.skip(!poseId, "Core seed pose not available");

    const pose = await getPose(poseId as number).catch(() => null);
    test.skip(!pose, "Pose not fetchable");
    test.skip(!pose?.photo_path, "Pose has no generated photo to analyze");

    const startedAt = Date.now();
    const res = await authedFetch(accessToken, `/api/v1/poses/${poseId as number}/reanalyze-muscles`, {
      method: "POST",
      headers: { Accept: "application/json" },
    });
    const elapsedMs = Date.now() - startedAt;

    // In atomic suites, long hangs are treated as regressions (dev fast mode must stay snappy).
    expect(elapsedMs).toBeLessThan(15_000);
    assertNo5xx(res.status, "reanalyze-muscles");

    // Accept a small set of expected outcomes, but never a server crash.
    expect([200, 400, 404, 409, 422].includes(res.status)).toBeTruthy();

    const body = await safeJson(res);
    expect(body).toBeTruthy();

    if (res.status === 200) {
      const muscles = (body as any)?.muscles;
      expect(Array.isArray(muscles)).toBeTruthy();
      expect((muscles as any[]).length).toBeGreaterThan(0);
    }
  });
});

