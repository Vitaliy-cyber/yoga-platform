import { test, expect } from "@playwright/test";
import { assertNo5xx } from "./atomic-helpers";

const API_BASE_URL = process.env.PLAYWRIGHT_API_URL || "http://localhost:8000";

test.describe("Atomic export auth required (break-it; no 5xx)", () => {
  test.describe.configure({ mode: "serial" });

  test("export endpoints reject missing auth", async () => {
    const paths = [
      "/api/v1/export/poses/json",
      "/api/v1/export/poses/csv",
      "/api/v1/export/poses/pdf",
      "/api/v1/export/categories/json",
      "/api/v1/export/backup",
      "/api/v1/export/pose/1/pdf?page_size=A4",
    ];

    for (const path of paths) {
      // eslint-disable-next-line no-await-in-loop
      const res = await fetch(`${API_BASE_URL}${path}`, {
        headers: { Accept: "application/json" },
      });
      assertNo5xx(res.status, `export missing auth ${path}`);
      expect([401, 403]).toContain(res.status);
    }
  });
});
