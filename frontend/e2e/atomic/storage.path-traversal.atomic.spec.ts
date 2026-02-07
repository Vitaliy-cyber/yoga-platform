import { test, expect } from "@playwright/test";
import { assertNo5xx } from "./atomic-helpers";

const API_BASE_URL = process.env.PLAYWRIGHT_API_URL || "http://127.0.0.1:8000";

test.describe("Atomic /storage path traversal hardening (break-it; no leaks; no 5xx)", () => {
  test.describe.configure({ mode: "serial" });

  const probes = [
    "/storage/../main.py",
    "/storage/..%2fmain.py",
    "/storage/%2e%2e/main.py",
    "/storage/%2e%2e%2f%2e%2e%2fetc%2fpasswd",
    "/storage/..%2f..%2f..%2fetc%2fpasswd",
    "/storage/%2fetc%2fpasswd",
    "/storage/%5c..%5c..%5cetc%5cpasswd", // backslashes
    "/storage/%2e%2e%5c%2e%2e%5cetc%5cpasswd",
    "/storage/%2e%2e%2f%2e%2e%2fproc%2fself%2fenviron",
    "/storage/%2e%2e%2f%2e%2e%2fhome%2ftettra%2f.ssh%2fid_rsa",
  ];

  test("traversal probes never return 200 and never 5xx", async () => {
    for (const path of probes) {
      // eslint-disable-next-line no-await-in-loop
      const res = await fetch(`${API_BASE_URL}${path}`, {
        method: "GET",
        headers: { Accept: "*/*" },
      });
      assertNo5xx(res.status, path);
      expect(res.status, path).not.toBe(200);

      const ct = res.headers.get("content-type") || "";
      const text = ct.includes("text") || ct.includes("json")
        ? // eslint-disable-next-line no-await-in-loop
          await res.text().catch(() => "")
        : "";

      // Avoid obvious sensitive markers if server ever responds with text.
      expect(text).not.toContain("root:");
      expect(text.toLowerCase()).not.toContain("ssh");
      expect(text.toLowerCase()).not.toContain("private key");
      expect(text.toLowerCase()).not.toContain("password");
    }
  });
});

