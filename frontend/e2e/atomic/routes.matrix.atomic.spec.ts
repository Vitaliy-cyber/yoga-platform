import { test, expect } from "@playwright/test";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { assertNo5xx, concurrentAll, getEnvInt } from "./atomic-helpers";
import { loginWithToken, authedFetch, safeJson } from "./atomic-http";
import {
  getFirstCategoryId,
  getFirstPoseId,
  getFirstSequenceId,
  loadTestData,
} from "../test-data";

type Operation = {
  method: "get" | "post" | "put" | "patch" | "delete";
  path: string;
};

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const API_BASE_URL = process.env.PLAYWRIGHT_API_URL || "http://localhost:8000";
const USER1_TOKEN =
  process.env.E2E_TEST_TOKEN || "e2e-test-token-playwright-2024";

function findBackendRoutesDir(): string {
  // frontend/e2e/atomic -> frontend -> yoga-platform -> backend/api/routes
  return path.resolve(__dirname, "..", "..", "..", "backend", "api", "routes");
}

function parseRouterPrefix(fileText: string): string {
  const m = fileText.match(/APIRouter\(\s*prefix\s*=\s*['"]([^'"]+)['"]/);
  return m?.[1] || "";
}

function parseOperations(fileText: string, routerPrefix: string): Operation[] {
  const ops: Operation[] = [];
  const re = /@router\.(get|post|put|patch|delete)\(\s*['"]([^'"]*)['"]/g;
  for (const match of fileText.matchAll(re)) {
    const method = match[1] as Operation["method"];
    const routePath = match[2] ?? "";
    const combined = routePath.startsWith("/")
      ? `${routerPrefix}${routePath}`
      : `${routerPrefix}${routePath ? `/${routePath}` : ""}`;
    const normalized = combined.replace(/\/+/g, "/");
    ops.push({ method, path: `/api/v1${normalized}` });
  }
  return ops;
}

function fillPathParams(
  routePath: string,
  mode: "read" | "safe-mutate",
): string {
  const data = loadTestData();
  const poseId = getFirstPoseId();
  const categoryId = getFirstCategoryId();
  const sequenceId = getFirstSequenceId();
  const muscleId = data.muscles[0]?.id ?? 1;

  return routePath.replace(/\{([^}]+)\}/g, (_m, nameRaw: string) => {
    const name = String(nameRaw).toLowerCase();
    const wantExisting = mode === "read";
    const safeMissingId = 999_999_999;

    if (name.includes("pose"))
      return String(wantExisting ? poseId : safeMissingId);
    if (name.includes("category"))
      return String(wantExisting ? categoryId : safeMissingId);
    if (name.includes("sequence"))
      return String(wantExisting ? sequenceId : safeMissingId);
    if (name.includes("muscle"))
      return String(wantExisting ? muscleId : safeMissingId);
    if (name.includes("image_type") || name.includes("imagetype"))
      return "photo";
    if (name.includes("task")) return "nonexistent-task-id";
    if (name.includes("id")) return String(wantExisting ? 1 : safeMissingId);
    return String(wantExisting ? 1 : safeMissingId);
  });
}

const routesDir = findBackendRoutesDir();
const routeFiles = fs
  .readdirSync(routesDir)
  .filter((f) => f.endsWith(".py") && f !== "__init__.py");

const discovered: Operation[] = [];
for (const f of routeFiles) {
  const filePath = path.join(routesDir, f);
  const text = fs.readFileSync(filePath, "utf-8");
  const prefix = parseRouterPrefix(text);
  discovered.push(...parseOperations(text, prefix));
}

// Light heuristics: keep "JSON-ish" or quick endpoints; skip known heavy exports.
const excludedPathFragments = ["/export/poses/pdf"];
const ops = discovered
  .filter((o) => !excludedPathFragments.some((frag) => o.path.includes(frag)))
  .filter((o) => !o.path.includes("/websocket"))
  .sort(
    (a, b) => a.path.localeCompare(b.path) || a.method.localeCompare(b.method),
  );

const getOps = ops.filter((o) => o.method === "get");
const mutateOps = ops.filter((o) => o.method !== "get");

test.describe("Atomic routes matrix (no 5xx)", () => {
  const concurrency = getEnvInt("ATOMIC_CONCURRENCY", 12);
  const getLimit = getEnvInt("ATOMIC_MATRIX_GET_LIMIT", 30);
  const mutateLimit = getEnvInt("ATOMIC_MATRIX_MUTATE_LIMIT", 20);

  let user1AccessToken = "";

  test.beforeAll(async () => {
    const { accessToken } = await loginWithToken(USER1_TOKEN);
    user1AccessToken = accessToken;
  });

  for (const op of getOps.slice(0, getLimit)) {
    test(`GET (auth) ${op.path} does not 5xx`, async () => {
      const urlPath = fillPathParams(op.path, "read");
      const res = await authedFetch(user1AccessToken, urlPath);
      assertNo5xx(res.status, `${op.method.toUpperCase()} ${op.path}`);
      await safeJson(res);
    });

    test(`GET (unauth) ${op.path} does not 5xx`, async () => {
      const urlPath = fillPathParams(op.path, "read");
      const res = await fetch(`${API_BASE_URL}${urlPath}`, {
        headers: { Accept: "application/json" },
      });
      assertNo5xx(res.status, `unauth GET ${op.path}`);
      await safeJson(res);
    });
  }

  test("GET /api/v1/ws/connections returns websocket stats without 5xx", async () => {
    const authed = await authedFetch(user1AccessToken, "/api/v1/ws/connections");
    assertNo5xx(authed.status, "GET /api/v1/ws/connections (auth)");
    const authedJson = await safeJson(authed);
    expect(typeof authedJson.total_connections).toBe("number");
    expect(authedJson.total_connections).toBeGreaterThanOrEqual(0);

    const unauth = await fetch(`${API_BASE_URL}/api/v1/ws/connections`, {
      headers: { Accept: "application/json" },
    });
    assertNo5xx(unauth.status, "GET /api/v1/ws/connections (unauth)");
    const unauthJson = await safeJson(unauth);
    expect(typeof unauthJson.total_connections).toBe("number");
    expect(unauthJson.total_connections).toBeGreaterThanOrEqual(0);
  });

  for (const op of mutateOps.slice(0, mutateLimit)) {
    test(`${op.method.toUpperCase()} ${op.path} rejects invalid payload without 5xx`, async () => {
      const urlPath = fillPathParams(op.path, "safe-mutate");
      const res = await authedFetch(user1AccessToken, urlPath, {
        method: op.method.toUpperCase(),
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      assertNo5xx(res.status, `${op.method.toUpperCase()} ${op.path}`);
      await safeJson(res);
    });
  }

  test("storm: sample of GET routes (auth) under concurrency", async () => {
    const sampleSize = Math.min(
      getOps.length,
      getEnvInt("ATOMIC_MATRIX_SAMPLE", 50),
    );
    const picked = Array.from(
      { length: sampleSize },
      (_, i) => getOps[i % Math.max(getOps.length, 1)],
    );

    const tasks = picked.map((op, idx) => async () => {
      const urlPath = fillPathParams(op.path, "read");
      const res = await authedFetch(
        user1AccessToken,
        urlPath + (urlPath.includes("?") ? "&" : "?") + `i=${idx}`,
      );
      assertNo5xx(res.status, `storm GET ${op.path}`);
      await safeJson(res);
      return res.status;
    });

    const statuses = await concurrentAll(tasks, concurrency);
    expect(statuses.length).toBe(sampleSize);
  });
});
