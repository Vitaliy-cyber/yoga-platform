import { test, expect } from "@playwright/test";
import { login, getAccessToken, getMuscles } from "../test-api";
import {
  getCoreCategoryId,
  getCorePoseIdA,
  getCoreSequenceId,
} from "../test-data";
import { assertNo5xx } from "./atomic-helpers";

type OpenAPI = {
  paths: Record<
    string,
    Record<string, { tags?: string[]; summary?: string; operationId?: string }>
  >;
};

function shouldSkipPath(pathname: string): boolean {
  // Skip binary / heavy endpoints.
  if (pathname.includes("/export/")) return true;
  if (pathname.includes("/import/")) return true;
  if (pathname.includes("/ws/")) return true;
  if (pathname.includes("/versions")) return true;
  if (pathname.includes("/pdf")) return true;
  if (pathname.includes("/image/") && !pathname.endsWith("/signed-url")) return true;
  if (pathname.includes("/backup")) return true;
  return false;
}

function resolvePath(pathTemplate: string, replacements: Record<string, string>): string | null {
  const missing = [...pathTemplate.matchAll(/\{([^}]+)\}/g)]
    .map((m) => m[1])
    .filter((k) => !replacements[k]);
  if (missing.length) return null;

  return pathTemplate.replace(/\{([^}]+)\}/g, (_, k) => replacements[k] ?? "");
}

test.describe("Atomic OpenAPI smoke (no 5xx)", () => {
  let apiBase = "http://localhost:8000";
  let accessToken: string | null = null;
  let firstMuscleId: number | null = null;

  test.beforeAll(async () => {
    apiBase = process.env.PLAYWRIGHT_API_URL || "http://localhost:8000";
    await login();
    accessToken = getAccessToken();
    const muscles = await getMuscles().catch(() => []);
    firstMuscleId = muscles[0]?.id ?? null;
  });

  test("GET /openapi.json is reachable", async () => {
    const res = await fetch(`${apiBase}/openapi.json`);
    expect(res.ok).toBeTruthy();
  });

  test("all GET JSON endpoints do not return 5xx", async () => {
    const res = await fetch(`${apiBase}/openapi.json`);
    const spec = (await res.json()) as OpenAPI;

    const corePoseId = getCorePoseIdA();
    const coreCategoryId = getCoreCategoryId();
    const coreSequenceId = getCoreSequenceId();

    const replacements: Record<string, string> = {
      pose_id: corePoseId ? String(corePoseId) : "",
      category_id: coreCategoryId ? String(coreCategoryId) : "",
      sequence_id: coreSequenceId ? String(coreSequenceId) : "",
      muscle_id: firstMuscleId ? String(firstMuscleId) : "",
      image_type: "schema",
      code: "E2E-CORE-POSE-A",
      session_id: "1",
    };

    const paths = Object.keys(spec.paths).filter((p) => p.startsWith("/api/v1/"));
    const candidates = paths
      .filter((p) => !shouldSkipPath(p))
      .filter((p) => Object.keys(spec.paths[p] || {}).some((m) => m.toLowerCase() === "get"));

    for (const pathTemplate of candidates) {
      const resolved = resolvePath(pathTemplate, replacements);
      if (!resolved) continue;

      // eslint-disable-next-line no-await-in-loop
      const response = await fetch(`${apiBase}${resolved}`, {
        method: "GET",
        headers: {
          ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
          "Accept": "application/json",
          "Accept-Language": "uk",
        },
      });

      const status = response.status;
      assertNo5xx(status, `${resolved}`);

      // Most endpoints should be JSON; allow 204/404/401/403/422 as long as not 5xx.
      if (status !== 204) {
        const contentType = response.headers.get("content-type") || "";
        if (contentType.includes("application/json")) {
          // eslint-disable-next-line no-await-in-loop
          await response.json().catch(() => undefined);
        }
      }
    }
  });
});
