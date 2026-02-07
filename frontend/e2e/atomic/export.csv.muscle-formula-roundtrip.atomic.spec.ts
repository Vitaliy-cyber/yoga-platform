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

test.describe("Atomic export CSV muscle formula roundtrip (break-it; no 5xx)", () => {
  test.describe.configure({ mode: "serial" });

  test("CSV export+import preserves muscles that start with formula chars", async () => {
    const accessToken = (await loginWithToken(makeIsolatedToken("export-csv-muscle-formula"))).accessToken;

    const categoryName = `Cat_${Date.now().toString(36).slice(-6)}`;
    const createCategoryRes = await authedFetch(accessToken, "/api/v1/categories", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: categoryName }),
    });
    assertNo5xx(createCategoryRes.status, "create category");
    expect(createCategoryRes.status).toBe(201);
    const categoryJson = (await createCategoryRes.json()) as { id?: number };
    const categoryId = categoryJson.id as number;

    const muscleName = `=evil_${Date.now().toString(36).slice(-6)}`;
    const createMuscleRes = await authedFetch(accessToken, "/api/v1/muscles", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: muscleName, body_part: "test" }),
    });
    assertNo5xx(createMuscleRes.status, "create muscle");
    expect(createMuscleRes.status).toBe(201);
    const muscleJson = (await createMuscleRes.json()) as { id?: number };
    const muscleId = muscleJson.id as number;

    const code = `CSVMP_${Date.now().toString(36).slice(-8)}`.slice(0, 20);
    const createPoseRes = await authedFetch(accessToken, "/api/v1/poses", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        code,
        name: "CSV muscle formula pose",
        category_id: categoryId,
        muscles: [{ muscle_id: muscleId, activation_level: 50 }],
      }),
    });
    assertNo5xx(createPoseRes.status, "create pose");
    expect(createPoseRes.status).toBe(201);
    const poseJson = (await createPoseRes.json()) as { id?: number };
    const poseId = poseJson.id as number;

    let csvText = "";
    try {
      let res: Response | null = null;
      for (let attempt = 0; attempt < 6; attempt += 1) {
        // eslint-disable-next-line no-await-in-loop
        res = await authedFetch(accessToken, `/api/v1/export/poses/csv?category_id=${categoryId}`);
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
      // muscles column should be prefixed with apostrophe to prevent injection
      expect(cols[7].startsWith("'")).toBeTruthy();
      expect(cols[7]).toContain(muscleName);

      // Remove original pose so import creates a fresh one.
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

      const fetchPoseRes = await authedFetch(
        accessToken,
        `/api/v1/poses/code/${encodeURIComponent(code)}`,
      );
      assertNo5xx(fetchPoseRes.status, "fetch pose by code after import");
      expect(fetchPoseRes.status).toBe(200);
      const fetched = (await fetchPoseRes.json()) as { muscles?: Array<{ muscle_name?: string }> };
      const muscleNames = (fetched.muscles || []).map((m) => m.muscle_name);
      expect(muscleNames).toContain(muscleName);
    } finally {
      if (poseId) {
        await authedFetch(accessToken, `/api/v1/poses/${poseId}`, { method: "DELETE" }).catch(
          () => undefined,
        );
      }
      if (categoryId) {
        await authedFetch(accessToken, `/api/v1/categories/${categoryId}`, { method: "DELETE" }).catch(
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
