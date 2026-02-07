import { test, expect } from "@playwright/test";
import { assertNo5xx } from "./atomic-helpers";
import { authedFetch, loginWithToken, makeIsolatedToken } from "./atomic-http";

test.describe("Atomic export poses CSV empty user (break-it; no 5xx)", () => {
  test.describe.configure({ mode: "serial" });

  test("export returns 404 when user has no poses", async () => {
    const { accessToken } = await loginWithToken(makeIsolatedToken("export-csv-empty"));
    const res = await authedFetch(accessToken, "/api/v1/export/poses/csv");
    assertNo5xx(res.status, "export poses/csv empty user");
    expect(res.status).toBe(404);
  });
});
