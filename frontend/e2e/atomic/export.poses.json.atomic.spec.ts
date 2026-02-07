import { test, expect } from "@playwright/test";
import { assertNo5xx } from "./atomic-helpers";
import { authedFetch, loginWithToken, makeIsolatedToken } from "./atomic-http";

test.describe("Atomic export poses JSON (break-it; no 5xx)", () => {
  test.describe.configure({ mode: "serial" });

  test("empty user returns 404; created pose appears in JSON export", async () => {
    const accessToken = (await loginWithToken(makeIsolatedToken("export-poses-json"))).accessToken;

    const emptyRes = await authedFetch(accessToken, "/api/v1/export/poses/json");
    assertNo5xx(emptyRes.status, "export poses json empty");
    expect(emptyRes.status).toBe(404);

    const code = `JSON_${Date.now().toString(36).slice(-8)}`.slice(0, 20);
    const createRes = await authedFetch(accessToken, "/api/v1/poses", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ code, name: "export json pose" }),
    });
    assertNo5xx(createRes.status, "create pose for export json");
    expect(createRes.status).toBe(201);
    const created = (await createRes.json()) as { id?: number };
    const poseId = created.id as number;

    try {
      let res: Response | null = null;
      let jsonText = "";
      for (let attempt = 0; attempt < 6; attempt += 1) {
        // eslint-disable-next-line no-await-in-loop
        res = await authedFetch(accessToken, "/api/v1/export/poses/json");
        assertNo5xx(res.status, "export poses json");
        if (res.status === 409 && attempt < 5) {
          // eslint-disable-next-line no-await-in-loop
          await new Promise((r) => setTimeout(r, 50 * (2 ** attempt)));
          continue;
        }
        expect(res.status).toBe(200);
        // eslint-disable-next-line no-await-in-loop
        jsonText = await res.text();
        break;
      }

      expect(jsonText.length).toBeGreaterThan(2);
      const data = JSON.parse(jsonText) as Array<{ code?: string }>;
      expect(Array.isArray(data)).toBeTruthy();
      expect(data.some((p) => p.code === code)).toBeTruthy();
    } finally {
      if (poseId) {
        await authedFetch(accessToken, `/api/v1/poses/${poseId}`, { method: "DELETE" }).catch(
          () => undefined,
        );
      }
    }
  });
});
