import { test, expect } from "@playwright/test";
import { assertNo5xx } from "./atomic-helpers";

const API_BASE_URL = process.env.PLAYWRIGHT_API_URL || "http://localhost:8000";

test.describe("Atomic storage traversal hardening (break-it; no 5xx)", () => {
  test.describe.configure({ mode: "serial" });

  const candidates = [
    "/storage/../main.py",
    "/storage/..%2fmain.py",
    "/storage/%2e%2e/main.py",
    "/storage/%2e%2e%2fmain.py",
    "/storage/%2e%2e%5cmain.py",
    "/storage/%2e%2e%255cmain.py",
    "/storage/%2e%2e%252fmain.py",
    "/storage/%2fetc%2fpasswd",
    "/storage/%5cwindows%5csystem32%5cdrivers%5cetc%5chosts",
    "/storage/..%2f..%2f..%2f..%2fetc%2fpasswd",
  ];

  for (const path of candidates) {
    test(`GET ${path} does not expose arbitrary files`, async () => {
      const res = await fetch(`${API_BASE_URL}${path}`, {
        headers: { Accept: "*/*" },
      });
      assertNo5xx(res.status, `storage traversal probe ${path}`);

      // If traversal worked, we'd likely see 200 and non-trivial text.
      expect(res.status).not.toBe(200);
    });
  }
});

