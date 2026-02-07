import { test, expect } from "@playwright/test";
import { assertNo5xx, concurrentAll, getEnvInt } from "./atomic-helpers";
import { authedFetch, loginWithToken, makeIsolatedToken, safeJson } from "./atomic-http";

test.describe("Atomic categories delete races (break-it; never 5xx)", () => {
  test.describe.configure({ mode: "serial" });

  test("concurrent DELETE same category yields 204/404/409 only (never 5xx)", async () => {
    const { accessToken } = await loginWithToken(makeIsolatedToken("cat-del-race"));

    const name = `atomic_del_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`.slice(
      0,
      60,
    );
    const created = await authedFetch(accessToken, "/api/v1/categories", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, description: "atomic delete race" }),
    });
    assertNo5xx(created.status, "create category");
    expect(created.status).toBe(201);
    const createdJson = (await created.json()) as { id: number };
    const categoryId = createdJson.id;
    expect(categoryId).toBeTruthy();

    const concurrency = Math.min(getEnvInt("ATOMIC_CATEGORY_DELETE_CONCURRENCY", 16), 32);
    const iterations = Math.max(concurrency, getEnvInt("ATOMIC_CATEGORY_DELETE_ITER", concurrency));

    const tasks = Array.from({ length: iterations }, () => async () => {
      const res = await authedFetch(accessToken, `/api/v1/categories/${categoryId}`, {
        method: "DELETE",
      });
      const status = res.status;
      assertNo5xx(status, "delete category");
      if (![204, 404, 409].includes(status)) {
        const body = await safeJson(res);
        throw new Error(`[atomic] unexpected status ${status} body=${JSON.stringify(body)}`);
      }
      return status;
    });

    const statuses = await concurrentAll(tasks, concurrency);
    expect(statuses).toContain(204);
  });
});

