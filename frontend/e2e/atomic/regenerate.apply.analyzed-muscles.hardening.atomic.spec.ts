import { test, expect } from "@playwright/test";
import { execFileSync } from "child_process";
import { TEST_TOKEN } from "../fixtures";
import { assertNo5xx } from "./atomic-helpers";
import { authedFetch, loginWithToken, safeJson } from "./atomic-http";

function getDbPath(): string {
  return process.env.PLAYWRIGHT_DB_PATH || "/tmp/yoga_platform_pw_e2e_persist.db";
}

function patchAnalyzedMusclesJson(dbPath: string, taskId: string, analyzedJson: string): void {
  const py = `
import sqlite3, sys, time
db_path, task_id, analyzed_json = sys.argv[1], sys.argv[2], sys.argv[3]
last = None
for i in range(30):
  try:
    con = sqlite3.connect(db_path, timeout=5)
    con.execute("PRAGMA busy_timeout=5000")
    cur = con.execute("UPDATE generation_tasks SET analyzed_muscles_json=? WHERE task_id=?", (analyzed_json, task_id))
    con.commit()
    con.close()
    if cur.rowcount != 1:
      raise SystemExit(2)
    raise SystemExit(0)
  except sqlite3.OperationalError as e:
    last = str(e)
    if "locked" in last.lower():
      time.sleep(0.05 + i * 0.02)
      continue
    raise
raise SystemExit("locked: " + (last or "unknown"))
`;
  execFileSync("python", ["-c", py, dbPath, taskId, analyzedJson], { stdio: "pipe" });
}

const tinyPng = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR4nGNgYAAAAAMAASsJTYQAAAAASUVORK5CYII=",
  "base64",
);

test.describe("Atomic regeneration apply-generation: analyzed_muscles hardening", () => {
  test.describe.configure({ mode: "serial" });

  test("apply-generation never 5xx even with corrupted analyzed_muscles_json", async () => {
    test.setTimeout(120_000);

    const { accessToken } = await loginWithToken(TEST_TOKEN);
    expect(accessToken).toBeTruthy();
    const apiBase = process.env.PLAYWRIGHT_API_URL || "http://127.0.0.1:8000";

    const code = `AMH_${Date.now().toString(36).slice(-10)}`.slice(0, 20);
    const createRes = await authedFetch(accessToken, "/api/v1/poses", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ code, name: `Atomic Apply Muscles ${code}` }),
    });
    assertNo5xx(createRes.status, "create pose");
    expect(createRes.status).toBe(201);
    const poseId = ((await safeJson(createRes)) as { id?: number } | undefined)?.id as number;
    expect(typeof poseId).toBe("number");

    try {
      const form = new FormData();
      form.append("file", new Blob([tinyPng], { type: "image/png" }), "schema.png");
      const schemaRes = await fetch(`${apiBase}/api/v1/poses/${poseId}/schema`, {
        method: "POST",
        headers: { Authorization: `Bearer ${accessToken}`, Accept: "application/json" },
        body: form,
      });
      assertNo5xx(schemaRes.status, "upload schema");
      expect(schemaRes.status).toBe(200);

      const genRes = await authedFetch(accessToken, `/api/v1/generate/from-pose/${poseId}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ additional_notes: "atomic: seed apply muscles hardening" }),
      });
      assertNo5xx(genRes.status, "generate/from-pose");
      expect(genRes.status).toBe(200);
      const taskId = (((await safeJson(genRes)) as any)?.task_id as string) || "";
      expect(taskId).toBeTruthy();

      await expect
        .poll(
          async () => {
            const st = await authedFetch(accessToken, `/api/v1/generate/status/${taskId}`, { method: "GET" });
            assertNo5xx(st.status, "status");
            if (st.status !== 200) return null;
            const body = (await safeJson(st)) as { status?: string } | undefined;
            return body?.status || null;
          },
          { timeout: 25_000 },
        )
        .toBe("completed");

      const corrupted = JSON.stringify([
        { name: "quadriceps", activation_level: 9999 },
        { name: "hamstrings", activation_level: -1 },
        { name: "obliques", activation_level: "not-a-number" },
        { name: 123, activation_level: 50 },
        { name: null, activation_level: 50 },
        { nope: true },
      ]);
      patchAnalyzedMusclesJson(getDbPath(), taskId, corrupted);

      const applyRes = await authedFetch(accessToken, `/api/v1/poses/${poseId}/apply-generation/${taskId}`, {
        method: "POST",
      });
      assertNo5xx(applyRes.status, "apply-generation with corrupted analyzed_muscles_json");
      expect(applyRes.status).toBe(200);
      const pose = (await safeJson(applyRes)) as { id?: unknown; muscles?: unknown } | undefined;
      expect(pose?.id).toBe(poseId);
    } finally {
      await authedFetch(accessToken, `/api/v1/poses/${poseId}`, { method: "DELETE" }).catch(() => undefined);
    }
  });
});

