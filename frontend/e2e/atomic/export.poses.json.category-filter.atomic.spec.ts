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

async function createPose(accessToken: string, code: string, categoryId?: number): Promise<number> {
  const res = await authedFetch(accessToken, "/api/v1/poses", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      code,
      name: `atomic json category ${Date.now()}`,
      category_id: categoryId,
    }),
  });
  assertNo5xx(res.status, "create pose for json category filter");
  expect(res.status).toBe(201);
  const json = (await res.json()) as { id?: number };
  expect(typeof json.id).toBe("number");
  return json.id as number;
}

async function deletePose(accessToken: string, id: number): Promise<void> {
  const res = await authedFetch(accessToken, `/api/v1/poses/${id}`, { method: "DELETE" });
  expect([204, 404]).toContain(res.status);
}

test.describe("Atomic export poses JSON category filter (break-it; no 5xx)", () => {
  test.describe.configure({ mode: "serial" });

  test("JSON export only returns poses in requested category", async () => {
    const { accessToken } = await loginWithToken(makeIsolatedToken("export-json-cat-filter"));

    const suffix = Date.now().toString(36).slice(-8);
    const catA = `JsonCatA-${suffix}`;
    const catB = `JsonCatB-${suffix}`;
    const codeA = `JSON_CAT_A_${suffix}`.slice(0, 20);
    const codeB = `JSON_CAT_B_${suffix}`.slice(0, 20);
    const codeNoCat = `JSON_CAT_N_${suffix}`.slice(0, 20);

    let catAId: number | null = null;
    let catBId: number | null = null;
    let poseAId: number | null = null;
    let poseBId: number | null = null;
    let poseNoCatId: number | null = null;

    try {
      catAId = await createCategory(accessToken, catA);
      catBId = await createCategory(accessToken, catB);

      poseAId = await createPose(accessToken, codeA, catAId);
      poseBId = await createPose(accessToken, codeB, catBId);
      poseNoCatId = await createPose(accessToken, codeNoCat);

      let res: Response | null = null;
      let payload: Array<{ code?: string }> = [];
      for (let attempt = 0; attempt < 6; attempt += 1) {
        // eslint-disable-next-line no-await-in-loop
        res = await authedFetch(accessToken, `/api/v1/export/poses/json?category_id=${catAId}`);
        assertNo5xx(res.status, "export poses/json filtered");
        if (res.status === 409 && attempt < 5) {
          // eslint-disable-next-line no-await-in-loop
          await new Promise((r) => setTimeout(r, 50 * (2 ** attempt)));
          continue;
        }
        expect(res.status).toBe(200);
        // eslint-disable-next-line no-await-in-loop
        payload = (await res.json()) as Array<{ code?: string }>;
        break;
      }

      expect(res).not.toBeNull();
      expect(res?.headers.get("x-total-items")).toBe("1");

      const codes = payload.map((p) => p.code);
      expect(codes).toContain(codeA);
      expect(codes).not.toContain(codeB);
      expect(codes).not.toContain(codeNoCat);
    } finally {
      if (poseAId) await deletePose(accessToken, poseAId);
      if (poseBId) await deletePose(accessToken, poseBId);
      if (poseNoCatId) await deletePose(accessToken, poseNoCatId);
      if (catAId) await deleteCategory(accessToken, catAId);
      if (catBId) await deleteCategory(accessToken, catBId);
    }
  });
});
