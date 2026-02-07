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

test.describe("Atomic export CSV unicode separators hardening (break-it; no 5xx)", () => {
  test.describe.configure({ mode: "serial" });

  test("CSV export strips Unicode line/paragraph separators", async () => {
    const accessToken = (await loginWithToken(makeIsolatedToken("csv-unicode-sep"))).accessToken;
    const code = `CSVSEP_${Date.now().toString(36).slice(-8)}`.slice(0, 20);
    const description = `line1\u2028line2\u2029line3`;

    const createRes = await authedFetch(accessToken, "/api/v1/poses", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ code, name: `atomic csv sep ${Date.now()}`, description }),
    });
    assertNo5xx(createRes.status, "create pose for csv separators");
    expect(createRes.status).toBe(201);
    const created = (await createRes.json()) as { id?: number };
    expect(typeof created.id).toBe("number");
    const poseId = created.id as number;

    try {
      let text = "";
      for (let attempt = 0; attempt < 6; attempt += 1) {
        // eslint-disable-next-line no-await-in-loop
        const res = await authedFetch(accessToken, "/api/v1/export/poses/csv");
        assertNo5xx(res.status, "export poses/csv unicode separators");
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
      const row = lines
        .slice(1)
        .map((l) => parseCsvLine(l))
        .find((cols) => cols[0] === code);
      expect(row).toBeTruthy();
      const cols = row as string[];

      expect(cols[4]).not.toContain("\u2028");
      expect(cols[4]).not.toContain("\u2029");
    } finally {
      await authedFetch(accessToken, `/api/v1/poses/${poseId}`, { method: "DELETE" });
    }
  });
});
