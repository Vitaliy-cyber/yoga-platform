import { test, expect } from "@playwright/test";
import { assertNo5xx } from "./atomic-helpers";
import { authedFetch, loginWithToken, makeIsolatedToken } from "./atomic-http";

function parseCsvLine(line: string): string[] {
  const out: string[] = [];
  let current = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i];
    if (inQuotes) {
      if (ch === '"' && line[i + 1] === '"') {
        current += '"';
        i += 1;
      } else if (ch === '"') {
        inQuotes = false;
      } else {
        current += ch;
      }
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === ",") {
      out.push(current);
      current = "";
    } else {
      current += ch;
    }
  }
  out.push(current);
  return out;
}

test.describe("Atomic export CSV formula roundtrip (break-it; no 5xx)", () => {
  test.describe.configure({ mode: "serial" });

  test("CSV export+import restores formula-leading fields (no stray apostrophes)", async () => {
    const accessToken = (await loginWithToken(makeIsolatedToken("export-csv-roundtrip"))).accessToken;

    const code = (`=CSVRT_${Date.now().toString(36).slice(-6)}`).slice(0, 20);
    const name = "=2+2";
    const description = "@SUM(1,1)";

    const createRes = await authedFetch(accessToken, "/api/v1/poses", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ code, name, description }),
    });
    assertNo5xx(createRes.status, "create pose for csv roundtrip");
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

      const lines = csvText.split(/\r?\n/).filter((l) => l.trim().length > 0);
      expect(lines.length).toBeGreaterThan(1);
      const dataLines = lines.slice(1);
      const expectedCodeCell = `'${code}`;
      const row = dataLines
        .map((l) => parseCsvLine(l))
        .find((cols) => cols[0] === expectedCodeCell);
      expect(row).toBeTruthy();
      const cols = row as string[];

      // Ensure export sanitized formula-leading fields.
      expect(cols[0]).toBe(expectedCodeCell);
      expect(cols[1]).toBe(`'${name}`);
      expect(cols[4]).toBe(`'${description}`);

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
      const fetched = (await fetchRes.json()) as { name?: string; description?: string; id?: number };
      expect(fetched.name).toBe(name);
      expect(fetched.description).toBe(description);
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
