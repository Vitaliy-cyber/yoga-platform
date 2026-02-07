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
      name: `atomic backup headers ${Date.now()}`,
      category_id: categoryId,
    }),
  });
  assertNo5xx(res.status, "create pose for backup headers");
  expect(res.status).toBe(201);
  const json = (await res.json()) as { id?: number };
  expect(typeof json.id).toBe("number");
  return json.id as number;
}

async function deletePose(accessToken: string, id: number): Promise<void> {
  const res = await authedFetch(accessToken, `/api/v1/poses/${id}`, { method: "DELETE" });
  expect([204, 404]).toContain(res.status);
}

test.describe("Atomic export backup headers consistency (break-it; no 5xx)", () => {
  test.describe.configure({ mode: "serial" });

  test("headers match metadata totals and content-disposition is safe", async () => {
    const { accessToken } = await loginWithToken(makeIsolatedToken("backup-headers"));

    const suffix = Date.now().toString(36).slice(-8);
    const categoryName = `HdrCat-${suffix}`;
    const code = `HDRBK_${suffix}`.slice(0, 20);

    let categoryId: number | null = null;
    let poseId: number | null = null;

    try {
      categoryId = await createCategory(accessToken, categoryName);
      poseId = await createPose(accessToken, code, categoryId);

      const res = await authedFetch(accessToken, "/api/v1/export/backup");
      assertNo5xx(res.status, "export backup headers");
      expect(res.status).toBe(200);

      const cd = res.headers.get("content-disposition") || "";
      expect(cd.toLowerCase()).toContain("attachment");
      expect(cd).not.toMatch(/[\r\n]/);

      const headerPoses = res.headers.get("x-total-poses");
      const headerCategories = res.headers.get("x-total-categories");
      expect(headerPoses).toBe("1");
      expect(headerCategories).toBe("1");

      const json = (await res.json()) as {
        metadata?: { total_poses?: number; total_categories?: number };
        poses?: Array<{ code?: string }>;
        categories?: Array<{ name?: string }>;
      };

      expect(json.metadata?.total_poses).toBe(1);
      expect(json.metadata?.total_categories).toBe(1);
      expect((json.poses || []).length).toBe(1);
      expect((json.categories || []).length).toBe(1);
      expect((json.poses || []).some((p) => p.code === code)).toBeTruthy();
      expect((json.categories || []).some((c) => c.name === categoryName)).toBeTruthy();
    } finally {
      if (poseId) await deletePose(accessToken, poseId);
      if (categoryId) await deleteCategory(accessToken, categoryId);
    }
  });
});
