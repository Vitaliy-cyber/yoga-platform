import { test, expect, request as playwrightRequest } from "@playwright/test";
import { assertNo5xx } from "./atomic-helpers";

const API_BASE_URL = process.env.PLAYWRIGHT_API_URL || "http://localhost:8000";

function getSetCookies(response: import("@playwright/test").APIResponse): string[] {
  return response
    .headersArray()
    .filter((h) => h.name.toLowerCase() === "set-cookie")
    .map((h) => h.value);
}

function findCookie(
  cookies: string[],
  name: string,
  predicate?: (cookie: string) => boolean,
): string | undefined {
  return cookies.find((cookie) => {
    if (!cookie.startsWith(`${name}=`)) return false;
    return predicate ? predicate(cookie) : true;
  });
}

test.describe("Atomic refresh missing token (break-it; no 5xx)", () => {
  test.describe.configure({ mode: "serial" });

  test("refresh without cookie or body returns 400 and clears cookies", async () => {
    const bare = await playwrightRequest.newContext({
      storageState: { cookies: [], origins: [] },
    });
    const res = await bare.post(`${API_BASE_URL}/api/v1/auth/refresh`);
    assertNo5xx(res.status(), "refresh missing token");
    expect(res.status()).toBe(400);

    const cookies = getSetCookies(res);
    const refreshClear = findCookie(
      cookies,
      "refresh_token",
      (cookie) => cookie.includes("Path=/") && cookie.toLowerCase().includes("max-age=0"),
    );
    const csrfClear = findCookie(
      cookies,
      "csrf_token",
      (cookie) => cookie.includes("Path=/") && cookie.toLowerCase().includes("max-age=0"),
    );
    expect(refreshClear).toBeTruthy();
    expect(csrfClear).toBeTruthy();
    await bare.dispose();
  });
});
