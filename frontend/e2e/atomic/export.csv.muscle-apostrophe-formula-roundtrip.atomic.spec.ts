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

test.describe("Atomic export CSV muscle apostrophe+formula roundtrip (break-it; no 5xx)", () => {
  test.describe.configure({ mode: "serial" });

  test("CSV export+import preserves muscles that start with apostrophe before formula", async () => {
    const accessToken = (await loginWithToken(makeIsolatedToken("export-csv-muscle-apos")))
      .accessToken;

    const suffix = Date.now().toString(36).slice(-6);
    const muscleName = `'=evil_${suffix}`;
    const createMuscleRes = await authedFetch(accessToken, "/api/v1/muscles", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: muscleName, body_part: "test" }),
    });
    assertNo5xx(createMuscleRes.status, "create muscle");
    expect(createMuscleRes.status).toBe(201);
    const muscleJson = (await createMuscleRes.json()) as { id?: number };
    const muscleId = muscleJson.id as number;

    const code = `CSVMA_${suffix}`.slice(0, 20);
    const createPoseRes = await authedFetch(accessToken, "/api/v1/poses", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        code,
        name: "CSV muscle apostrophe pose",
        muscles: [{ muscle_id: muscleId, activation_level: 50 }],
      }),
    });
    assertNo5xx(createPoseRes.status, "create pose");
    expect(createPoseRes.status).toBe(201);
    const poseJson = (await createPoseRes.json()) as { id?: number };
    const poseId = poseJson.id as number;

    let csvText = "";
    let importedPoseId: number | null = null;
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
      const header = lines[0];
      const row = lines
        .slice(1)
        .map((l) => parseCsvLine(l))
        .find((cols) => cols[0] === code);
      expect(row).toBeTruthy();
      const cols = row as string[];

      // muscles column should be double-escaped to preserve leading apostrophe
      expect(cols[7].startsWith("''")).toBeTruthy();
      expect(cols[7]).toContain(muscleName);

      // Remove original pose so import creates a fresh one.
      await authedFetch(accessToken, `/api/v1/poses/${poseId}`, { method: "DELETE" });

      const rowText = cols.map((cell) => `"${cell.replace(/"/g, '""')}"`).join(",");
      const miniCsv = `${header}\n${rowText}\n`;

      let importRes: Response | null = null;
      for (let attempt = 0; attempt < 6; attempt += 1) {
        const form = new FormData();
        const blob = new Blob([new TextEncoder().encode(miniCsv)], { type: "text/csv" });
        form.append("file", blob, "poses.csv");

        // eslint-disable-next-line no-await-in-loop
        importRes = await authedFetch(accessToken, "/api/v1/import/poses/csv", {
          method: "POST",
          body: form,
        });
        assertNo5xx(importRes.status, "import poses csv");
        if (importRes.status === 409 && attempt < 5) {
          // eslint-disable-next-line no-await-in-loop
          await new Promise((r) => setTimeout(r, 50 * (2 ** attempt)));
          continue;
        }
        expect(importRes.status).toBe(200);
        break;
      }

      const fetchPoseRes = await authedFetch(
        accessToken,
        `/api/v1/poses/code/${encodeURIComponent(code)}`,
      );
      assertNo5xx(fetchPoseRes.status, "fetch pose by code after import");
      expect(fetchPoseRes.status).toBe(200);
      const fetched = (await fetchPoseRes.json()) as {
        id?: number;
        muscles?: Array<{ muscle_name?: string }>;
      };
      importedPoseId = typeof fetched.id === "number" ? fetched.id : null;
      const muscleNames = (fetched.muscles || []).map((m) => m.muscle_name);
      expect(muscleNames).toContain(muscleName);
    } finally {
      if (importedPoseId) {
        await authedFetch(accessToken, `/api/v1/poses/${importedPoseId}`, { method: "DELETE" }).catch(
          () => undefined,
        );
      }
      if (poseId) {
        await authedFetch(accessToken, `/api/v1/poses/${poseId}`, { method: "DELETE" }).catch(
          () => undefined,
        );
      }
      if (muscleId) {
        await authedFetch(accessToken, `/api/v1/muscles/${muscleId}`, { method: "DELETE" }).catch(
          () => undefined,
        );
      }
    }
  });
});
