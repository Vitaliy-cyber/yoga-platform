import { test, expect } from "@playwright/test";
import { assertNo5xx } from "./atomic-helpers";
import { authedFetch, loginWithToken, makeIsolatedToken } from "./atomic-http";

test.describe("Atomic export CSV apostrophe+formula roundtrip (break-it; no 5xx)", () => {
  test.describe.configure({ mode: "serial" });

  test("CSV export+import preserves leading apostrophe before formula triggers", async () => {
    const accessToken = (await loginWithToken(makeIsolatedToken("export-csv-apos-formula")))
      .accessToken;

    const code = `APO_${Date.now().toString(36).slice(-8)}`.slice(0, 20);
    const name = "'=2+2";

    const createRes = await authedFetch(accessToken, "/api/v1/poses", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ code, name }),
    });
    assertNo5xx(createRes.status, "create pose for apostrophe roundtrip");
    expect(createRes.status).toBe(201);
    const created = (await createRes.json()) as { id?: number };
    const poseId = created.id as number;

    let csvText = "";
    try {
      let res: Response | null = null;
      for (let attempt = 0; attempt < 6; attempt += 1) {
        // eslint-disable-next-line no-await-in-loop
        res = await authedFetch(accessToken, "/api/v1/export/poses/csv");
        assertNo5xx(res.status, "export poses csv");
        if (res.status === 409 && attempt < 5) {
          // eslint-disable-next-line no-await-in-loop
          await new Promise((r) => setTimeout(r, 50 * (2 ** attempt)));
          continue;
        }
        expect(res.status).toBe(200);
        // eslint-disable-next-line no-await-in-loop
        csvText = await res.text();
        break;
      }

      // Delete original pose so import will recreate it.
      await authedFetch(accessToken, `/api/v1/poses/${poseId}`, { method: "DELETE" });

      const form = new FormData();
      const blob = new Blob([new TextEncoder().encode(csvText)], { type: "text/csv" });
      form.append("file", blob, "poses.csv");

      const importRes = await authedFetch(accessToken, "/api/v1/import/poses/csv", {
        method: "POST",
        body: form,
      });
      assertNo5xx(importRes.status, "import poses csv");
      expect(importRes.status).toBe(200);

      const fetchRes = await authedFetch(
        accessToken,
        `/api/v1/poses/code/${encodeURIComponent(code)}`,
      );
      assertNo5xx(fetchRes.status, "fetch pose by code after import");
      expect(fetchRes.status).toBe(200);
      const fetched = (await fetchRes.json()) as { name?: string; id?: number };
      expect(fetched.name).toBe(name);

      if (typeof fetched.id === "number") {
        await authedFetch(accessToken, `/api/v1/poses/${fetched.id}`, { method: "DELETE" });
      }
    } finally {
      if (poseId) {
        await authedFetch(accessToken, `/api/v1/poses/${poseId}`, { method: "DELETE" }).catch(
          () => undefined,
        );
      }
    }
  });
});
