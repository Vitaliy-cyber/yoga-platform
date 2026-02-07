import { test, expect } from "@playwright/test";
import { TEST_TOKEN } from "../fixtures";
import { authedFetch, loginWithToken, makeIsolatedToken, safeJson } from "./atomic-http";
import { assertNo5xx } from "./atomic-helpers";

const API_BASE_URL = process.env.PLAYWRIGHT_API_URL || "http://127.0.0.1:8000";

function toAbsoluteUrl(url: string): string {
  if (url.startsWith("http://") || url.startsWith("https://")) return url;
  if (url.startsWith("/")) return `${API_BASE_URL}${url}`;
  return `${API_BASE_URL}/${url}`;
}

async function waitForTerminalStatus(
  accessToken: string,
  taskId: string,
  timeoutMs: number = 30_000,
): Promise<{ status: string; photo_url?: string | null; muscles_url?: string | null; quota_warning?: boolean }> {
  const startedAt = Date.now();
  // eslint-disable-next-line no-constant-condition
  while (true) {
    const res = await authedFetch(accessToken, `/api/v1/generate/status/${taskId}`, { method: "GET" });
    assertNo5xx(res.status, "generate/status");
    expect(res.status).toBe(200);
    const json = (await safeJson(res)) as
      | { status?: string; photo_url?: string | null; muscles_url?: string | null; quota_warning?: boolean }
      | undefined;
    const st = json?.status || "";
    if (st === "completed" || st === "failed") {
      return { status: st, photo_url: json?.photo_url, muscles_url: json?.muscles_url, quota_warning: json?.quota_warning };
    }
    if (Date.now() - startedAt > timeoutMs) {
      throw new Error(`generation did not reach terminal state in ${timeoutMs}ms`);
    }
    // eslint-disable-next-line no-await-in-loop
    await new Promise((r) => setTimeout(r, 300));
  }
}

async function expectPngBytes(url: string): Promise<void> {
  const res = await fetch(toAbsoluteUrl(url));
  expect(res.status).toBe(200);
  const ct = res.headers.get("content-type") || "";
  expect(ct, "generated image should be served as image/*").toContain("image");
  const buf = Buffer.from(await res.arrayBuffer());
  // PNG signature: 89 50 4E 47 0D 0A 1A 0A
  expect(buf.length).toBeGreaterThan(8);
  expect(buf[0]).toBe(0x89);
  expect(buf[1]).toBe(0x50);
  expect(buf[2]).toBe(0x4e);
  expect(buf[3]).toBe(0x47);
}

async function getSignedUrl(accessToken: string, poseId: number, imageType: "photo" | "muscle_layer") {
  const res = await authedFetch(accessToken, `/api/v1/poses/${poseId}/image/${imageType}/signed-url`, {
    method: "GET",
  });
  assertNo5xx(res.status, "signed-url");
  expect(res.status).toBe(200);
  const json = (await safeJson(res)) as { signed_url?: unknown } | undefined;
  expect(typeof json?.signed_url).toBe("string");
  return json?.signed_url as string;
}

test.describe("Atomic generate/from-pose pipeline (API invariants)", () => {
  test.describe.configure({ mode: "serial" });

  test("from-pose completes, returns valid images, and apply-generation updates pose + version note", async () => {
    const auth = await loginWithToken(makeIsolatedToken(`gen-from-pose-${TEST_TOKEN}`));
    const accessToken = auth.accessToken;

    const code = `GEN_${Date.now().toString(36).slice(-8)}`.slice(0, 20);
    const createRes = await authedFetch(accessToken, "/api/v1/poses", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ code, name: `Atomic ${code}` }),
    });
    assertNo5xx(createRes.status, "create pose");
    expect(createRes.status).toBe(201);
    const created = (await safeJson(createRes)) as { id?: unknown } | undefined;
    expect(typeof created?.id).toBe("number");
    const poseId = created?.id as number;

    // Upload a tiny schema so from-pose has a deterministic source.
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

    const additionalNotes = `Atomic notes ${Date.now()} — match source pose exactly.`;
    const genRes = await authedFetch(accessToken, `/api/v1/generate/from-pose/${poseId}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ additional_notes: additionalNotes }),
    });
    assertNo5xx(genRes.status, "generate/from-pose");
    expect(genRes.status).toBe(200);
    const genJson = (await safeJson(genRes)) as { task_id?: string } | undefined;
    const taskId = genJson?.task_id || "";
    expect(taskId).toBeTruthy();

    const terminal = await waitForTerminalStatus(accessToken, taskId, 30_000);
    expect(terminal.status).toBe("completed");
    expect(typeof terminal.photo_url).toBe("string");
    expect(typeof terminal.muscles_url).toBe("string");

    // In E2E_FAST_AI mode, generation uses deterministic placeholders; quota_warning should be true.
    expect(terminal.quota_warning).toBeTruthy();

    await expectPngBytes(terminal.photo_url as string);
    await expectPngBytes(terminal.muscles_url as string);

    const applyRes = await authedFetch(accessToken, `/api/v1/poses/${poseId}/apply-generation/${taskId}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
    });
    assertNo5xx(applyRes.status, "apply-generation");
    expect(applyRes.status).toBe(200);
    const applied = (await safeJson(applyRes)) as { photo_path?: unknown; muscle_layer_path?: unknown } | undefined;
    expect(typeof applied?.photo_path).toBe("string");
    expect(typeof applied?.muscle_layer_path).toBe("string");

    // UI uses signed URLs for <img> tags; ensure both images are fetchable without auth via signed URL.
    const signedPhoto = await getSignedUrl(accessToken, poseId, "photo");
    const signedMuscles = await getSignedUrl(accessToken, poseId, "muscle_layer");
    await expectPngBytes(signedPhoto);
    await expectPngBytes(signedMuscles);

    // Version note should include the additional notes for traceability.
    const versionsRes = await authedFetch(accessToken, `/api/v1/poses/${poseId}/versions?skip=0&limit=5`, { method: "GET" });
    assertNo5xx(versionsRes.status, "versions(list)");
    expect(versionsRes.status).toBe(200);
    const versionsJson = (await safeJson(versionsRes)) as { items?: Array<{ change_note?: string | null }> } | undefined;
    const note = versionsJson?.items?.[0]?.change_note || "";
    expect(note).toContain("AI regeneration applied");
    expect(note).toContain("Notes:");
    expect(note).toContain("Atomic notes");

    await authedFetch(accessToken, `/api/v1/poses/${poseId}`, { method: "DELETE" }).catch(() => undefined);
  });
});
