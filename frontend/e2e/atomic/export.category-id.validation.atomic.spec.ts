import { test, expect } from "@playwright/test";
import { assertNo5xx } from "./atomic-helpers";
import { loginWithToken, makeIsolatedToken, authedFetch, safeJson } from "./atomic-http";

test.describe("Atomic export category_id validation (break-it; no 5xx)", () => {
  test.describe.configure({ mode: "serial" });

  test("export endpoints reject category_id <= 0 (422)", async () => {
    const accessToken = (await loginWithToken(makeIsolatedToken("export-cat-id"))).accessToken;

    const paths = [
      "/api/v1/export/poses/json?category_id=0",
      "/api/v1/export/poses/csv?category_id=-1",
      "/api/v1/export/poses/pdf?category_id=0",
    ];

    for (const path of paths) {
      // eslint-disable-next-line no-await-in-loop
      const res = await authedFetch(accessToken, path, { headers: { Accept: "application/json" } });
      assertNo5xx(res.status, `export invalid category_id ${path}`);
      expect(res.status).toBe(422);
      // eslint-disable-next-line no-await-in-loop
      await safeJson(res);
    }
  });
});
