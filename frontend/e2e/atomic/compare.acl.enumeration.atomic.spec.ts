import { test, expect } from "@playwright/test";
import { assertNo5xx } from "./atomic-helpers";
import { loginWithToken, authedFetch, safeJson } from "./atomic-http";
import { getFirstPoseId } from "../test-data";

const API_BASE_URL = process.env.PLAYWRIGHT_API_URL || "http://localhost:8000";

const USER1_TOKEN =
  process.env.E2E_TEST_TOKEN || "e2e-test-token-playwright-2024";
const USER2_TOKEN =
  process.env.E2E_TEST_TOKEN_USER2 || "e2e-test-token-playwright-2024-user2";

test.describe("Atomic compare ACL hardening (no enumeration)", () => {
  test.describe.configure({ mode: "serial" });

  let user1Access = "";
  let user2Access = "";
  let user2PoseId: number | null = null;

  test.beforeAll(async () => {
    user1Access = (await loginWithToken(USER1_TOKEN)).accessToken;
    user2Access = (await loginWithToken(USER2_TOKEN)).accessToken;

    const createRes = await authedFetch(user2Access, "/api/v1/poses", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        code: `U2_${Date.now().toString(36).slice(-10)}`.slice(0, 20),
        name: "User2 Private Pose",
        description: "Should not be visible to user1",
      }),
    });
    assertNo5xx(createRes.status, "user2 create pose");
    expect(createRes.status).toBe(201);
    const created = (await createRes.json()) as { id: number };
    user2PoseId = created.id;
  });

  test.afterAll(async () => {
    if (!user2PoseId) return;
    await authedFetch(user2Access, `/api/v1/poses/${user2PoseId}`, { method: "DELETE" });
  });

  test("compare/poses returns 404 (not 403) when any pose belongs to another user", async () => {
    const user1PoseId = getFirstPoseId();
    expect(user2PoseId).toBeTruthy();

    const res = await fetch(
      `${API_BASE_URL}/api/v1/compare/poses?ids=${encodeURIComponent(
        `${user1PoseId},${user2PoseId}`,
      )}`,
      { headers: { Authorization: `Bearer ${user1Access}`, Accept: "application/json" } },
    );
    assertNo5xx(res.status, "compare poses mixed ownership");
    expect(res.status).toBe(404);
    const body = (await safeJson(res)) as { detail?: unknown } | undefined;
    expect(String(body?.detail ?? "")).not.toContain(String(user2PoseId));
  });

  test("compare/muscles returns 404 (not 403) when any pose belongs to another user", async () => {
    const user1PoseId = getFirstPoseId();
    expect(user2PoseId).toBeTruthy();

    const res = await fetch(
      `${API_BASE_URL}/api/v1/compare/muscles?pose_ids=${encodeURIComponent(
        `${user1PoseId},${user2PoseId}`,
      )}`,
      { headers: { Authorization: `Bearer ${user1Access}`, Accept: "application/json" } },
    );
    assertNo5xx(res.status, "compare muscles mixed ownership");
    expect(res.status).toBe(404);
    await safeJson(res);
  });
});
