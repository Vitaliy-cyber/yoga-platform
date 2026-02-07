import { test, expect } from "@playwright/test";
import { assertNo5xx } from "./atomic-helpers";
import { loginWithToken, authedFetch } from "./atomic-http";

const USER1_TOKEN =
  process.env.E2E_TEST_TOKEN || "e2e-test-token-playwright-2024";

test.describe("Atomic validation error amplification hardening (no 5xx, no huge echo)", () => {
  test.describe.configure({ mode: "serial" });

  let accessToken = "";

  test.beforeAll(async () => {
    accessToken = (await loginWithToken(USER1_TOKEN)).accessToken;
  });

  test("422 validation errors do not reflect massive user input (prevents response amplification)", async () => {
    const huge = "A".repeat(200_000);

    const res = await authedFetch(accessToken, "/api/v1/categories", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: huge, description: "x" }),
    });
    assertNo5xx(res.status, "create category huge name");
    expect(res.status).toBe(422);

    const text = await res.text();
    // Guardrails: don't allow a giant echo of the invalid input in the response body.
    expect(text.length).toBeLessThan(20_000);
    expect(text).not.toMatch(/A{1000}/);
  });
});

