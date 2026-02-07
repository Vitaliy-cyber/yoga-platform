import { test, expect } from "@playwright/test";
import { assertNo5xx, concurrentAll, getEnvInt } from "./atomic-helpers";
import { authedFetch, loginWithToken, makeIsolatedToken, safeJson } from "./atomic-http";

const USER_TOKEN = process.env.E2E_TEST_TOKEN || "e2e-test-token-playwright-2024";

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

async function withRetry<T>(
  label: string,
  fn: () => Promise<{ status: number; ok: boolean; json?: () => Promise<T>; text?: () => Promise<string> }>,
  opts?: { attempts?: number; backoffMs?: number },
): Promise<{ status: number; ok: boolean; data?: T }> {
  const attempts = opts?.attempts ?? 10;
  const backoffMs = opts?.backoffMs ?? 40;
  let lastStatus = 0;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    // eslint-disable-next-line no-await-in-loop
    const res = await fn();
    lastStatus = res.status;
    assertNo5xx(res.status, label);
    if (res.ok) {
      if (res.json) {
        // eslint-disable-next-line no-await-in-loop
        const data = (await res.json()) as T;
        return { status: res.status, ok: true, data };
      }
      return { status: res.status, ok: true };
    }
    if (res.status === 409 || res.status === 429) {
      // eslint-disable-next-line no-await-in-loop
      await sleep(backoffMs + attempt * backoffMs);
      continue;
    }
    return { status: res.status, ok: false };
  }
  return { status: lastStatus, ok: false };
}

test.describe("Atomic extreme bulk CRUD (break-it; never 5xx)", () => {
  test.describe.configure({ mode: "serial" });

  const concurrency = Math.min(getEnvInt("ATOMIC_EXTREME_CONCURRENCY", 24), 40);
  const categoriesN = getEnvInt("ATOMIC_EXTREME_CATS", 60);
  const posesN = getEnvInt("ATOMIC_EXTREME_POSES", 120);

  let accessToken = "";
  const createdCategoryIds: number[] = [];
  const createdPoseIds: number[] = [];

  test.beforeAll(async () => {
    const token = makeIsolatedToken(`extreme-${Date.now().toString(36)}`) || USER_TOKEN;
    accessToken = (await loginWithToken(token)).accessToken;
    expect(accessToken).toBeTruthy();
  });

  test.afterAll(async () => {
    // Best-effort cleanup even if the test fails mid-way.
    const deletePoseTasks = createdPoseIds.map((id) => async () => {
      const res = await authedFetch(accessToken, `/api/v1/poses/${id}`, { method: "DELETE" });
      assertNo5xx(res.status, "cleanup delete pose");
      return res.status;
    });
    await concurrentAll(deletePoseTasks, Math.min(concurrency, 20)).catch(() => undefined);

    const deleteCategoryTasks = createdCategoryIds.map((id) => async () => {
      const res = await authedFetch(accessToken, `/api/v1/categories/${id}`, { method: "DELETE" });
      assertNo5xx(res.status, "cleanup delete category");
      return res.status;
    });
    await concurrentAll(deleteCategoryTasks, Math.min(concurrency, 20)).catch(() => undefined);
  });

  test("create many categories + poses + delete them under concurrency (no 5xx)", async () => {
    test.setTimeout(180_000);

    const createCategoryTasks = Array.from({ length: categoriesN }, (_, i) => async () => {
      const name = `ATOMIC_XCAT_${Date.now().toString(36)}_${i}`;
      const out = await withRetry<{ id: number }>(
        `create category #${i}`,
        async () => {
          const res = await authedFetch(accessToken, "/api/v1/categories", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ name, description: "atomic extreme" }),
          });
          return {
            status: res.status,
            ok: res.ok,
            json: async () => ((await safeJson(res)) as any) ?? (await res.json()),
          };
        },
      );
      expect(out.ok, `category create failed status=${out.status}`).toBeTruthy();
      const id = (out.data as any).id as number;
      createdCategoryIds.push(id);
      return id;
    });

    const categoryIds = await concurrentAll(createCategoryTasks, Math.min(concurrency, 20));
    expect(categoryIds.length).toBe(categoriesN);
    expect(createdCategoryIds.length).toBe(categoriesN);

    const createPoseTasks = Array.from({ length: posesN }, (_, i) => async () => {
      const categoryId = categoryIds[i % categoryIds.length];
      const code = `X${Date.now().toString(36).slice(-8)}${i.toString(36)}`.slice(0, 20);
      const out = await withRetry<{ id: number }>(
        `create pose #${i}`,
        async () => {
          const res = await authedFetch(accessToken, "/api/v1/poses", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ code, name: `Atomic XPose ${i}`, category_id: categoryId }),
          });
          return {
            status: res.status,
            ok: res.ok,
            json: async () => ((await safeJson(res)) as any) ?? (await res.json()),
          };
        },
      );
      expect(out.ok, `pose create failed status=${out.status}`).toBeTruthy();
      const id = (out.data as any).id as number;
      createdPoseIds.push(id);
      return id;
    });

    const poseIds = await concurrentAll(createPoseTasks, Math.min(concurrency, 20));
    expect(poseIds.length).toBe(posesN);
    expect(createdPoseIds.length).toBe(posesN);

    // Delete poses with high concurrency to provoke lock races.
    const deletePoseTasks = poseIds.map((id, i) => async () => {
      const res = await authedFetch(accessToken, `/api/v1/poses/${id}?i=${i}`, { method: "DELETE" });
      assertNo5xx(res.status, `delete pose #${i}`);
      expect([204, 404, 409]).toContain(res.status);
      return res.status;
    });
    const delPoseStatuses = await concurrentAll(deletePoseTasks, Math.min(concurrency, 24));
    expect(delPoseStatuses.length).toBe(posesN);

    // Then delete categories.
    const deleteCategoryTasks = categoryIds.map((id, i) => async () => {
      const res = await authedFetch(accessToken, `/api/v1/categories/${id}?i=${i}`, { method: "DELETE" });
      assertNo5xx(res.status, `delete category #${i}`);
      expect([204, 404, 409]).toContain(res.status);
      return res.status;
    });
    const delCatStatuses = await concurrentAll(deleteCategoryTasks, Math.min(concurrency, 24));
    expect(delCatStatuses.length).toBe(categoriesN);
  });
});

