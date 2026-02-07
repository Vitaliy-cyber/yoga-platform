import { test, expect } from "@playwright/test";
import { assertNo5xx } from "./atomic-helpers";
import { authedFetch, loginWithToken, makeIsolatedToken, safeJson } from "./atomic-http";

test.describe("Atomic UTF-8 request hardening (invalid Unicode never 5xx)", () => {
  test.describe.configure({ mode: "serial" });

  let accessToken = "";

  test.beforeAll(async () => {
    accessToken = (await loginWithToken(makeIsolatedToken("utf8-req"))).accessToken;
  });

  test("pose create rejects unpaired surrogate (\\uD800) with 422 and JSON body (no 5xx)", async () => {
    const code = `U8_${Date.now().toString(36).slice(-8)}`.slice(0, 20);
    // Send raw JSON so the backend JSON parser decodes \\uD800 into an actual surrogate code unit.
    const body = `{"code":"${code}","name":"\\uD800BROKEN"}`;
    const res = await authedFetch(accessToken, "/api/v1/poses", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body,
    });

    assertNo5xx(res.status, "create pose with invalid unicode");
    if (res.status === 201) {
      // Defensive cleanup if the payload is ever accepted.
      const json = (await safeJson(res)) as { id?: number } | undefined;
      const id = json?.id;
      if (typeof id === "number") {
        await authedFetch(accessToken, `/api/v1/poses/${id}`, { method: "DELETE" }).catch(
          () => undefined,
        );
      }
      throw new Error(`Expected 422, got 201 (created pose unexpectedly)`);
    }
    expect(res.status).toBe(422);
    const json = (await safeJson(res)) as { detail?: unknown } | undefined;
    expect(json && typeof json === "object").toBeTruthy();
    // Response must not echo raw surrogates (should be sanitized and UTF-8 encodable)
    expect(JSON.stringify(json)).not.toContain("\\\\ud800");
  });
});
