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

test.describe("Atomic export CSV unicode/control hardening (break-it; no 5xx)", () => {
  test.describe.configure({ mode: "serial" });

  let accessToken = "";

  test.beforeAll(async () => {
    accessToken = (await loginWithToken(makeIsolatedToken("export-csv-unicode"))).accessToken;
  });

  test("CSV export neutralizes BOM-leading formulas and strips control chars", async () => {
    const code = `CSVU_${Date.now().toString(36).slice(-8)}`.slice(0, 20);
    const name = `\ufeff=2+2`;
    const description = `hello\u0000world`;

    const createRes = await authedFetch(accessToken, "/api/v1/poses", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ code, name, description }),
    });
    assertNo5xx(createRes.status, "create pose for csv unicode");
    expect(createRes.status).toBe(201);
    const created = (await createRes.json()) as { id?: number };
    expect(typeof created.id).toBe("number");
    const poseId = created.id as number;

    try {
      let res: Response | null = null;
      let text = "";
      for (let attempt = 0; attempt < 6; attempt += 1) {
        // eslint-disable-next-line no-await-in-loop
        res = await authedFetch(accessToken, "/api/v1/export/poses/csv");
        assertNo5xx(res.status, "export poses/csv with unicode");
        if (res.status === 409 && attempt < 5) {
          // eslint-disable-next-line no-await-in-loop
          await new Promise((r) => setTimeout(r, 50 * (2 ** attempt)));
          continue;
        }
        expect(res.status).toBe(200);
        // eslint-disable-next-line no-await-in-loop
        text = await res.text();
        break;
      }

      const lines = text.split(/\r?\n/).filter((l) => l.trim().length > 0);
      expect(lines.length).toBeGreaterThan(1);
      const dataLines = lines.slice(1);
      const row = dataLines
        .map((l) => parseCsvLine(l))
        .find((cols) => cols[0] === code);
      expect(row).toBeTruthy();
      const cols = row as string[];

      // code,name,name_en,category_name,description,effect,breathing,muscles
      expect(cols[1].startsWith("'")).toBeTruthy();
      expect(cols[1]).toContain("=2+2");
      expect(cols[4]).toContain("hello");
      expect(cols[4]).toContain("world");
      expect(cols[4]).not.toContain("\u0000");
    } finally {
      await authedFetch(accessToken, `/api/v1/poses/${poseId}`, { method: "DELETE" });
    }
  });
});
