import { test, expect } from "@playwright/test";
import { assertNo5xx } from "./atomic-helpers";
import { authedFetch, loginWithToken, makeIsolatedToken } from "./atomic-http";

test.describe("Atomic export PDF filename sanitization (break-it; no 5xx)", () => {
  test.describe.configure({ mode: "serial" });

  test("Content-Disposition filename strips path traversal characters", async () => {
    const accessToken = (await loginWithToken(makeIsolatedToken("export-pdf-filename"))).accessToken;

    const code = "../EVIL/..//PDF";
    const name = "..\\\\..\\\\evil/name";

    const createRes = await authedFetch(accessToken, "/api/v1/poses", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ code, name }),
    });
    assertNo5xx(createRes.status, "create pose for pdf filename sanitization");
    expect(createRes.status).toBe(201);
    const created = (await createRes.json()) as { id?: number };
    expect(typeof created.id).toBe("number");
    const poseId = created.id as number;

    try {
      const res = await authedFetch(
        accessToken,
        `/api/v1/export/pose/${poseId}/pdf?include_photo=false&include_schema=false&include_muscle_layer=false&include_muscles_list=false&include_description=false&page_size=A4`,
        { headers: { Accept: "application/pdf" } },
      );
      assertNo5xx(res.status, "export pose pdf filename sanitization");
      expect(res.status).toBe(200);

      const cd = res.headers.get("content-disposition") || "";
      expect(cd.toLowerCase()).toContain("attachment");
      expect(cd).toContain("filename=");
      expect(cd).not.toMatch(/[\r\n]/);

      const match = cd.match(/filename=\"?([^\";]+)\"?/i);
      const filename = match?.[1] || "";
      expect(filename).toBeTruthy();
      expect(filename).toMatch(/\.pdf$/i);
      expect(filename).not.toMatch(/[\\/]/);
      expect(filename).not.toContain("..");
    } finally {
      await authedFetch(accessToken, `/api/v1/poses/${poseId}`, { method: "DELETE" }).catch(
        () => undefined,
      );
    }
  });
});
