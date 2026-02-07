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
      name: `atomic pdf category ${Date.now()}`,
      category_id: categoryId,
    }),
  });
  assertNo5xx(res.status, "create pose for pdf category filter");
  expect(res.status).toBe(201);
  const json = (await res.json()) as { id?: number };
  expect(typeof json.id).toBe("number");
  return json.id as number;
}

async function deletePose(accessToken: string, id: number): Promise<void> {
  const res = await authedFetch(accessToken, `/api/v1/poses/${id}`, { method: "DELETE" });
  expect([204, 404]).toContain(res.status);
}

test.describe("Atomic export poses PDF category filter (break-it; no 5xx)", () => {
  test.describe.configure({ mode: "serial" });

  test("category filter returns 200 only when category has poses", async () => {
    const { accessToken } = await loginWithToken(makeIsolatedToken("export-pdf-cat-filter"));

    const suffix = Date.now().toString(36).slice(-8);
    const catWithPose = `PdfCatA-${suffix}`;
    const catEmpty = `PdfCatB-${suffix}`;
    const code = `PDF_CAT_${suffix}`.slice(0, 20);

    let catAId: number | null = null;
    let catBId: number | null = null;
    let poseId: number | null = null;

    try {
      catAId = await createCategory(accessToken, catWithPose);
      catBId = await createCategory(accessToken, catEmpty);
      poseId = await createPose(accessToken, code, catAId);

      const resA = await authedFetch(
        accessToken,
        `/api/v1/export/poses/pdf?category_id=${catAId}`,
        { headers: { Accept: "application/pdf" } },
      );
      assertNo5xx(resA.status, "export poses/pdf category A");
      expect(resA.status).toBe(200);
      expect(resA.headers.get("content-type") || "").toContain("application/pdf");
      const bytes = new Uint8Array(await resA.arrayBuffer());
      expect(bytes.length).toBeGreaterThan(512);
      const prefix = String.fromCharCode(...bytes.slice(0, 5));
      expect(prefix).toBe("%PDF-");

      const resB = await authedFetch(
        accessToken,
        `/api/v1/export/poses/pdf?category_id=${catBId}`,
        { headers: { Accept: "application/pdf" } },
      );
      assertNo5xx(resB.status, "export poses/pdf category B");
      expect(resB.status).toBe(404);
    } finally {
      if (poseId) await deletePose(accessToken, poseId);
      if (catAId) await deleteCategory(accessToken, catAId);
      if (catBId) await deleteCategory(accessToken, catBId);
    }
  });
});
