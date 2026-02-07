import { test, expect } from "@playwright/test";
import { assertNo5xx } from "./atomic-helpers";
import { authedFetch, loginWithToken, makeIsolatedToken, safeJson } from "./atomic-http";

test.describe("Atomic pose update ignores system-managed image paths (security; break-it; never 5xx)", () => {
  test.describe.configure({ mode: "serial" });

  test("PUT /poses/{id} cannot set photo_path/muscle_layer_path", async () => {
    const { accessToken } = await loginWithToken(makeIsolatedToken("ignore-image-paths"));

    const code = `IMGLOCK_${Date.now().toString(36).slice(-8)}`.slice(0, 20);
    const createRes = await authedFetch(accessToken, "/api/v1/poses", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ code, name: `Atomic ${code}` }),
    });
    assertNo5xx(createRes.status, "create pose");
    expect(createRes.status).toBe(201);
    const poseId = ((await safeJson(createRes)) as { id?: unknown } | undefined)?.id;
    expect(typeof poseId).toBe("number");

    try {
      const getRes = await authedFetch(accessToken, `/api/v1/poses/${poseId as number}`);
      assertNo5xx(getRes.status, "get pose");
      expect(getRes.status).toBe(200);
      const before = (await safeJson(getRes)) as { version?: unknown; photo_path?: unknown; muscle_layer_path?: unknown } | undefined;
      expect(typeof before?.version).toBe("number");

      const updateRes = await authedFetch(accessToken, `/api/v1/poses/${poseId as number}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: `Atomic updated ${Date.now()}`,
          version: before?.version,
          change_note: "atomic: attempt to set system-managed image paths",
          photo_path: "http://evil.example/ssrf.png",
          muscle_layer_path: "/storage/evil.png",
        }),
      });
      assertNo5xx(updateRes.status, "update pose");
      expect([200, 409]).toContain(updateRes.status);
      if (updateRes.status === 409) return;

      const updated = (await safeJson(updateRes)) as { photo_path?: unknown; muscle_layer_path?: unknown } | undefined;
      expect(updated?.photo_path).toBe(before?.photo_path);
      expect(updated?.muscle_layer_path).toBe(before?.muscle_layer_path);
    } finally {
      const del = await authedFetch(accessToken, `/api/v1/poses/${poseId as number}`, { method: "DELETE" });
      assertNo5xx(del.status, "delete pose");
      expect([204, 404]).toContain(del.status);
    }
  });
});

