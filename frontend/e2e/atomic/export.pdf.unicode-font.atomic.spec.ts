import { test, expect } from "@playwright/test";
import { assertNo5xx } from "./atomic-helpers";
import { authedFetch, loginWithToken, makeIsolatedToken } from "./atomic-http";

test.describe("Atomic export PDF Unicode font support (break-it; no 5xx)", () => {
  test.describe.configure({ mode: "serial" });

  test("PDF export succeeds with Cyrillic text", async () => {
    const accessToken = (await loginWithToken(makeIsolatedToken("pdf-unicode"))).accessToken;
    const code = `PDFUA_${Date.now().toString(36).slice(-8)}`.slice(0, 20);

    const createRes = await authedFetch(accessToken, "/api/v1/poses", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        code,
        name: "Поза героя",
        description: "Це опис українською мовою з літерами Є, Ї, Ґ.",
      }),
    });
    assertNo5xx(createRes.status, "create pose for pdf unicode");
    expect(createRes.status).toBe(201);
    const created = (await createRes.json()) as { id?: number };
    expect(typeof created.id).toBe("number");
    const poseId = created.id as number;

    try {
      const res = await authedFetch(
        accessToken,
        `/api/v1/export/pose/${poseId}/pdf?include_photo=false&include_schema=false&include_muscle_layer=false&include_muscles_list=false&include_description=true&page_size=A4`,
        { headers: { Accept: "application/pdf" } },
      );
      assertNo5xx(res.status, "export pose pdf unicode");
      expect(res.status).toBe(200);
      expect(res.headers.get("content-type") || "").toContain("application/pdf");
      const bytes = new Uint8Array(await res.arrayBuffer());
      expect(bytes.length).toBeGreaterThan(500);
    } finally {
      await authedFetch(accessToken, `/api/v1/poses/${poseId}`, { method: "DELETE" });
    }
  });
});
