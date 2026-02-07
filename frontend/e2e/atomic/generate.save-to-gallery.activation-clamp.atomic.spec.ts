import { test, expect } from "@playwright/test";
import { execFileSync } from "child_process";
import { assertNo5xx } from "./atomic-helpers";
import { authedFetch, loginWithToken, makeIsolatedToken, safeJson } from "./atomic-http";

type GenerateStatusRes = { status?: string; task_id?: string };

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

test.describe("Atomic generate save-to-gallery hardening (clamp analyzed muscles; no 5xx)", () => {
  test.describe.configure({ mode: "serial" });

  let accessToken = "";
  let taskId: string | null = null;
  let createdPoseId: number | null = null;

  test.beforeAll(async () => {
    accessToken = (await loginWithToken(makeIsolatedToken("save-to-gallery-clamp"))).accessToken;
  });

  test.afterAll(async () => {
    if (createdPoseId) {
      await authedFetch(accessToken, `/api/v1/poses/${createdPoseId}`, { method: "DELETE" }).catch(
        () => undefined,
      );
    }
    if (taskId) {
      // Keep DB tidy; this is not seed data.
      deleteGenerationTask(getDbPath(), taskId);
    }
  });

  test("corrupted analyzed_muscles_json with out-of-range activation levels does not 5xx (levels clamped)", async () => {
    const genRes = await authedFetch(accessToken, "/api/v1/generate/from-text", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        description: `Atomic save-to-gallery clamp ${Date.now()} - make muscles invalid but never crash`,
        additional_notes: "ok",
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
          assertNo5xx(st.status, "generate/status");
          if (st.status !== 200) return null;
          const body = (await st.json()) as GenerateStatusRes;
          return body.status || null;
        },
        { timeout: 20_000 },
      )
      .toBe("completed");

    // Corrupt analyzed muscles to simulate bad AI output / DB corruption:
    // these values would violate PoseMuscle check constraint without clamping.
    const corrupted = JSON.stringify([
      { name: "quadriceps", activation_level: 9999 },
      { name: "hamstrings", activation_level: -10 },
    ]);
    patchAnalyzedMusclesJson(getDbPath(), taskId, corrupted);

    const code = `GCLAMP_${Date.now().toString(36).slice(-8)}`.slice(0, 20);
    const saveRes = await authedFetch(accessToken, "/api/v1/generate/save-to-gallery", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        task_id: taskId,
        code,
        name: "Atomic clamp save-to-gallery",
        description: "should succeed without 5xx even if analyzed muscles are invalid",
      }),
    });
    assertNo5xx(saveRes.status, "generate/save-to-gallery");
    expect(saveRes.status).toBe(200);
    const saveBody = (await safeJson(saveRes)) as { pose_id?: number } | undefined;
    expect(typeof saveBody?.pose_id).toBe("number");
    createdPoseId = saveBody!.pose_id as number;

    const poseRes = await authedFetch(accessToken, `/api/v1/poses/${createdPoseId}`);
    assertNo5xx(poseRes.status, "get saved pose");
    expect(poseRes.status).toBe(200);
    const pose = (await poseRes.json()) as {
      muscles?: Array<{ activation_level?: number; muscle_name?: string }>;
    };
    expect(Array.isArray(pose.muscles)).toBeTruthy();
    const muscles = pose.muscles || [];
    // Must include the recognized muscles and clamp levels into [0..100]
    const byName = new Map<string, number>();
    for (const m of muscles) {
      if (typeof m?.muscle_name === "string" && typeof m?.activation_level === "number") {
        byName.set(m.muscle_name, m.activation_level);
      }
      if (typeof m?.activation_level === "number") {
        expect(m.activation_level).toBeGreaterThanOrEqual(0);
        expect(m.activation_level).toBeLessThanOrEqual(100);
      }
    }
    expect(byName.has("quadriceps") || byName.has("hamstrings")).toBeTruthy();
  });
});
