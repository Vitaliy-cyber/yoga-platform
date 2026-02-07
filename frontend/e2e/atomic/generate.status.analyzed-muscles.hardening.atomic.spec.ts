import { test, expect } from "@playwright/test";
import { execFileSync } from "child_process";
import { assertNo5xx } from "./atomic-helpers";
import { authedFetch, loginWithToken, makeIsolatedToken } from "./atomic-http";

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

function deleteGenerationTask(dbPath: string, taskId: string): void {
  const py = `
import sqlite3, sys, time
db_path, task_id = sys.argv[1], sys.argv[2]
last = None
for i in range(30):
  try:
    con = sqlite3.connect(db_path, timeout=5)
    con.execute("PRAGMA busy_timeout=5000")
    con.execute("DELETE FROM generation_tasks WHERE task_id=?", (task_id,))
    con.commit()
    con.close()
    raise SystemExit(0)
  except sqlite3.OperationalError as e:
    last = str(e)
    if "locked" in last.lower():
      time.sleep(0.05 + i * 0.02)
      continue
    raise
raise SystemExit("locked: " + (last or "unknown"))
`;
  execFileSync("python", ["-c", py, dbPath, taskId], { stdio: "pipe" });
}

test.describe("Atomic generate/status analyzed_muscles hardening (no 5xx)", () => {
  test.describe.configure({ mode: "serial" });

  let accessToken = "";
  let taskId: string | null = null;

  test.beforeAll(async () => {
    accessToken = (await loginWithToken(makeIsolatedToken("gen-status-muscles"))).accessToken;
  });

  test.afterAll(async () => {
    if (taskId) deleteGenerationTask(getDbPath(), taskId);
  });

  test("corrupted analyzed_muscles_json never causes 5xx (skips/clamps invalid entries)", async () => {
    const genRes = await authedFetch(accessToken, "/api/v1/generate/from-text", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        description: `Atomic gen status hardening ${Date.now()} - make analyzed_muscles_json invalid`,
      }),
    });
    assertNo5xx(genRes.status, "generate/from-text");
    expect(genRes.status).toBe(200);
    const genBody = (await genRes.json()) as { task_id?: string };
    expect(typeof genBody.task_id).toBe("string");
    taskId = genBody.task_id as string;

    await expect
      .poll(
        async () => {
          const st = await authedFetch(accessToken, `/api/v1/generate/status/${taskId}`);
          assertNo5xx(st.status, "generate/status poll");
          if (st.status !== 200) return null;
          const body = (await st.json()) as { status?: string };
          return body.status || null;
        },
        { timeout: 20_000 },
      )
      .toBe("completed");

    const corrupted = JSON.stringify([
      { name: "quadriceps", activation_level: 9999 },
      { name: "hamstrings", activation_level: -1 },
      { name: "obliques", activation_level: "not-a-number" },
      { name: 123, activation_level: 50 },
      { nope: true },
    ]);
    patchAnalyzedMusclesJson(getDbPath(), taskId, corrupted);

    const statusRes = await authedFetch(accessToken, `/api/v1/generate/status/${taskId}`);
    assertNo5xx(statusRes.status, "generate/status with corrupted analyzed_muscles_json");
    expect(statusRes.status).toBe(200);
    const body = (await statusRes.json()) as {
      analyzed_muscles?: Array<{ name: unknown; activation_level: unknown }>;
    };
    const muscles = body.analyzed_muscles || [];
    for (const m of muscles) {
      expect(typeof m.name).toBe("string");
      expect(typeof m.activation_level).toBe("number");
      expect(m.activation_level as number).toBeGreaterThanOrEqual(0);
      expect(m.activation_level as number).toBeLessThanOrEqual(100);
    }
  });
});

