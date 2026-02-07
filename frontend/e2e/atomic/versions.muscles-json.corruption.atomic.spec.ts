import { test, expect } from "@playwright/test";
import { execFileSync } from "child_process";
import { assertNo5xx } from "./atomic-helpers";
import { authedFetch, loginWithToken, makeIsolatedToken, safeJson } from "./atomic-http";

type PoseRes = { id?: number; version?: number };
type VersionsListRes = { items?: Array<{ id?: number; version_number?: number }> };

function getDbPath(): string {
  return process.env.PLAYWRIGHT_DB_PATH || "/tmp/yoga_platform_pw_e2e_persist.db";
}

function patchPoseVersionMusclesJson(dbPath: string, versionId: number, musclesJson: string): void {
  const py = `
import sqlite3, sys, time
db_path, version_id, muscles_json = sys.argv[1], int(sys.argv[2]), sys.argv[3]
last = None
for i in range(30):
  try:
    con = sqlite3.connect(db_path, timeout=5)
    con.execute("PRAGMA busy_timeout=5000")
    cur = con.execute("UPDATE pose_versions SET muscles_json=? WHERE id=?", (muscles_json, version_id))
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
  execFileSync("python", ["-c", py, dbPath, String(versionId), musclesJson], { stdio: "pipe" });
}

test.describe("Atomic versions API hardening (corrupted muscles_json never 5xx)", () => {
  test.describe.configure({ mode: "serial" });

  let accessToken = "";
  let poseId: number | null = null;
  let poseVersion: number | null = null;

  test.beforeAll(async () => {
    accessToken = (await loginWithToken(makeIsolatedToken("versions-corrupt-muscles"))).accessToken;
  });

  test.afterAll(async () => {
    if (poseId) {
      await authedFetch(accessToken, `/api/v1/poses/${poseId}`, { method: "DELETE" }).catch(
        () => undefined,
      );
    }
  });

  test("detail/diff/restore remain stable when pose_versions.muscles_json contains non-dict entries", async () => {
    // 1) Create pose
    const code = `VCR_${Date.now().toString(36).slice(-8)}`.slice(0, 20);
    const createRes = await authedFetch(accessToken, "/api/v1/poses", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ code, name: "Atomic Version Corruption" }),
    });
    assertNo5xx(createRes.status, "create pose");
    expect(createRes.status).toBe(201);
    const created = (await createRes.json()) as PoseRes;
    expect(typeof created.id).toBe("number");
    expect(typeof created.version).toBe("number");
    poseId = created.id as number;
    poseVersion = created.version as number;

    // 2) Update twice to create at least 2 versions
    const upd1 = await authedFetch(accessToken, `/api/v1/poses/${poseId}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "Atomic Version Corruption v2", version: poseVersion, change_note: "v2" }),
    });
    assertNo5xx(upd1.status, "update pose #1");
    expect(upd1.status).toBe(200);
    const upd1Body = (await upd1.json()) as PoseRes;
    expect(typeof upd1Body.version).toBe("number");
    poseVersion = upd1Body.version as number;

    const upd2 = await authedFetch(accessToken, `/api/v1/poses/${poseId}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "Atomic Version Corruption v3", version: poseVersion, change_note: "v3" }),
    });
    assertNo5xx(upd2.status, "update pose #2");
    expect(upd2.status).toBe(200);

    // 3) List versions
    const listRes = await authedFetch(accessToken, `/api/v1/poses/${poseId}/versions?skip=0&limit=50`);
    assertNo5xx(listRes.status, "list versions");
    expect(listRes.status).toBe(200);
    const list = (await listRes.json()) as VersionsListRes;
    const items = list.items || [];
    expect(items.length).toBeGreaterThanOrEqual(2);
    const v1 = items[0]?.id;
    const v2 = items[1]?.id;
    expect(typeof v1).toBe("number");
    expect(typeof v2).toBe("number");

    // 4) Corrupt muscles_json (break-it): non-dict entry will crash naive parsers
    const corrupted = JSON.stringify(["oops", { muscle_id: 1, muscle_name: "x", activation_level: 9999 }]);
    patchPoseVersionMusclesJson(getDbPath(), v1 as number, corrupted);

    // 5) Version detail should not 5xx (may ignore invalid entries)
    const detailRes = await authedFetch(accessToken, `/api/v1/poses/${poseId}/versions/${v1}`);
    assertNo5xx(detailRes.status, "get version detail with corrupted muscles_json");
    expect([200, 400].includes(detailRes.status)).toBeTruthy();
    await safeJson(detailRes);

    // 6) Diff should not 5xx (ideally returns 400 invalid version data)
    const diffRes = await authedFetch(accessToken, `/api/v1/poses/${poseId}/versions/${v1}/diff/${v2}`);
    assertNo5xx(diffRes.status, "diff versions with corrupted muscles_json");
    expect([200, 400].includes(diffRes.status)).toBeTruthy();
    await safeJson(diffRes);

    // 7) Restore should not 5xx (corrupted version must not restore)
    const restoreRes = await authedFetch(accessToken, `/api/v1/poses/${poseId}/versions/${v1}/restore`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ change_note: "Atomic restore corrupted muscles_json" }),
    });
    assertNo5xx(restoreRes.status, "restore version with corrupted muscles_json");
    expect([200, 400, 409].includes(restoreRes.status)).toBeTruthy();
    await safeJson(restoreRes);
  });
});

