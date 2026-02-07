import { test, expect } from "@playwright/test";
import { login, getAccessToken } from "../test-api";
import { authedFetch, safeJson } from "./atomic-http";
import { assertNo5xx } from "./atomic-helpers";

test.describe("Atomic request validation hardening (no 500 on bad Unicode)", () => {
  test.describe.configure({ mode: "serial" });

  let accessToken = "";

  test.beforeAll(async () => {
    await login();
    const token = getAccessToken();
    expect(token).toBeTruthy();
    accessToken = token as string;
  });

  test("422 validation response never crashes JSON encoder when input contains unpaired surrogate", async () => {
    const evilSurrogate = "\ud800";
    const tooLong = "a".repeat(6001) + evilSurrogate; // exceeds max_length=5000

    const res = await authedFetch(accessToken, "/api/v1/poses", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        code: `VAL_${Date.now().toString(36).slice(-8)}`.slice(0, 20),
        name: "validation-surrogate",
        description: tooLong,
      }),
    });

    assertNo5xx(res.status, "request validation with surrogate");
    expect(res.status).toBe(422);
    const body = await safeJson(res);
    expect(body).toBeTruthy();
    const detail = (body as { detail?: unknown }).detail;
    expect(detail).toBeTruthy();
  });
});

