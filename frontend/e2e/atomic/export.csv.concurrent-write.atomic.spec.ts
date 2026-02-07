import { test, expect } from "@playwright/test";
import { assertNo5xx, concurrentAll, getEnvInt } from "./atomic-helpers";
import { authedFetch, loginWithToken, makeIsolatedToken } from "./atomic-http";

test.describe("Atomic export CSV under concurrent writes (break-it; no 5xx)", () => {
  test.describe.configure({ mode: "serial" });

  test("concurrent writes + CSV export never 5xx", async () => {
    const accessToken = (await loginWithToken(makeIsolatedToken("export-csv-write"))).accessToken;
    const concurrency = Math.min(getEnvInt("ATOMIC_CONCURRENCY", 10), 6);

    const writerTask = (i: number) => async () => {
      const code = `CSVW_${Date.now().toString(36).slice(-6)}_${i}`.slice(0, 20);
      const createRes = await authedFetch(accessToken, "/api/v1/poses", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code, name: `Write Pose ${i}` }),
      });
      assertNo5xx(createRes.status, `create pose#${i}`);
      if (createRes.status !== 201) return createRes.status;
      const created = (await createRes.json()) as { id?: number };
      const poseId = created.id as number | undefined;
      if (poseId) {
        await authedFetch(accessToken, `/api/v1/poses/${poseId}`, { method: "DELETE" }).catch(
          () => undefined,
        );
      }
      return createRes.status;
    };

    const readerTask = (i: number) => async () => {
      const res = await authedFetch(accessToken, `/api/v1/export/poses/csv?i=${i}`);
      assertNo5xx(res.status, `export csv#${i}`);
      expect([200, 404, 409]).toContain(res.status);
      if (res.status === 200) {
        const text = await res.text();
        expect(text.length).toBeGreaterThan(0);
      }
      return res.status;
    };

    const tasks = [] as Array<() => Promise<number>>;
    for (let i = 0; i < 4; i += 1) tasks.push(writerTask(i));
    for (let i = 0; i < 6; i += 1) tasks.push(readerTask(i));

    const results = await concurrentAll(tasks, concurrency);
    expect(results.length).toBe(tasks.length);
    expect(results.every((s) => s < 500)).toBeTruthy();
  });
});
