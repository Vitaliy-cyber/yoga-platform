import { test, expect } from "@playwright/test";
import { login, getAccessToken, createPose, deletePose, getPoseImageSignedUrl } from "../test-api";
import { getCorePoseIdA, getCorePoseIdB } from "../test-data";
import { assertNo5xx, gotoWithRetry } from "./atomic-helpers";

async function loginRaw(apiBase: string, token: string): Promise<string> {
  const res = await fetch(`${apiBase}/api/v1/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "Accept-Language": "uk" },
    body: JSON.stringify({ token }),
  });
  assertNo5xx(res.status, "loginRaw");
  expect(res.ok).toBeTruthy();
  const json = (await res.json()) as { access_token: string };
  expect(json.access_token).toBeTruthy();
  return json.access_token;
}

test.describe("Atomic security invariants", () => {
  const apiBase = process.env.PLAYWRIGHT_API_URL || "http://localhost:8000";

  test.beforeAll(async () => {
    await login();
    expect(getAccessToken()).toBeTruthy();
  });

  test("pose description is rendered as text (no HTML execution; XSS-safe)", async ({ page }) => {
    const pose = await createPose({
      code: `XSS${Date.now().toString(36).slice(-10)}`.slice(0, 20),
      name: `ATOMIC XSS ${Date.now()}`,
      description: `<img src=x onerror="alert(1)"><script>alert(1)</script>`,
    });

    const pageErrors: string[] = [];
    page.on("pageerror", (e) => pageErrors.push(String(e)));

    await gotoWithRetry(page, `/poses/${pose.id}`, { timeoutMs: 45_000 });

    // If the description was inserted as HTML, we'd see an actual <img src="x"> element
    // with an onerror handler. The app should render user-provided description as text.
    await expect(page.locator('img[src="x"]')).toHaveCount(0);
    await expect(page.locator("[onerror]")).toHaveCount(0);
    await expect(page.locator("[onload]")).toHaveCount(0);

    const mainText = await page.locator("#main-content").innerText();
    expect(mainText).toContain("img src=x");
    expect(mainText).toContain("alert(1)");
    expect(pageErrors, "pageerror indicates client-side crash during rendering").toEqual([]);

    await deletePose(pose.id);
  });

  test("signed image URLs never include auth tokens as query params", async () => {
    const poseId = getCorePoseIdA();
    test.skip(!poseId, "Seed pose not available");

    const { signed_url } = await getPoseImageSignedUrl(poseId, "schema");
    expect(signed_url).not.toMatch(/access[_-]?token=/i);
    expect(signed_url).not.toMatch(/\btoken=/i);
    expect(signed_url).toMatch(/^https?:\/\//);
  });

  test("compare endpoint returns 404 for another user's pose (prevents enumeration)", async () => {
    const poseA = getCorePoseIdA();
    const poseB = getCorePoseIdB();
    test.skip(!poseA || !poseB, "Seed poses not available");

    const user2Token = `atomic-user2-${Date.now()}`;
    const user2Access = await loginRaw(apiBase, user2Token);

    // Create a pose for user2
    const createRes = await fetch(`${apiBase}/api/v1/poses`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Accept": "application/json",
        "Accept-Language": "uk",
        Authorization: `Bearer ${user2Access}`,
      },
      body: JSON.stringify({
        code: `U2${Date.now().toString(36).slice(-10)}`.slice(0, 20),
        name: `User2 Pose ${Date.now()}`,
      }),
    });
    assertNo5xx(createRes.status, "user2 create pose");
    expect(createRes.ok).toBeTruthy();
    const user2Pose = (await createRes.json()) as { id: number };

    // As user1 (test-api access token), attempting to compare with user2 pose should yield 403.
    const user1Access = getAccessToken();
    expect(user1Access).toBeTruthy();

    const compareRes = await fetch(
      `${apiBase}/api/v1/compare/poses?ids=${encodeURIComponent(`${poseA},${user2Pose.id}`)}`,
      {
        headers: {
          Accept: "application/json",
          "Accept-Language": "uk",
          Authorization: `Bearer ${user1Access}`,
        },
      },
    );
    assertNo5xx(compareRes.status, "compare");
    expect(compareRes.status).toBe(404);
    const bodyText = await compareRes.text().catch(() => "");
    expect(bodyText).not.toContain(String(user2Pose.id));

    // Cleanup user2 pose
    const deleteRes = await fetch(`${apiBase}/api/v1/poses/${user2Pose.id}`, {
      method: "DELETE",
      headers: {
        Authorization: `Bearer ${user2Access}`,
        "Accept-Language": "uk",
      },
    });
    assertNo5xx(deleteRes.status, "user2 delete pose");
    expect(deleteRes.status).toBe(204);
  });
});
