import { test, expect } from "@playwright/test";
import { login, getAccessToken } from "../test-api";
import { getCorePoseIdA, getCorePoseIdB } from "../test-data";
import { assertNo5xx, concurrentAll, getEnvInt } from "./atomic-helpers";

test.describe("Atomic compare fuzz", () => {
  const apiBase = process.env.PLAYWRIGHT_API_URL || "http://localhost:8000";
  const concurrency = getEnvInt("ATOMIC_CONCURRENCY", 20);

  test.beforeAll(async () => {
    await login();
    expect(getAccessToken()).toBeTruthy();
  });

  test("compare/poses handles invalid inputs without 5xx", async () => {
    const poseA = getCorePoseIdA();
    const poseB = getCorePoseIdB();
    test.skip(!poseA || !poseB, "Seed poses not available");

    const token = getAccessToken()!;
    const cases: Array<{ ids: string; okStatus: number[] }> = [
      { ids: `${poseA},${poseB}`, okStatus: [200] },
      { ids: `${poseA},${poseA},${poseB}`, okStatus: [200] }, // duplicates
      { ids: `${poseA}`, okStatus: [400] }, // too few
      { ids: `${poseA},${poseB},99999`, okStatus: [404] }, // missing pose
      { ids: `abc,${poseB}`, okStatus: [400] }, // invalid ids
      // Duplicates are removed by the backend before enforcing max length.
      { ids: `${poseA},${poseB},${poseA},${poseB},${poseA}`, okStatus: [200] },
    ];

    for (const c of cases) {
      // eslint-disable-next-line no-await-in-loop
      const res = await fetch(
        `${apiBase}/api/v1/compare/poses?ids=${encodeURIComponent(c.ids)}`,
        {
          headers: {
            Authorization: `Bearer ${token}`,
            Accept: "application/json",
          },
        },
      );
      assertNo5xx(res.status, `compare/poses?ids=${c.ids}`);
      expect(c.okStatus).toContain(res.status);
    }
  });

  test("compare/muscles storm (no 5xx)", async () => {
    const poseA = getCorePoseIdA();
    const poseB = getCorePoseIdB();
    test.skip(!poseA || !poseB, "Seed poses not available");
    const token = getAccessToken()!;

    const ids = `${poseA},${poseB}`;
    const tasks = Array.from({ length: 60 }, (_, i) => async () => {
      const res = await fetch(
        `${apiBase}/api/v1/compare/muscles?pose_ids=${encodeURIComponent(ids)}&i=${i}`,
        {
          headers: {
            Authorization: `Bearer ${token}`,
            Accept: "application/json",
          },
        },
      );
      assertNo5xx(res.status, "compare/muscles");
      expect([200, 400, 404, 403]).toContain(res.status);
      return res.status;
    });

    await concurrentAll(tasks, Math.min(concurrency, 15));
  });
});
