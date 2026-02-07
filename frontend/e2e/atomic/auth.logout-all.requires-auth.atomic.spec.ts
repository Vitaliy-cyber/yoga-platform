import { test, expect, request as playwrightRequest } from "@playwright/test";
import { assertNo5xx } from "./atomic-helpers";

const API_BASE_URL = process.env.PLAYWRIGHT_API_URL || "http://localhost:8000";

test.describe("Atomic logout-all auth requirement (break-it; no 5xx)", () => {
  test.describe.configure({ mode: "serial" });

  test("logout-all without access or refresh token is rejected", async () => {
    const bareRequest = await playwrightRequest.newContext({
      storageState: { cookies: [], origins: [] },
    });
    const res = await bareRequest.post(`${API_BASE_URL}/api/v1/auth/logout-all`);
    assertNo5xx(res.status(), "logout-all unauthenticated");
    expect([400, 401, 403]).toContain(res.status());
    await bareRequest.dispose();
  });
});
