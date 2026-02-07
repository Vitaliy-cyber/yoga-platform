import { test, expect } from "@playwright/test";
import { assertNo5xx } from "./atomic-helpers";
import { authedFetch, loginWithToken, makeIsolatedToken } from "./atomic-http";

const API_BASE_URL = process.env.PLAYWRIGHT_API_URL || "http://localhost:8000";

async function importPosesJson(accessToken: string, jsonText: string): Promise<Response> {
  const form = new FormData();
  const blob = new Blob([new TextEncoder().encode(jsonText)], { type: "application/json" });
  form.append("file", blob, "poses.json");
  return fetch(`${API_BASE_URL}/api/v1/import/poses/json`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      Accept: "application/json",
    },
    body: form,
  });
}

async function getPoseIdByCode(accessToken: string, code: string): Promise<number> {
  const res = await authedFetch(accessToken, `/api/v1/poses/code/${encodeURIComponent(code)}`);
  assertNo5xx(res.status, `get pose by code ${code}`);
  expect(res.status).toBe(200);
  const json = (await res.json()) as { id?: unknown };
  expect(typeof json.id).toBe("number");
  return json.id as number;
}

async function deletePose(accessToken: string, id: number) {
  const res = await authedFetch(accessToken, `/api/v1/poses/${id}`, { method: "DELETE" });
  assertNo5xx(res.status, "delete pose");
  expect([204, 404]).toContain(res.status);
}

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

test.describe("Atomic export CSV formula injection hardening (break-it; no 5xx)", () => {
  test.describe.configure({ mode: "serial" });

  let accessToken = "";

  test.beforeAll(async () => {
    accessToken = (await loginWithToken(makeIsolatedToken("export-csv-injection"))).accessToken;
  });

  test("leading-whitespace formula payloads are neutralized (prefixed with apostrophe)", async () => {
    const code = `CSVINJ_${Date.now().toString(36).slice(-8)}`.slice(0, 20);
    const name = " =2+2";
    const description = "hello\tworld\nnew\rline";

    // Must go through import to preserve leading whitespace (normal create trims).
    const jsonText = JSON.stringify([{ code, name, description }]);
    let importRes: Response | null = null;
    let imported = false;
    for (let attempt = 0; attempt < 10; attempt += 1) {
      // eslint-disable-next-line no-await-in-loop
      importRes = await importPosesJson(accessToken, jsonText);
      assertNo5xx(importRes.status, "import poses/json for csv injection");
      if (importRes.status === 409 && attempt < 9) {
        // sqlite contention / transient conflicts under atomic parallel load
        // eslint-disable-next-line no-await-in-loop
        await new Promise((r) => setTimeout(r, 50 * (2 ** attempt)));
        continue;
      }
      expect(importRes.status).toBe(200);
      // Import can return 200 with per-item errors under extreme contention.
      // Retry only on explicit conflict-style item errors so this test stays focused
      // on CSV sanitization, not SQLite single-writer behavior.
      // eslint-disable-next-line no-await-in-loop
      const body = (await importRes.json().catch(() => null)) as
        | { items?: Array<{ status?: string; message?: string }> }
        | null;
      const item = body?.items?.[0];
      const status = (item?.status || "").toLowerCase();
      const message = item?.message || "";
      if (status === "created" || status === "updated" || status === "skipped") {
        imported = true;
        break;
      }
      if (
        (status === "error" || status === "") &&
        (message.includes("Conflict") || message.includes("conflict") || message.includes("retry"))
      ) {
        // eslint-disable-next-line no-await-in-loop
        await new Promise((r) => setTimeout(r, 75 * (2 ** attempt)));
        continue;
      }
      throw new Error(`Import did not create pose: status=${item?.status ?? "?"} msg=${message}`);
      break;
    }

    expect(imported, "import should eventually create the pose under contention").toBeTruthy();
    const poseId = await getPoseIdByCode(accessToken, code);
    try {
      let res: Response | null = null;
      let text = "";
      for (let attempt = 0; attempt < 10; attempt += 1) {
        // eslint-disable-next-line no-await-in-loop
        res = await authedFetch(accessToken, "/api/v1/export/poses/csv");
        assertNo5xx(res.status, "export poses/csv");
        if (res.status === 409 && attempt < 9) {
          // transient read conflict under write-heavy atomic load
          // eslint-disable-next-line no-await-in-loop
          await new Promise((r) => setTimeout(r, 50 * (2 ** attempt)));
          continue;
        }
        expect(res.status).toBe(200);
        // eslint-disable-next-line no-await-in-loop
        text = await res.text();
        break;
      }

      // Find our row by code (first column).
      const lines = text.split(/\r?\n/).filter((l) => l.trim().length > 0);
      expect(lines.length).toBeGreaterThan(1);

      const dataLines = lines.slice(1);
      const row = dataLines
        .map((l) => parseCsvLine(l))
        .find((cols) => cols[0] === code);
      expect(row).toBeTruthy();
      const cols = row as string[];

      // code,name,name_en,category_name,description,effect,breathing,muscles
      expect(cols[1]).toBe(`'${name}`);
      expect(cols[4]).not.toContain("\n");
      expect(cols[4]).not.toContain("\r");
      expect(cols[4]).not.toContain("\t");
    } finally {
      await deletePose(accessToken, poseId);
    }
  });
});
