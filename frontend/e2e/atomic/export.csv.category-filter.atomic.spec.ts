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

async function createCategory(accessToken: string, name: string): Promise<number> {
  const res = await authedFetch(accessToken, "/api/v1/categories", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name }),
  });
  assertNo5xx(res.status, "create category");
  expect(res.status).toBe(201);
  const json = (await res.json()) as { id?: number };
  expect(typeof json.id).toBe("number");
  return json.id as number;
}

async function deleteCategory(accessToken: string, id: number): Promise<void> {
  const res = await authedFetch(accessToken, `/api/v1/categories/${id}`, { method: "DELETE" });
  expect([204, 404]).toContain(res.status);
}

async function createPose(accessToken: string, code: string, categoryId?: number): Promise<number> {
  const res = await authedFetch(accessToken, "/api/v1/poses", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      code,
      name: `atomic csv category ${Date.now()}`,
      category_id: categoryId,
    }),
  });
  assertNo5xx(res.status, "create pose for csv category filter");
  expect(res.status).toBe(201);
  const json = (await res.json()) as { id?: number };
  expect(typeof json.id).toBe("number");
  return json.id as number;
}

async function deletePose(accessToken: string, id: number): Promise<void> {
  const res = await authedFetch(accessToken, `/api/v1/poses/${id}`, { method: "DELETE" });
  expect([204, 404]).toContain(res.status);
}

test.describe("Atomic export CSV category filter (break-it; no 5xx)", () => {
  test.describe.configure({ mode: "serial" });

  test("CSV export only returns poses in requested category", async () => {
    const { accessToken } = await loginWithToken(makeIsolatedToken("export-csv-cat-filter"));

    const suffix = Date.now().toString(36).slice(-8);
    const catA = `CatA-${suffix}`;
    const catB = `CatB-${suffix}`;
    const codeA = `CSV_CAT_A_${suffix}`.slice(0, 20);
    const codeB = `CSV_CAT_B_${suffix}`.slice(0, 20);
    const codeNoCat = `CSV_CAT_N_${suffix}`.slice(0, 20);

    let catAId: number | null = null;
    let catBId: number | null = null;
    let poseAId: number | null = null;
    let poseBId: number | null = null;
    let poseNoCatId: number | null = null;

    try {
      catAId = await createCategory(accessToken, catA);
      catBId = await createCategory(accessToken, catB);

      poseAId = await createPose(accessToken, codeA, catAId);
      poseBId = await createPose(accessToken, codeB, catBId);
      poseNoCatId = await createPose(accessToken, codeNoCat);

      let csvText = "";
      let res: Response | null = null;
      for (let attempt = 0; attempt < 6; attempt += 1) {
        // eslint-disable-next-line no-await-in-loop
        res = await authedFetch(accessToken, `/api/v1/export/poses/csv?category_id=${catAId}`);
        assertNo5xx(res.status, "export poses/csv filtered");
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

      expect(res).not.toBeNull();
      expect(res?.headers.get("x-total-items")).toBe("1");

      const lines = csvText.split(/\r?\n/).filter((l) => l.trim().length > 0);
      expect(lines.length).toBeGreaterThan(1);

      const rows = lines.slice(1).map((l) => parseCsvLine(l));
      const codes = rows.map((cols) => cols[0]);
      expect(codes).toContain(codeA);
      expect(codes).not.toContain(codeB);
      expect(codes).not.toContain(codeNoCat);
    } finally {
      if (poseAId) await deletePose(accessToken, poseAId);
      if (poseBId) await deletePose(accessToken, poseBId);
      if (poseNoCatId) await deletePose(accessToken, poseNoCatId);
      if (catAId) await deleteCategory(accessToken, catAId);
      if (catBId) await deleteCategory(accessToken, catBId);
    }
  });
});
