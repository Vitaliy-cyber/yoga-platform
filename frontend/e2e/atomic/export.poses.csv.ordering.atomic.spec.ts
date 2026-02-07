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

async function createPose(accessToken: string, code: string): Promise<number> {
  const res = await authedFetch(accessToken, "/api/v1/poses", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ code, name: `atomic csv ordering ${Date.now()}` }),
  });
  assertNo5xx(res.status, "create pose for csv ordering");
  expect(res.status).toBe(201);
  const json = (await res.json()) as { id?: number };
  expect(typeof json.id).toBe("number");
  return json.id as number;
}

async function deletePose(accessToken: string, id: number): Promise<void> {
  const res = await authedFetch(accessToken, `/api/v1/poses/${id}`, { method: "DELETE" });
  expect([204, 404]).toContain(res.status);
}

async function exportCsv(accessToken: string): Promise<Response> {
  let res: Response | null = null;
  for (let attempt = 0; attempt < 6; attempt += 1) {
    // eslint-disable-next-line no-await-in-loop
    res = await authedFetch(accessToken, "/api/v1/export/poses/csv");
    assertNo5xx(res.status, "export poses/csv ordering");
    if (res.status === 409 && attempt < 5) {
      // eslint-disable-next-line no-await-in-loop
      await new Promise((r) => setTimeout(r, 50 * (2 ** attempt)));
      continue;
    }
    break;
  }
  return res as Response;
}

test.describe("Atomic export poses CSV ordering (break-it; no 5xx)", () => {
  test.describe.configure({ mode: "serial" });

  test("CSV export orders poses by code", async () => {
    const { accessToken } = await loginWithToken(makeIsolatedToken("export-csv-ordering"));

    const suffix = Date.now().toString(36).slice(-8);
    const codeB = `B_${suffix}`.slice(0, 20);
    const codeA = `A_${suffix}`.slice(0, 20);

    let poseBId: number | null = null;
    let poseAId: number | null = null;

    try {
      poseBId = await createPose(accessToken, codeB);
      poseAId = await createPose(accessToken, codeA);

      const res = await exportCsv(accessToken);
      expect(res.status).toBe(200);
      const csvText = await res.text();

      const lines = csvText.split(/\r?\n/).filter((l) => l.trim().length > 0);
      expect(lines.length).toBe(3);
      const rows = lines.slice(1).map((l) => parseCsvLine(l));
      const codes = rows.map((cols) => cols[0]);
      expect(codes).toEqual([codeA, codeB]);
    } finally {
      if (poseAId) await deletePose(accessToken, poseAId);
      if (poseBId) await deletePose(accessToken, poseBId);
    }
  });
});
