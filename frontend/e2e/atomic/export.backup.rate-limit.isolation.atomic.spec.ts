import { test, expect } from "@playwright/test";
import { assertNo5xx } from "./atomic-helpers";
import { authedFetch, loginWithToken, makeIsolatedToken, safeJson } from "./atomic-http";

test.describe("Atomic export backup rate-limit isolation (break-it; no 5xx)", () => {
  test.describe.configure({ mode: "serial" });

  test("rate-limit applies per-user; other users still get 200", async () => {
    const userA = await loginWithToken(makeIsolatedToken("backup-rl-a"));
    const userB = await loginWithToken(makeIsolatedToken("backup-rl-b"));

    // Consume user A's quota (5 allowed per hour), then expect 429.
    for (let i = 0; i < 5; i += 1) {
      // eslint-disable-next-line no-await-in-loop
      const res = await authedFetch(userA.accessToken, "/api/v1/export/backup");
      assertNo5xx(res.status, `backup userA #${i}`);
      expect(res.status).toBe(200);
      await safeJson(res);
    }

    const resLimited = await authedFetch(userA.accessToken, "/api/v1/export/backup?rl=1");
    assertNo5xx(resLimited.status, "backup userA limit");
    expect(resLimited.status).toBe(429);
    expect(resLimited.headers.get("retry-after")).toBeTruthy();
    await safeJson(resLimited);

    const resOther = await authedFetch(userB.accessToken, "/api/v1/export/backup");
    assertNo5xx(resOther.status, "backup userB after userA limit");
    expect(resOther.status).toBe(200);
    expect(resOther.headers.get("x-total-poses")).toBe("0");
    expect(resOther.headers.get("x-total-categories")).toBe("0");
    await safeJson(resOther);
  });
});
