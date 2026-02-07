import { test, expect } from "@playwright/test";
import { assertNo5xx } from "./atomic-helpers";
import { authedFetch, loginWithToken, makeIsolatedToken, safeJson } from "./atomic-http";

const API_BASE_URL = process.env.PLAYWRIGHT_API_URL || "http://localhost:8000";

async function createPoseWithSchema(accessToken: string, code: string): Promise<number> {
  const createRes = await authedFetch(accessToken, "/api/v1/poses", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ code, name: `Own ${code}` }),
  });
  assertNo5xx(createRes.status, "create pose");
  expect(createRes.status).toBe(201);
  const poseId = ((await safeJson(createRes)) as any)?.id as number;
  expect(typeof poseId).toBe("number");

  const tinyPng = Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR4nGNgYAAAAAMAASsJTYQAAAAASUVORK5CYII=",
    "base64",
  );
  const form = new FormData();
  form.append("file", new Blob([tinyPng], { type: "image/png" }), "schema.png");
  const schemaRes = await fetch(`${API_BASE_URL}/api/v1/poses/${poseId}/schema`, {
    method: "POST",
    headers: { Authorization: `Bearer ${accessToken}`, Accept: "application/json" },
    body: form,
  });
  assertNo5xx(schemaRes.status, "upload schema");
  expect(schemaRes.status).toBe(200);

  return poseId;
}

async function deletePose(accessToken: string, poseId: number): Promise<void> {
  const res = await authedFetch(accessToken, `/api/v1/poses/${poseId}`, { method: "DELETE" });
  assertNo5xx(res.status, "delete pose");
  expect([204, 404]).toContain(res.status);
}

test.describe("Atomic pose image signed URL ownership (break-it; no 5xx)", () => {
  test.describe.configure({ mode: "serial" });

  test("other user cannot obtain signed URL for your pose (404; never 5xx)", async () => {
    const userA = await loginWithToken(makeIsolatedToken("signedurl-own-a"));
    const userB = await loginWithToken(makeIsolatedToken("signedurl-own-b"));

    const code = `SOWN_${Date.now().toString(36).slice(-8)}`.slice(0, 20);
    const poseId = await createPoseWithSchema(userA.accessToken, code);

    try {
      const ok = await authedFetch(
        userA.accessToken,
        `/api/v1/poses/${poseId}/image/schema/signed-url`,
      );
      assertNo5xx(ok.status, "signed-url (owner)");
      expect(ok.status).toBe(200);
      const okJson = (await safeJson(ok)) as { signed_url?: unknown } | undefined;
      expect(typeof okJson?.signed_url).toBe("string");

      const res = await authedFetch(
        userB.accessToken,
        `/api/v1/poses/${poseId}/image/schema/signed-url`,
        { headers: { Accept: "application/json" } },
      );
      assertNo5xx(res.status, "signed-url (other user)");
      expect([404, 422]).toContain(res.status);
      const txt = await res.text();
      expect(txt.toLowerCase()).not.toContain("traceback");
      expect(txt.toLowerCase()).not.toContain("sqlalchemy");
    } finally {
      await deletePose(userA.accessToken, poseId);
    }
  });
});

