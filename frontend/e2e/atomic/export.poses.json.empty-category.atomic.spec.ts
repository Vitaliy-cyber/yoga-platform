import { test, expect } from "@playwright/test";
import { assertNo5xx } from "./atomic-helpers";
import { authedFetch, loginWithToken, makeIsolatedToken } from "./atomic-http";

async function createCategory(accessToken: string, name: string): Promise<number> {
  const res = await authedFetch(accessToken, "/api/v1/categories", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name }),
  });
  assertNo5xx(res.status, "create category");
  expect(res.status).toBe(201);
  const json = (await res.json()) as { id?: number };
  expect(typeof json.id).toBe("number");
  return json.id as number;
}

async function deleteCategory(accessToken: string, id: number): Promise<void> {
  const res = await authedFetch(accessToken, `/api/v1/categories/${id}`, { method: "DELETE" });
  expect([204, 404]).toContain(res.status);
}

test.describe("Atomic export poses JSON empty category (break-it; no 5xx)", () => {
  test.describe.configure({ mode: "serial" });

  test("export returns 404 when category has no poses", async () => {
    const { accessToken } = await loginWithToken(makeIsolatedToken("export-json-empty-cat"));
    const suffix = Date.now().toString(36).slice(-8);
    const categoryName = `EmptyCat-${suffix}`;

    let categoryId: number | null = null;
    try {
      categoryId = await createCategory(accessToken, categoryName);
      const res = await authedFetch(accessToken, `/api/v1/export/poses/json?category_id=${categoryId}`);
      assertNo5xx(res.status, "export poses/json empty category");
      expect(res.status).toBe(404);
    } finally {
      if (categoryId) await deleteCategory(accessToken, categoryId);
    }
  });
});
