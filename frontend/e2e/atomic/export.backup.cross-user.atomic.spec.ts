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
      name: `atomic backup ${Date.now()}`,
      category_id: categoryId,
    }),
  });
  assertNo5xx(res.status, "create pose for backup");
  expect(res.status).toBe(201);
  const json = (await res.json()) as { id?: number };
  expect(typeof json.id).toBe("number");
  return json.id as number;
}

async function deletePose(accessToken: string, id: number): Promise<void> {
  const res = await authedFetch(accessToken, `/api/v1/poses/${id}`, { method: "DELETE" });
  expect([204, 404]).toContain(res.status);
}

test.describe("Atomic export backup cross-user isolation (break-it; no 5xx)", () => {
  test.describe.configure({ mode: "serial" });

  test("backup returns only caller's data", async () => {
    const userA = await loginWithToken(makeIsolatedToken("backup-cross-a"));
    const userB = await loginWithToken(makeIsolatedToken("backup-cross-b"));

    const suffix = Date.now().toString(36).slice(-8);
    const categoryName = `BackupCat-${suffix}`;
    const code = `BACKUP_${suffix}`.slice(0, 20);

    let categoryId: number | null = null;
    let poseId: number | null = null;

    try {
      categoryId = await createCategory(userA.accessToken, categoryName);
      poseId = await createPose(userA.accessToken, code, categoryId);

      const resB = await authedFetch(userB.accessToken, "/api/v1/export/backup");
      assertNo5xx(resB.status, "backup user B");
      expect(resB.status).toBe(200);
      expect(resB.headers.get("x-total-poses")).toBe("0");
      expect(resB.headers.get("x-total-categories")).toBe("0");
      const jsonB = (await resB.json()) as { poses?: Array<{ code?: string }>; categories?: Array<{ name?: string }> };
      expect((jsonB.poses || []).length).toBe(0);
      expect((jsonB.categories || []).length).toBe(0);

      const resA = await authedFetch(userA.accessToken, "/api/v1/export/backup");
      assertNo5xx(resA.status, "backup user A");
      expect(resA.status).toBe(200);
      expect(resA.headers.get("x-total-poses")).toBe("1");
      expect(resA.headers.get("x-total-categories")).toBe("1");
      const jsonA = (await resA.json()) as { poses?: Array<{ code?: string }>; categories?: Array<{ name?: string }> };
      const codes = (jsonA.poses || []).map((p) => p.code);
      const categories = (jsonA.categories || []).map((c) => c.name);
      expect(codes).toContain(code);
      expect(categories).toContain(categoryName);
    } finally {
      if (poseId) await deletePose(userA.accessToken, poseId);
      if (categoryId) await deleteCategory(userA.accessToken, categoryId);
    }
  });
});
