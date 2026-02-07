import { test, expect } from "@playwright/test";
import { assertNo5xx } from "./atomic-helpers";
import { authedFetch, loginWithToken, safeJson } from "./atomic-http";

const API_BASE_URL = process.env.PLAYWRIGHT_API_URL || "http://localhost:8000";
const USER1_TOKEN =
  process.env.E2E_TEST_TOKEN || "e2e-test-token-playwright-2024";

async function createPose(accessToken: string, code: string): Promise<number> {
  const res = await authedFetch(accessToken, "/api/v1/poses", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ code, name: `Atomic Upload ${code}` }),
  });
  assertNo5xx(res.status, "create pose");
  expect(res.status).toBe(201);
  const json = (await res.json()) as { id: number };
  return json.id;
}

async function deletePose(accessToken: string, poseId: number): Promise<void> {
  await authedFetch(accessToken, `/api/v1/poses/${poseId}`, { method: "DELETE" }).catch(
    () => undefined,
  );
}

async function uploadSchemaRaw(
  accessToken: string,
  poseId: number,
  filename: string,
  bytes: Uint8Array,
  contentType: string,
): Promise<Response> {
  const form = new FormData();
  const blob = new Blob([bytes], { type: contentType });
  form.append("file", blob, filename);

  return fetch(`${API_BASE_URL}/api/v1/poses/${poseId}/schema`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      Accept: "application/json",
    },
    body: form,
  });
}

test.describe("Atomic schema upload hardening (magic bytes, no 5xx)", () => {
  test.describe.configure({ mode: "serial" });

  let accessToken = "";
  let poseId: number | null = null;

  test.beforeAll(async () => {
    accessToken = (await loginWithToken(USER1_TOKEN)).accessToken;
    const code = `SCH${Date.now().toString(36).slice(-10)}`.slice(0, 20);
    poseId = await createPose(accessToken, code);
  });

  test.afterAll(async () => {
    if (poseId) await deletePose(accessToken, poseId);
  });

  test("rejects non-image bytes even if content-type is image/png (prevents content-type spoofing)", async () => {
    test.skip(!poseId, "pose not created");

    const bytes = new TextEncoder().encode("not a png at all");
    const res = await uploadSchemaRaw(accessToken, poseId!, "evil.png", bytes, "image/png");
    assertNo5xx(res.status, "schema upload spoofed content-type");
    expect(res.status).toBe(400);
    const body = await safeJson(res);
    expect(body && typeof (body as any).detail === "string").toBeTruthy();
  });

  test("ignores filename extension and stores by MIME type (no .svg paths)", async () => {
    test.skip(!poseId, "pose not created");

    // Minimal PNG header + filler to pass magic bytes check
    const pngHeader = new Uint8Array([
      0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x00,
    ]);
    const res = await uploadSchemaRaw(accessToken, poseId!, "x.svg", pngHeader, "image/png");
    assertNo5xx(res.status, "schema upload extension spoof");
    // Backend might accept but later fail to render; we only assert it doesn't 5xx and doesn't return .svg path.
    expect([200, 400].includes(res.status)).toBeTruthy();
    const json = await safeJson(res);
    if (res.ok) {
      const schemaPath = (json as any)?.schema_path as unknown;
      expect(typeof schemaPath).toBe("string");
      expect(String(schemaPath).toLowerCase()).not.toContain(".svg");
    }
  });
});

