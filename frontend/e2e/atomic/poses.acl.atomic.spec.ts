import { test, expect } from "@playwright/test";
import { loginWithToken, authedFetch, safeJson } from "./atomic-http";
import { assertNo5xx, concurrentAll, getEnvInt } from "./atomic-helpers";

const USER1_TOKEN =
  process.env.E2E_TEST_TOKEN || "e2e-test-token-playwright-2024";
const USER2_TOKEN =
  process.env.E2E_TEST_TOKEN_2 || "e2e-test-token-playwright-2024-user-2";

test.describe("Atomic ACL invariants (multi-user)", () => {
  test.describe.configure({ mode: "serial" });

  const concurrency = getEnvInt("ATOMIC_CONCURRENCY", 10);
  let user1AccessToken = "";
  let user2AccessToken = "";
  let user2PoseId: number | null = null;

  test.beforeAll(async () => {
    const [u1, u2] = await Promise.all([
      loginWithToken(USER1_TOKEN),
      loginWithToken(USER2_TOKEN),
    ]);
    user1AccessToken = u1.accessToken;
    user2AccessToken = u2.accessToken;
  });

  test.afterAll(async () => {
    if (!user2PoseId) return;
    await authedFetch(user2AccessToken, `/api/v1/poses/${user2PoseId}`, {
      method: "DELETE",
    }).catch(() => undefined);
  });

  test("user2 can create a pose; user1 cannot read/delete it (no enumeration)", async () => {
    const code = `ACL${Date.now().toString(36).slice(-8)}`.slice(0, 20);
    const createRes = await authedFetch(user2AccessToken, "/api/v1/poses", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        code,
        name: "ACL Pose (u2)",
        description: "Created by atomic ACL test",
      }),
    });
    if (createRes.status !== 201) {
      const txt = await createRes.text().catch(() => "");
      throw new Error(`user2 create pose failed: ${createRes.status} ${txt}`);
    }
    const created = (await createRes.json()) as { id: number };
    user2PoseId = created.id;

    const readAsU1 = await authedFetch(
      user1AccessToken,
      `/api/v1/poses/${user2PoseId}`,
    );
    assertNo5xx(readAsU1.status, "read other user's pose");
    expect([403, 404]).toContain(readAsU1.status);
    await safeJson(readAsU1);

    const deleteAsU1 = await authedFetch(
      user1AccessToken,
      `/api/v1/poses/${user2PoseId}`,
      { method: "DELETE" },
    );
    assertNo5xx(deleteAsU1.status, "delete other user's pose");
    expect([403, 404]).toContain(deleteAsU1.status);
  });

  test("storm: user1 cannot fetch other user's pose even under concurrency", async () => {
    test.skip(!user2PoseId, "requires pose created in prior test");
    const iterations = getEnvInt("ATOMIC_ITERATIONS", 50);
    const tasks = Array.from({ length: iterations }, () => async () => {
      const res = await authedFetch(
        user1AccessToken,
        `/api/v1/poses/${user2PoseId}`,
      );
      assertNo5xx(res.status, "storm read other user's pose");
      await safeJson(res);
      return res.status;
    });
    const statuses = await concurrentAll(tasks, concurrency);
    expect(statuses.every((s) => s === 403 || s === 404)).toBeTruthy();
  });
});
