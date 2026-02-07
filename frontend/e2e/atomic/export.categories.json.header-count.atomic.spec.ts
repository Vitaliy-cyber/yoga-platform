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

test.describe("Atomic export categories JSON header counts (break-it; no 5xx)", () => {
  test.describe.configure({ mode: "serial" });

  test("X-Total-Items matches JSON length for categories export", async () => {
    const { accessToken } = await loginWithToken(makeIsolatedToken("export-cats-header"));

    const suffix = Date.now().toString(36).slice(-8);
    const nameA = `HdrCatA-${suffix}`;
    const nameB = `HdrCatB-${suffix}`;

    let catAId: number | null = null;
    let catBId: number | null = null;

    try {
      catAId = await createCategory(accessToken, nameA);
      catBId = await createCategory(accessToken, nameB);

      const res = await authedFetch(accessToken, "/api/v1/export/categories/json");
      assertNo5xx(res.status, "export categories/json header count");
      expect(res.status).toBe(200);

      const header = res.headers.get("x-total-items");
      expect(header).toBe("2");

      const json = (await res.json()) as Array<{ name?: string }>;
      expect(json.length).toBe(2);
      const names = json.map((c) => c.name);
      expect(names).toContain(nameA);
      expect(names).toContain(nameB);
    } finally {
      if (catAId) await deleteCategory(accessToken, catAId);
      if (catBId) await deleteCategory(accessToken, catBId);
    }
  });
});
