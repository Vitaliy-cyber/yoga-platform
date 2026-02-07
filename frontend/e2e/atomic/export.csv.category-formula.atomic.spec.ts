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

test.describe("Atomic export CSV category formula hardening (break-it; no 5xx)", () => {
  test.describe.configure({ mode: "serial" });

  test("category names starting with formula chars are neutralized in CSV", async () => {
    const accessToken = (await loginWithToken(makeIsolatedToken("export-csv-cat-formula")))
      .accessToken;

    const categoryName = `=CAT_${Date.now().toString(36).slice(-6)}`;
    const createCategoryRes = await authedFetch(accessToken, "/api/v1/categories", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: categoryName }),
    });
    assertNo5xx(createCategoryRes.status, "create category for csv");
    expect(createCategoryRes.status).toBe(201);
    const categoryJson = (await createCategoryRes.json()) as { id?: number };
    const categoryId = categoryJson.id as number;

    const code = `CATCSV_${Date.now().toString(36).slice(-6)}`.slice(0, 20);
    const createPoseRes = await authedFetch(accessToken, "/api/v1/poses", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ code, name: "category csv", category_id: categoryId }),
    });
    assertNo5xx(createPoseRes.status, "create pose for csv category");
    expect(createPoseRes.status).toBe(201);
    const poseJson = (await createPoseRes.json()) as { id?: number };
    const poseId = poseJson.id as number;

    try {
      let csvText = "";
      for (let attempt = 0; attempt < 6; attempt += 1) {
        // eslint-disable-next-line no-await-in-loop
        const res = await authedFetch(accessToken, "/api/v1/export/poses/csv");
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
      const row = lines
        .slice(1)
        .map((l) => parseCsvLine(l))
        .find((cols) => cols[0] === code);
      expect(row).toBeTruthy();
      const cols = row as string[];

      // category_name column should be formula-safe
      expect(cols[3].startsWith("'")).toBeTruthy();
      expect(cols[3]).toContain(categoryName);
    } finally {
      await authedFetch(accessToken, `/api/v1/poses/${poseId}`, { method: "DELETE" }).catch(
        () => undefined,
      );
      await authedFetch(accessToken, `/api/v1/categories/${categoryId}`, { method: "DELETE" }).catch(
        () => undefined,
      );
    }
  });
});
