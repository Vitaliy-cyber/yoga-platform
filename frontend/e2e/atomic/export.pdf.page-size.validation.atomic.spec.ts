import { test, expect } from "@playwright/test";
import { assertNo5xx } from "./atomic-helpers";
import { authedFetch, loginWithToken, makeIsolatedToken, safeJson } from "./atomic-http";

test.describe("Atomic export PDF page_size validation (break-it; no 5xx)", () => {
  test.describe.configure({ mode: "serial" });

  test("invalid page_size returns 422 for single and multi-pose exports", async () => {
    const accessToken = (await loginWithToken(makeIsolatedToken("export-pdf-page"))).accessToken;

    const code = `PDFPAGE_${Date.now().toString(36).slice(-8)}`.slice(0, 20);
    const createRes = await authedFetch(accessToken, "/api/v1/poses", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ code, name: `atomic pdf page ${Date.now()}` }),
    });
    assertNo5xx(createRes.status, "create pose for pdf page_size");
    expect(createRes.status).toBe(201);
    const created = (await createRes.json()) as { id?: number };
    expect(typeof created.id).toBe("number");
    const poseId = created.id as number;

    try {
      const paths = [
        `/api/v1/export/pose/${poseId}/pdf?page_size=NotARealSize`,
        "/api/v1/export/poses/pdf?page_size=NotARealSize",
      ];

      for (const path of paths) {
        // eslint-disable-next-line no-await-in-loop
        const res = await authedFetch(accessToken, path, { headers: { Accept: "application/json" } });
        assertNo5xx(res.status, `export pdf invalid page_size ${path}`);
        expect(res.status).toBe(422);
        // eslint-disable-next-line no-await-in-loop
        await safeJson(res);
      }
    } finally {
      await authedFetch(accessToken, `/api/v1/poses/${poseId}`, { method: "DELETE" });
    }
  });
});
