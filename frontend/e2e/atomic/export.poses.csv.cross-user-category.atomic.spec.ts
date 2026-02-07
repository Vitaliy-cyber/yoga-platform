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

async function createPose(accessToken: string, code: string, categoryId: number): Promise<number> {
  const res = await authedFetch(accessToken, "/api/v1/poses", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      code,
      name: `atomic csv cross-user ${Date.now()}`,
      category_id: categoryId,
    }),
  });
  assertNo5xx(res.status, "create pose for cross-user csv export");
  expect(res.status).toBe(201);
  const json = (await res.json()) as { id?: number };
  expect(typeof json.id).toBe("number");
  return json.id as number;
}

async function deletePose(accessToken: string, id: number): Promise<void> {
  const res = await authedFetch(accessToken, `/api/v1/poses/${id}`, { method: "DELETE" });
  expect([204, 404]).toContain(res.status);
}

test.describe("Atomic export poses CSV cross-user category (break-it; no 5xx)", () => {
  test.describe.configure({ mode: "serial" });

  test("export with чужий category_id returns 404", async () => {
    const userA = await loginWithToken(makeIsolatedToken("export-csv-cross-a"));
    const userB = await loginWithToken(makeIsolatedToken("export-csv-cross-b"));

    const suffix = Date.now().toString(36).slice(-8);
    const categoryName = `CrossCsvCat-${suffix}`;
    const code = `CSV_X_${suffix}`.slice(0, 20);

    let categoryId: number | null = null;
    let poseId: number | null = null;

    try {
      categoryId = await createCategory(userA.accessToken, categoryName);
      poseId = await createPose(userA.accessToken, code, categoryId);

      const res = await authedFetch(userB.accessToken, `/api/v1/export/poses/csv?category_id=${categoryId}`);
      assertNo5xx(res.status, "export poses/csv cross-user category");
      expect(res.status).toBe(404);
    } finally {
      if (poseId) await deletePose(userA.accessToken, poseId);
      if (categoryId) await deleteCategory(userA.accessToken, categoryId);
    }
  });
});
