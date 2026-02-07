import { test, expect } from "@playwright/test";
import { assertNo5xx, concurrentAll, getEnvInt } from "./atomic-helpers";
import { authedFetch, loginWithToken, safeJson } from "./atomic-http";

const API_BASE_URL = process.env.PLAYWRIGHT_API_URL || "http://localhost:8000";
const USER1_TOKEN =
  process.env.E2E_TEST_TOKEN || "e2e-test-token-playwright-2024";

async function uploadJsonFile(
  accessToken: string,
  path: "/api/v1/import/backup" | "/api/v1/import/poses/json",
  filename: string,
  json: unknown,
): Promise<Response> {
  const form = new FormData();
  const blob = new Blob([JSON.stringify(json)], { type: "application/json" });
  form.append("file", blob, filename);

  return fetch(`${API_BASE_URL}${path}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Accept-Language": "uk",
    },
    body: form,
  });
}

test.describe("Atomic import concurrency (no 5xx)", () => {
  test.describe.configure({ mode: "serial" });

  const concurrency = getEnvInt("ATOMIC_CONCURRENCY", 12);
  const attempts = getEnvInt("ATOMIC_IMPORT_ATTEMPTS", 6);
  let accessToken = "";

  test.beforeAll(async () => {
    accessToken = (await loginWithToken(USER1_TOKEN)).accessToken;
  });

  test("import backup: concurrent same file never 5xx", async () => {
    const runId = `B${Date.now().toString(36)}`;
    const categoryName = `Atomic Import ${runId}`;
    const poseCodeA = `IB${runId}A`.slice(0, 20);
    const poseCodeB = `IB${runId}B`.slice(0, 20);

    const backup = {
      metadata: {
        version: "1.0.0",
        exported_at: new Date().toISOString(),
        total_poses: 2,
        total_categories: 1,
      },
      categories: [{ name: categoryName, description: "atomic import" }],
      poses: [
        {
          code: poseCodeA,
          name: `Atomic Pose ${runId} A`,
          category_name: categoryName,
          muscles: [],
        },
        {
          code: poseCodeB,
          name: `Atomic Pose ${runId} B`,
          category_name: categoryName,
          muscles: [],
        },
      ],
    };

    const tasks = Array.from({ length: attempts }, (_v, i) => async () => {
      const res = await uploadJsonFile(
        accessToken,
        "/api/v1/import/backup",
        `atomic-backup-${runId}-${i}.json`,
        backup,
      );
      assertNo5xx(res.status, `import backup#${i}`);
      await safeJson(res);
      return res.status;
    });

    const statuses = await concurrentAll(tasks, Math.min(concurrency, 6));
    expect(
      statuses.every((s) => s === 200 || s === 400 || s === 409 || s === 422),
    ).toBeTruthy();

    // Cleanup: delete poses + category (best-effort)
    const listRes = await authedFetch(
      accessToken,
      `/api/v1/poses/search?q=${encodeURIComponent(runId)}`,
    );
    assertNo5xx(listRes.status, "poses search cleanup");
    if (listRes.ok) {
      const poses = (await listRes.json()) as Array<{
        id: number;
        code: string;
      }>;
      for (const p of poses.filter(
        (p) => p.code === poseCodeA || p.code === poseCodeB,
      )) {
        // eslint-disable-next-line no-await-in-loop
        await authedFetch(accessToken, `/api/v1/poses/${p.id}`, {
          method: "DELETE",
        }).catch(() => undefined);
      }
    }

    const catsRes = await authedFetch(accessToken, "/api/v1/categories");
    assertNo5xx(catsRes.status, "categories cleanup");
    if (catsRes.ok) {
      const cats = (await catsRes.json()) as Array<{
        id: number;
        name: string;
      }>;
      const cat = cats.find((c) => c.name === categoryName);
      if (cat) {
        await authedFetch(accessToken, `/api/v1/categories/${cat.id}`, {
          method: "DELETE",
        }).catch(() => undefined);
      }
    }
  });

  test("import poses/json rejects invalid extension without 5xx", async () => {
    const res = await uploadJsonFile(
      accessToken,
      "/api/v1/import/poses/json",
      "bad.txt",
      { poses: [] },
    );
    assertNo5xx(res.status, "import poses json bad extension");
    expect(res.status).toBe(400);
    await safeJson(res);
  });
});
