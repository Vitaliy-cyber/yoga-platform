import { test, expect } from "@playwright/test";
import { assertNo5xx } from "./atomic-helpers";
import { authedFetch, loginWithToken, makeIsolatedToken } from "./atomic-http";

test.describe("Atomic export poses JSON ordering (break-it; no 5xx)", () => {
  test.describe.configure({ mode: "serial" });

  test("JSON export is ordered by pose code", async () => {
    const { accessToken } = await loginWithToken(makeIsolatedToken("export-json-order"));
    const suffix = Date.now().toString(36).slice(-6);
    const codeA = `A_${suffix}`.slice(0, 20);
    const codeB = `Z_${suffix}`.slice(0, 20);

    const create = async (code: string): Promise<number> => {
      const res = await authedFetch(accessToken, "/api/v1/poses", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code, name: `atomic order ${code}` }),
      });
      assertNo5xx(res.status, `create pose ${code}`);
      expect(res.status).toBe(201);
      const json = (await res.json()) as { id?: number };
      expect(typeof json.id).toBe("number");
      return json.id as number;
    };

    let poseAId: number | null = null;
    let poseBId: number | null = null;

    try {
      poseBId = await create(codeB);
      poseAId = await create(codeA);

      let res: Response | null = null;
      let payload: Array<{ code?: string }> = [];
      for (let attempt = 0; attempt < 6; attempt += 1) {
        // eslint-disable-next-line no-await-in-loop
        res = await authedFetch(accessToken, "/api/v1/export/poses/json");
        assertNo5xx(res.status, "export poses/json ordering");
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

      expect(payload.length).toBe(2);
      const codes = payload.map((p) => p.code);
      expect(codes).toEqual([codeA, codeB]);
    } finally {
      if (poseAId) await authedFetch(accessToken, `/api/v1/poses/${poseAId}`, { method: "DELETE" });
      if (poseBId) await authedFetch(accessToken, `/api/v1/poses/${poseBId}`, { method: "DELETE" });
    }
  });
});
