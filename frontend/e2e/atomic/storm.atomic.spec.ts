import { test, expect } from "@playwright/test";
import {
  login,
  getAccessToken,
  createCategory,
  deleteCategory,
  createPose,
  deletePose,
  getPoses,
} from "../test-api";
import { concurrentAll, getEnvInt, assertNo5xx } from "./atomic-helpers";

test.describe("Atomic storm (bulk/concurrent)", () => {
  const apiBase = process.env.PLAYWRIGHT_API_URL || "http://localhost:8000";
  const concurrency = getEnvInt("ATOMIC_CONCURRENCY", 20);
  const iterations = getEnvInt("ATOMIC_ITERATIONS", 80);

  test.beforeAll(async () => {
    await login();
    expect(getAccessToken()).toBeTruthy();
  });

  test("storm: /health (no 5xx under concurrency)", async () => {
    const tasks = Array.from({ length: iterations }, (_, i) => async () => {
      const res = await fetch(`${apiBase}/health?i=${i}`);
      assertNo5xx(res.status, "/health");
      return res.status;
    });
    const statuses = await concurrentAll(tasks, concurrency);
    expect(statuses.every((s) => s === 200)).toBeTruthy();
  });

  test("storm: list poses with fuzzed pagination (no 5xx)", async () => {
    const fuzz = [
      { skip: 0, limit: 1 },
      { skip: 0, limit: 100 },
      { skip: 0, limit: 500 },
      { skip: 1, limit: 10 },
      { skip: 10, limit: 10 },
      // Intentionally weird inputs (should 4xx, not 5xx)
      { skip: -1 as unknown as number, limit: 10 },
      { skip: 0, limit: -10 as unknown as number },
      { skip: 0, limit: 10_000 },
    ];

    const tasks = Array.from({ length: iterations }, (_, i) => async () => {
      const c = fuzz[i % fuzz.length];
      const url = `${apiBase}/api/v1/poses?skip=${encodeURIComponent(String(c.skip))}&limit=${encodeURIComponent(String(c.limit))}`;
      const res = await fetch(url, { headers: { Accept: "application/json" } });
      assertNo5xx(res.status, url);
      if (res.headers.get("content-type")?.includes("application/json")) {
        await res.json().catch(() => undefined);
      }
      return res.status;
    });

    const statuses = await concurrentAll(tasks, concurrency);
    expect(statuses.length).toBe(iterations);
  });

  test("bulk CRUD: categories + poses (parallel create/delete)", async () => {
    const createdCategoryIds: number[] = [];
    const createdPoseIds: number[] = [];

    const categoryCount = getEnvInt("ATOMIC_BULK_CATEGORIES", 20);
    const poseCount = getEnvInt("ATOMIC_BULK_POSES", 25);

    // Create categories
    const catTasks = Array.from(
      { length: categoryCount },
      (_, i) => async () => {
        const cat = await createCategory({
          name: `ATOMIC Category ${Date.now()} ${i}`,
          description: "Created by atomic E2E",
        });
        createdCategoryIds.push(cat.id);
        return cat.id;
      },
    );
    await concurrentAll(catTasks, Math.min(concurrency, 10));
    expect(createdCategoryIds.length).toBe(categoryCount);

    // Create poses distributed across created categories
    const poseTasks = Array.from({ length: poseCount }, (_, i) => async () => {
      const categoryId = createdCategoryIds[i % createdCategoryIds.length];
      const code =
        `A${Date.now().toString(36).slice(-8)}${i.toString(36)}`.slice(0, 20);
      const pose = await createPose({
        code,
        name: `ATOMIC Pose ${i}`,
        category_id: categoryId,
        description: "Created by atomic E2E",
      });
      createdPoseIds.push(pose.id);
      return pose.id;
    });
    await concurrentAll(poseTasks, Math.min(concurrency, 10));
    expect(createdPoseIds.length).toBe(poseCount);

    // Ensure listing doesn't crash
    const list = await getPoses(0, 500);
    expect(list.total).toBeGreaterThan(0);

    // Cleanup
    const deletePoseTasks = createdPoseIds.map((id) => async () => {
      await deletePose(id);
      return id;
    });
    await concurrentAll(deletePoseTasks, Math.min(concurrency, 10));

    const deleteCategoryTasks = createdCategoryIds.map((id) => async () => {
      await deleteCategory(id);
      return id;
    });
    await concurrentAll(deleteCategoryTasks, Math.min(concurrency, 10));
  });
});
