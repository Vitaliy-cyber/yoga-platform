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
      name: `atomic json header ${Date.now()}`,
      category_id: categoryId,
    }),
  });
  assertNo5xx(res.status, "create pose for json header count");
  expect(res.status).toBe(201);
  const json = (await res.json()) as { id?: number };
  expect(typeof json.id).toBe("number");
  return json.id as number;
}

async function deletePose(accessToken: string, id: number): Promise<void> {
  const res = await authedFetch(accessToken, `/api/v1/poses/${id}`, { method: "DELETE" });
  expect([204, 404]).toContain(res.status);
}

async function exportPosesJson(accessToken: string, path: string): Promise<Response> {
  let res: Response | null = null;
  for (let attempt = 0; attempt < 6; attempt += 1) {
    // eslint-disable-next-line no-await-in-loop
    res = await authedFetch(accessToken, path);
    assertNo5xx(res.status, "export poses/json");
    if (res.status === 409 && attempt < 5) {
      // eslint-disable-next-line no-await-in-loop
      await new Promise((r) => setTimeout(r, 50 * (2 ** attempt)));
      continue;
    }
    break;
  }
  return res as Response;
}

test.describe("Atomic export poses JSON header counts (break-it; no 5xx)", () => {
  test.describe.configure({ mode: "serial" });

  test("X-Total-Items matches JSON length for filtered and full exports", async () => {
    const { accessToken } = await loginWithToken(makeIsolatedToken("export-json-header"));

    const suffix = Date.now().toString(36).slice(-8);
    const catA = `HdrCatA-${suffix}`;
    const catB = `HdrCatB-${suffix}`;
    const codeA = `HDR_A_${suffix}`.slice(0, 20);
    const codeB = `HDR_B_${suffix}`.slice(0, 20);

    let catAId: number | null = null;
    let catBId: number | null = null;
    let poseAId: number | null = null;
    let poseBId: number | null = null;

    try {
      catAId = await createCategory(accessToken, catA);
      catBId = await createCategory(accessToken, catB);
      poseAId = await createPose(accessToken, codeA, catAId);
      poseBId = await createPose(accessToken, codeB, catBId);

      const filteredRes = await exportPosesJson(accessToken, `/api/v1/export/poses/json?category_id=${catAId}`);
      expect(filteredRes.status).toBe(200);
      const filteredHeader = filteredRes.headers.get("x-total-items");
      expect(filteredHeader).toBe("1");
      const filteredJson = (await filteredRes.json()) as Array<{ code?: string }>;
      expect(filteredJson.length).toBe(1);
      expect(filteredJson[0]?.code).toBe(codeA);

      const fullRes = await exportPosesJson(accessToken, "/api/v1/export/poses/json");
      expect(fullRes.status).toBe(200);
      const fullHeader = fullRes.headers.get("x-total-items");
      expect(fullHeader).toBe("2");
      const fullJson = (await fullRes.json()) as Array<{ code?: string }>;
      expect(fullJson.length).toBe(2);
      const codes = fullJson.map((p) => p.code);
      expect(codes).toContain(codeA);
      expect(codes).toContain(codeB);
    } finally {
      if (poseAId) await deletePose(accessToken, poseAId);
      if (poseBId) await deletePose(accessToken, poseBId);
      if (catAId) await deleteCategory(accessToken, catAId);
      if (catBId) await deleteCategory(accessToken, catBId);
    }
  });
});
