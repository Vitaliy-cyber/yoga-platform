import { test, expect } from "@playwright/test";
import { assertNo5xx } from "./atomic-helpers";

const API_BASE_URL = process.env.PLAYWRIGHT_API_URL || "http://127.0.0.1:8000";

test.describe("Atomic auth/login validation amplification hardening (no 5xx, no huge echo)", () => {
  test.describe.configure({ mode: "serial" });

  test("422 on too-long token does not reflect massive input", async () => {
    const huge = "A".repeat(250_000);
    const res = await fetch(`${API_BASE_URL}/api/v1/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({ token: huge }),
    });

    assertNo5xx(res.status, "auth/login huge token");
    expect(res.status).toBe(422);

    const text = await res.text();
    expect(text.length).toBeLessThan(20_000);
    expect(text).not.toMatch(/A{1000}/);

    // Ensure JSON remains parseable (no surrogate crash).
    const parsed = JSON.parse(text) as { detail?: unknown };
    expect(parsed && typeof parsed === "object").toBeTruthy();
    expect(parsed.detail).toBeTruthy();
  });
});

