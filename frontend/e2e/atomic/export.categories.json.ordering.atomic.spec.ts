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

test.describe("Atomic export categories JSON ordering (break-it; no 5xx)", () => {
  test.describe.configure({ mode: "serial" });

  test("categories are ordered by name", async () => {
    const { accessToken } = await loginWithToken(makeIsolatedToken("export-cats-order"));

    const suffix = Date.now().toString(36).slice(-8);
    const nameA = `A-${suffix}`;
    const nameB = `B-${suffix}`;

    let catAId: number | null = null;
    let catBId: number | null = null;

    try {
      // Create in reverse order to verify export sorting.
      catBId = await createCategory(accessToken, nameB);
      catAId = await createCategory(accessToken, nameA);

      const res = await authedFetch(accessToken, "/api/v1/export/categories/json");
      assertNo5xx(res.status, "export categories json ordering");
      expect(res.status).toBe(200);
      const json = (await res.json()) as Array<{ name?: string }>;
      const names = json.map((c) => c.name);
      const idxA = names.indexOf(nameA);
      const idxB = names.indexOf(nameB);
      expect(idxA).toBeGreaterThanOrEqual(0);
      expect(idxB).toBeGreaterThanOrEqual(0);
      expect(idxA).toBeLessThan(idxB);
    } finally {
      if (catAId) await deleteCategory(accessToken, catAId);
      if (catBId) await deleteCategory(accessToken, catBId);
    }
  });
});
