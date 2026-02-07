import { test, expect } from "@playwright/test";
import { assertNo5xx } from "./atomic-helpers";
import { authedFetch, loginWithToken, makeIsolatedToken } from "./atomic-http";

test.describe("Atomic export PDF long-word hardening (break-it; no 5xx)", () => {
  test.describe.configure({ mode: "serial" });

  test("PDF export survives very long unbroken text (no 5xx)", async () => {
    const accessToken = (await loginWithToken(makeIsolatedToken("export-pdf-longword"))).accessToken;

    const code = `PDFLW_${Date.now().toString(36).slice(-8)}`.slice(0, 20);
    const longWord = "A".repeat(4000);

    const createRes = await authedFetch(accessToken, "/api/v1/poses", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        code,
        name: "Long Word Pose",
        description: `prefix ${longWord} suffix`,
      }),
    });
    assertNo5xx(createRes.status, "create pose for longword pdf");
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
      assertNo5xx(res.status, "export pose pdf with long unbroken text");
      expect(res.status).toBe(200);
      const bytes = new Uint8Array(await res.arrayBuffer());
      expect(bytes.length).toBeGreaterThan(1000);
      const prefix = String.fromCharCode(...bytes.slice(0, 5));
      expect(prefix).toBe("%PDF-");
    } finally {
      await authedFetch(accessToken, `/api/v1/poses/${poseId}`, { method: "DELETE" }).catch(
        () => undefined,
      );
    }
  });
});
