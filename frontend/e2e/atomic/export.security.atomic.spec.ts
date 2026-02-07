import { test, expect } from "@playwright/test";
import { login, getAccessToken, createPose, deletePose } from "../test-api";
import { assertNo5xx } from "./atomic-helpers";

const API_BASE_URL = process.env.PLAYWRIGHT_API_URL || "http://localhost:8000";

test.describe("Atomic export security invariants", () => {
  let accessToken = "";
  let poseId: number | null = null;

  test.beforeAll(async () => {
    await login();
    const token = getAccessToken();
    expect(token).toBeTruthy();
    accessToken = token as string;

    const pose = await createPose({
      code: `EX${Date.now().toString(36).slice(-10)}`.slice(0, 20),
      name: "=2+2", // CSV injection attempt
      description: "@SUM(1,1)", // CSV injection attempt
    });
    poseId = pose.id;
  });

  test.afterAll(async () => {
    if (poseId) await deletePose(poseId);
  });

  test("CSV export escapes formula injection (prefixes dangerous cells)", async () => {
    const res = await fetch(`${API_BASE_URL}/api/v1/export/poses/csv`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    assertNo5xx(res.status, "export csv");
    expect([200, 404]).toContain(res.status);
    if (res.status !== 200) return;

    const text = await res.text();
    // The CSV writer uses QUOTE_ALL, so fields will be quoted.
    expect(text).toContain("\"'=2+2\"");
    expect(text).toContain("\"'@SUM(1,1)\"");
  });

  test("JSON export responds without 5xx", async () => {
    const res = await fetch(`${API_BASE_URL}/api/v1/export/poses/json`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    assertNo5xx(res.status, "export json");
    expect([200, 404]).toContain(res.status);
  });
});
