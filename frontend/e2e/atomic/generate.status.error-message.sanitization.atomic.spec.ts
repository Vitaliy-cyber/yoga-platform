import { test, expect } from "@playwright/test";
import { execFileSync } from "child_process";
import { assertNo5xx } from "./atomic-helpers";
import { authedFetch, loginWithToken, makeIsolatedToken } from "./atomic-http";

type GenerateStatusRes = { status?: string; task_id?: string; progress?: number; error_message?: string | null };

function getDbPath(): string {
  return process.env.PLAYWRIGHT_DB_PATH || "/tmp/yoga_platform_pw_e2e_persist.db";
}

function patchTaskFailure(dbPath: string, taskId: string, opts: { status: string; progress: number; error: string }): void {
  const py = `
import sqlite3, sys, time
db_path, task_id, st, prog, err = sys.argv[1], sys.argv[2], sys.argv[3], int(sys.argv[4]), sys.argv[5]
last = None
for i in range(30):
  try:
    con = sqlite3.connect(db_path, timeout=5)
    con.execute("PRAGMA busy_timeout=5000")
    cur = con.execute(
      "UPDATE generation_tasks SET status=?, progress=?, status_message=?, error_message=? WHERE task_id=?",
      (st, prog, "Generation failed", err, task_id)
    )
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
  execFileSync("python", ["-c", py, dbPath, taskId, opts.status, String(opts.progress), opts.error], {
    stdio: "pipe",
  });
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

function expectNoInternalLeaks(msg: string | null | undefined): void {
  const s = String(msg || "");
  expect(s.toLowerCase()).not.toContain("traceback");
  expect(s).not.toContain("[SQL:");
  expect(s.toLowerCase()).not.toContain("sqlalchemy");
  expect(s.toLowerCase()).not.toContain("sqlite3");
  expect(s).not.toContain("/home/");
  expect(s).not.toContain("\\\\"); // windows paths
}

test.describe("Atomic generate/status error_message sanitization (no internal leaks; no 5xx)", () => {
  test.describe.configure({ mode: "serial" });

  let accessToken = "";
  const createdTaskIds: string[] = [];

  test.beforeAll(async () => {
    accessToken = (await loginWithToken(makeIsolatedToken("gen-status-sanitize"))).accessToken;
  });

  test.afterAll(async () => {
    for (const id of createdTaskIds) {
      deleteGenerationTask(getDbPath(), id);
    }
  });

  test("error_message with stack/SQL/path strings is sanitized in /generate/status", async () => {
    const genRes = await authedFetch(accessToken, "/api/v1/generate/from-text", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ description: `Atomic sanitize ${Date.now()} - get a task then corrupt its failure` }),
    });
    assertNo5xx(genRes.status, "generate/from-text");
    expect(genRes.status).toBe(200);
    const genBody = (await genRes.json()) as { task_id?: string };
    expect(typeof genBody.task_id).toBe("string");
    const taskId = genBody.task_id as string;
    createdTaskIds.push(taskId);

    await expect
      .poll(
        async () => {
          const st = await authedFetch(accessToken, `/api/v1/generate/status/${taskId}`);
          assertNo5xx(st.status, "generate/status poll");
          if (st.status !== 200) return null;
          const body = (await st.json()) as GenerateStatusRes;
          return body.status || null;
        },
        { timeout: 20_000 },
      )
      .toBe("completed");

    const nasty = `Traceback (most recent call last): File "/home/tetra/app/backend/api/routes/generate.py", line 1, in run\nsqlalchemy.exc.OperationalError: (sqlite3.OperationalError) database is locked [SQL: SELECT 1]`;
    patchTaskFailure(getDbPath(), taskId, { status: "failed", progress: 999, error: nasty });

    const statusRes = await authedFetch(accessToken, `/api/v1/generate/status/${taskId}`);
    assertNo5xx(statusRes.status, "generate/status with nasty error_message");
    expect(statusRes.status).toBe(200);
    const body = (await statusRes.json()) as GenerateStatusRes;
    expect(body.status).toBe("failed");
    expect(typeof body.progress).toBe("number");
    expect(body.progress as number).toBeGreaterThanOrEqual(0);
    expect(body.progress as number).toBeLessThanOrEqual(100);
    expectNoInternalLeaks(body.error_message ?? null);
    expect((body.error_message || "").length).toBeLessThanOrEqual(240);
  });

  test("corrupted task.status value never causes 5xx (falls back to failed)", async () => {
    const genRes = await authedFetch(accessToken, "/api/v1/generate/from-text", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ description: `Atomic bad status ${Date.now()} - corrupt enum` }),
    });
    assertNo5xx(genRes.status, "generate/from-text #2");
    expect(genRes.status).toBe(200);
    const genBody = (await genRes.json()) as { task_id?: string };
    expect(typeof genBody.task_id).toBe("string");
    const taskId = genBody.task_id as string;
    createdTaskIds.push(taskId);

    await expect
      .poll(
        async () => {
          const st = await authedFetch(accessToken, `/api/v1/generate/status/${taskId}`);
          assertNo5xx(st.status, "generate/status poll #2");
          if (st.status !== 200) return null;
          const body = (await st.json()) as GenerateStatusRes;
          return body.status || null;
        },
        { timeout: 20_000 },
      )
      .toBe("completed");

    patchTaskFailure(getDbPath(), taskId, { status: "CORRUPTED_ENUM", progress: -50, error: "ok" });
    const statusRes = await authedFetch(accessToken, `/api/v1/generate/status/${taskId}`);
    assertNo5xx(statusRes.status, "generate/status with corrupted status");
    expect(statusRes.status).toBe(200);
    const body = (await statusRes.json()) as GenerateStatusRes;
    expect(body.status).toBe("failed");
    expect(typeof body.progress).toBe("number");
    expect(body.progress as number).toBeGreaterThanOrEqual(0);
    expect(body.progress as number).toBeLessThanOrEqual(100);
  });
});

