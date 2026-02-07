import { test, expect } from "@playwright/test";
import { assertNo5xx } from "./atomic-helpers";
import { authedFetch, loginWithToken, makeIsolatedToken } from "./atomic-http";

test.describe("Atomic export categories JSON (break-it; no 5xx)", () => {
  test.describe.configure({ mode: "serial" });

  test("empty user returns 404; created category appears in JSON export", async () => {
    const accessToken = (await loginWithToken(makeIsolatedToken("export-categories-json")))
      .accessToken;

    const emptyRes = await authedFetch(accessToken, "/api/v1/export/categories/json");
    assertNo5xx(emptyRes.status, "export categories json empty");
    expect(emptyRes.status).toBe(404);

    const name = `Категорія ${Date.now().toString(36).slice(-6)}`.slice(0, 100);
    const createRes = await authedFetch(accessToken, "/api/v1/categories", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, description: "опис" }),
    });
    assertNo5xx(createRes.status, "create category for export json");
    expect(createRes.status).toBe(201);
    const created = (await createRes.json()) as { id?: number };

    try {
      const res = await authedFetch(accessToken, "/api/v1/export/categories/json");
      assertNo5xx(res.status, "export categories json");
      expect(res.status).toBe(200);
      expect(res.headers.get("content-type") || "").toContain("application/json");
      const json = (await res.json()) as Array<{ name?: string }>;
      expect(Array.isArray(json)).toBeTruthy();
      expect(json.some((c) => c.name === name)).toBeTruthy();
    } finally {
      if (typeof created.id === "number") {
        await authedFetch(accessToken, `/api/v1/categories/${created.id}`, { method: "DELETE" });
      }
    }
  });
});
