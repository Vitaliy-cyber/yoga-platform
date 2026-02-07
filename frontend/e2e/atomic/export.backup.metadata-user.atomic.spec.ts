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
      name: `atomic backup meta ${Date.now()}`,
      category_id: categoryId,
    }),
  });
  assertNo5xx(res.status, "create pose for backup metadata");
  expect(res.status).toBe(201);
  const json = (await res.json()) as { id?: number };
  expect(typeof json.id).toBe("number");
  return json.id as number;
}

async function deletePose(accessToken: string, id: number): Promise<void> {
  const res = await authedFetch(accessToken, `/api/v1/poses/${id}`, { method: "DELETE" });
  expect([204, 404]).toContain(res.status);
}

test.describe("Atomic export backup metadata user_id (break-it; no 5xx)", () => {
  test.describe.configure({ mode: "serial" });

  test("metadata.user_id matches current user", async () => {
    const login = await loginWithToken(makeIsolatedToken("backup-meta-user"));
    const accessToken = login.accessToken;
    const userId = login.userId;

    const suffix = Date.now().toString(36).slice(-8);
    const categoryName = `MetaCat-${suffix}`;
    const code = `META_${suffix}`.slice(0, 20);

    let categoryId: number | null = null;
    let poseId: number | null = null;

    try {
      categoryId = await createCategory(accessToken, categoryName);
      poseId = await createPose(accessToken, code, categoryId);

      const res = await authedFetch(accessToken, "/api/v1/export/backup");
      assertNo5xx(res.status, "export backup metadata");
      expect(res.status).toBe(200);

      const json = (await res.json()) as {
        metadata?: { user_id?: number; total_poses?: number; total_categories?: number };
      };
      expect(json.metadata?.user_id).toBe(userId);
      expect(json.metadata?.total_poses).toBe(1);
      expect(json.metadata?.total_categories).toBe(1);
    } finally {
      if (poseId) await deletePose(accessToken, poseId);
      if (categoryId) await deleteCategory(accessToken, categoryId);
    }
  });
});
