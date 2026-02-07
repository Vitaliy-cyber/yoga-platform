import { test, expect } from "@playwright/test";
import { assertNo5xx } from "./atomic-helpers";
import { authedFetch, loginWithToken, makeIsolatedToken } from "./atomic-http";

const API_BASE_URL = process.env.PLAYWRIGHT_API_URL || "http://localhost:8000";

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

async function createMuscle(accessToken: string, name: string): Promise<number> {
  const res = await authedFetch(accessToken, "/api/v1/muscles", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name }),
  });
  assertNo5xx(res.status, "create muscle");
  expect(res.status).toBe(201);
  const json = (await res.json()) as { id?: number };
  expect(typeof json.id).toBe("number");
  return json.id as number;
}

async function deleteMuscle(accessToken: string, id: number): Promise<void> {
  const res = await authedFetch(accessToken, `/api/v1/muscles/${id}`, { method: "DELETE" });
  expect([204, 404]).toContain(res.status);
}

async function createPose(accessToken: string, code: string, muscleIds: number[]): Promise<number> {
  const res = await authedFetch(accessToken, "/api/v1/poses", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      code,
      name: `atomic csv muscles ${Date.now()}`,
      muscles: muscleIds.map((id, i) => ({
        muscle_id: id,
        activation_level: i === 0 ? 70 : 30,
      })),
    }),
  });
  assertNo5xx(res.status, "create pose for csv muscles");
  expect(res.status).toBe(201);
  const json = (await res.json()) as { id?: number };
  expect(typeof json.id).toBe("number");
  return json.id as number;
}

async function deletePose(accessToken: string, id: number): Promise<void> {
  const res = await authedFetch(accessToken, `/api/v1/poses/${id}`, { method: "DELETE" });
  expect([204, 404]).toContain(res.status);
}

async function importCsv(accessToken: string, csvText: string): Promise<Response> {
  const form = new FormData();
  const blob = new Blob([new TextEncoder().encode(csvText)], { type: "text/csv" });
  form.append("file", blob, "poses.csv");
  return fetch(`${API_BASE_URL}/api/v1/import/poses/csv`, {
    method: "POST",
    headers: { Authorization: `Bearer ${accessToken}`, Accept: "application/json" },
    body: form,
  });
}

test.describe("Atomic export CSV muscle escaping (break-it; no 5xx)", () => {
  test.describe.configure({ mode: "serial" });

  test("CSV export round-trips muscles with comma/colon in names", async () => {
    const exportUser = await loginWithToken(makeIsolatedToken("csv-muscle-a"));
    const importUser = await loginWithToken(makeIsolatedToken("csv-muscle-b"));

    const suffix = Date.now().toString(36).slice(-8);
    const nameComma = `atomic,comma-${suffix}`;
    const nameColon = `atomic:colon-${suffix}`;
    const code = `CSV_MUS_${suffix}`.slice(0, 20);

    let muscleCommaId: number | null = null;
    let muscleColonId: number | null = null;
    let poseId: number | null = null;
    let importedPoseId: number | null = null;

    try {
      muscleCommaId = await createMuscle(exportUser.accessToken, nameComma);
      muscleColonId = await createMuscle(exportUser.accessToken, nameColon);
      poseId = await createPose(exportUser.accessToken, code, [muscleCommaId, muscleColonId]);

      let csvText = "";
      for (let attempt = 0; attempt < 6; attempt += 1) {
        // eslint-disable-next-line no-await-in-loop
        const res = await authedFetch(exportUser.accessToken, "/api/v1/export/poses/csv");
        assertNo5xx(res.status, "export poses/csv for muscle escape");
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

      const header = lines[0];
      const row = lines
        .slice(1)
        .map((l) => parseCsvLine(l))
        .find((cols) => cols[0] === code);
      expect(row).toBeTruthy();

      const rowText = (row as string[]).map((cell) => `"${cell.replace(/"/g, '""')}"`).join(",");
      const miniCsv = `${header}\n${rowText}\n`;

      let importRes: Response | null = null;
      for (let attempt = 0; attempt < 6; attempt += 1) {
        // eslint-disable-next-line no-await-in-loop
        importRes = await importCsv(importUser.accessToken, miniCsv);
        assertNo5xx(importRes.status, "import poses/csv roundtrip");
        if (importRes.status === 409 && attempt < 5) {
          // eslint-disable-next-line no-await-in-loop
          await new Promise((r) => setTimeout(r, 50 * (2 ** attempt)));
          continue;
        }
        expect(importRes.status).toBe(200);
        break;
      }

      const getRes = await authedFetch(importUser.accessToken, `/api/v1/poses/code/${encodeURIComponent(code)}`);
      assertNo5xx(getRes.status, "get imported pose by code");
      expect(getRes.status).toBe(200);
      const imported = (await getRes.json()) as { id?: number; muscles?: Array<{ muscle_name?: string }> };
      importedPoseId = typeof imported.id === "number" ? imported.id : null;

      const muscleNames = (imported.muscles || []).map((m) => m.muscle_name);
      expect(muscleNames).toContain(nameComma);
      expect(muscleNames).toContain(nameColon);
      expect(muscleNames.length).toBeGreaterThanOrEqual(2);
    } finally {
      if (importedPoseId) await deletePose(importUser.accessToken, importedPoseId);
      if (poseId) await deletePose(exportUser.accessToken, poseId);
      if (muscleCommaId) await deleteMuscle(exportUser.accessToken, muscleCommaId);
      if (muscleColonId) await deleteMuscle(exportUser.accessToken, muscleColonId);
    }
  });
});
