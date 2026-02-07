import { test, expect } from "@playwright/test";
import { execFileSync } from "child_process";
import { assertNo5xx } from "./atomic-helpers";
import { authedFetch, loginWithToken, makeIsolatedToken } from "./atomic-http";

type GenerateStatusRes = { status?: string; task_id?: string };

function getDbPath(): string {
  return process.env.PLAYWRIGHT_DB_PATH || "/tmp/yoga_platform_pw_e2e_persist.db";
}

function patchTask(dbPath: string, taskId: string, opts: { status: string; progress: number; error: string }): void {
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
}

test.describe("Atomic WebSocket initial status hardening (no leaks; no 5xx)", () => {
  test.describe.configure({ mode: "serial" });

  let accessToken = "";
  let taskId: string | null = null;

  test.beforeAll(async () => {
    accessToken = (await loginWithToken(makeIsolatedToken("ws-sanitize"))).accessToken;
  });

  test.afterAll(async () => {
    if (taskId) deleteGenerationTask(getDbPath(), taskId);
  });

  test("WS initial ProgressUpdate clamps progress, normalizes status, sanitizes error_message", async ({ page }) => {
    const genRes = await authedFetch(accessToken, "/api/v1/generate/from-text", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ description: `Atomic WS sanitize ${Date.now()}` }),
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
          const body = (await st.json()) as GenerateStatusRes;
          return body.status || null;
        },
        { timeout: 20_000 },
      )
      .toBe("completed");

    patchTask(getDbPath(), taskId, {
      status: "CORRUPTED_ENUM",
      progress: 999,
      error:
        'Traceback: File "/home/tetra/app/backend/api/routes/generate.py" [SQL: SELECT 1] sqlalchemy sqlite3',
    });

    await page.goto("about:blank");
    const apiBase = process.env.PLAYWRIGHT_API_URL || "http://127.0.0.1:8001";
    const base = new URL(apiBase);
    const wsProto = base.protocol === "https:" ? "wss:" : "ws:";
    const wsUrl = `${wsProto}//${base.host}/api/v1/ws/generate/${taskId}`;
    const raw = await page.evaluate(
      async ({ wsUrl: u, accessToken: t }) => {
        return new Promise<string>((resolve, reject) => {
          const ws = new WebSocket(u, ["jwt", t]);
          const timeout = setTimeout(() => {
            try {
              ws.close();
            } catch {
              // ignore
            }
            reject(new Error("timeout waiting for WS message"));
          }, 5000);
          ws.onmessage = (ev) => {
            clearTimeout(timeout);
            resolve(String(ev.data || ""));
          };
          ws.onerror = () => {
            clearTimeout(timeout);
            reject(new Error("ws error"));
          };
        });
      },
      { wsUrl, accessToken },
    );

    const update = JSON.parse(raw) as { status?: string; progress?: number; error_message?: string | null };
    expect(update.status).toBe("failed");
    expect(typeof update.progress).toBe("number");
    expect(update.progress as number).toBeGreaterThanOrEqual(0);
    expect(update.progress as number).toBeLessThanOrEqual(100);
    expectNoInternalLeaks(update.error_message ?? null);
  });
});
