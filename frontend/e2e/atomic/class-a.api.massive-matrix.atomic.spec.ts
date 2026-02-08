import { test, expect } from "@playwright/test";

import { assertNo5xx } from "./atomic-helpers";
import { loginWithToken, makeIsolatedToken } from "./atomic-http";
import { getFirstCategoryId, getFirstPoseId, getTwoPoseIds } from "../test-data";

const API_BASE_URL = process.env.PLAYWRIGHT_API_URL || "http://localhost:8000";
const USER1_TOKEN = process.env.E2E_TEST_TOKEN || "e2e-test-token-playwright-2024";

type AuthContext = "user1" | "user2" | "unauth";

type HeaderProfile = {
  id: string;
  headers: Record<string, string>;
  withNonce?: boolean;
};

type EndpointCase = {
  id: string;
  path: () => string;
};

const headerProfiles: HeaderProfile[] = [
  { id: "baseline", headers: {} },
  { id: "accept-json", headers: { Accept: "application/json" } },
  { id: "lang-uk", headers: { "Accept-Language": "uk" } },
  { id: "lang-en", headers: { "Accept-Language": "en" } },
  { id: "cache-no-store", headers: { "Cache-Control": "no-store" } },
  { id: "origin-localhost", headers: { Origin: "http://localhost:3000" } },
  { id: "origin-loopback", headers: { Origin: "http://127.0.0.1:3000" } },
  {
    id: "nonce",
    headers: {
      Accept: "application/json",
      "Cache-Control": "no-cache",
      Pragma: "no-cache",
    },
    withNonce: true,
  },
];

const buildMatrixEndpoints = (): EndpointCase[] => {
  const poseId = getFirstPoseId();
  const categoryId = getFirstCategoryId();
  const [poseA, poseB] = getTwoPoseIds();

  return [
    { id: "auth-me", path: () => "/api/v1/auth/me" },
    { id: "categories-list", path: () => "/api/v1/categories" },
    { id: "muscles-list", path: () => "/api/v1/muscles" },
    { id: "poses-list", path: () => "/api/v1/poses?skip=0&limit=25" },
    { id: "poses-search", path: () => "/api/v1/poses/search?q=e2e" },
    { id: "poses-by-category", path: () => `/api/v1/poses/category/${categoryId}` },
    { id: "pose-by-id", path: () => `/api/v1/poses/${poseId}` },
    {
      id: "pose-versions-list",
      path: () => `/api/v1/poses/${poseId}/versions?skip=0&limit=20`,
    },
    { id: "pose-versions-count", path: () => `/api/v1/poses/${poseId}/versions/count` },
    { id: "analytics-overview", path: () => "/api/v1/analytics/overview" },
    { id: "analytics-muscles", path: () => "/api/v1/analytics/muscles" },
    { id: "sequences-list", path: () => "/api/v1/sequences?skip=0&limit=25" },
    { id: "compare-poses", path: () => `/api/v1/compare/poses?ids=${poseA},${poseB}` },
    {
      id: "compare-muscles",
      path: () => `/api/v1/compare/muscles?pose_ids=${poseA},${poseB}`,
    },
    {
      id: "pose-image-signed-url",
      path: () => `/api/v1/poses/${poseId}/image/schema/signed-url`,
    },
  ];
};

const withNonce = (
  absoluteUrl: string,
  meta: { endpointId: string; profileId: string; authContext: AuthContext },
): string => {
  const parsed = new URL(absoluteUrl);
  parsed.searchParams.set(
    "_mtx",
    `${meta.endpointId}-${meta.profileId}-${meta.authContext}-${Date.now()}`.slice(0, 120),
  );
  return parsed.toString();
};

test.describe("Class-A Atomic API massive matrix", () => {
  const endpoints = buildMatrixEndpoints();

  let user1AccessToken = "";
  let user2AccessToken = "";

  test.beforeAll(async () => {
    const user1 = await loginWithToken(USER1_TOKEN);
    user1AccessToken = user1.accessToken;

    const user2 = await loginWithToken(makeIsolatedToken("class-a-matrix-user2"));
    user2AccessToken = user2.accessToken;
  });

  const authContexts: AuthContext[] = ["user1", "user2", "unauth"];

  for (const endpoint of endpoints) {
    for (const profile of headerProfiles) {
      for (const authContext of authContexts) {
        test(`[${authContext}] GET ${endpoint.id} | profile=${profile.id}`, async ({
          request,
        }) => {
          const basePath = endpoint.path();
          const absoluteBaseUrl = `${API_BASE_URL}${basePath}`;
          const absoluteUrl = profile.withNonce
            ? withNonce(absoluteBaseUrl, {
                endpointId: endpoint.id,
                profileId: profile.id,
                authContext,
              })
            : absoluteBaseUrl;

          const headers: Record<string, string> = { ...profile.headers };
          if (authContext === "user1") {
            headers.Authorization = `Bearer ${user1AccessToken}`;
          } else if (authContext === "user2") {
            headers.Authorization = `Bearer ${user2AccessToken}`;
          }

          const response = await request.get(absoluteUrl, { headers });
          const status = response.status();

          assertNo5xx(status, `${authContext} GET ${endpoint.id} (${profile.id})`);

          if (authContext === "unauth") {
            expect(
              [401, 403, 404].includes(status) || status === 200,
              `Unexpected unauth status=${status} for ${endpoint.id}`,
            ).toBeTruthy();
          } else {
            expect(status).not.toBe(401);
          }

          const contentType = response.headers()["content-type"] || "";
          const body = await response.text();
          expect(body.length).toBeLessThan(2_000_000);

          if (contentType.includes("application/json")) {
            expect(() => JSON.parse(body)).not.toThrow();
          } else {
            // Fallback invariant for non-json edge responses.
            expect(typeof body).toBe("string");
          }
        });
      }
    }
  }
});
