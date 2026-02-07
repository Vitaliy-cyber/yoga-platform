import { test, expect } from "@playwright/test";
import { TEST_TOKEN } from "../fixtures";
import { authedFetch, loginWithToken, makeIsolatedToken, safeJson } from "./atomic-http";
import { assertNo5xx } from "./atomic-helpers";
import fs from "fs/promises";
import path from "path";

const API_BASE_URL = process.env.PLAYWRIGHT_API_URL || "http://127.0.0.1:8000";

function storageUrlToBackendPath(storageUrl: string): string {
  // LocalStorage returns `/storage/<key>` where `<key>` is under backend/storage/.
  if (!storageUrl.startsWith("/storage/")) {
    throw new Error(`expected /storage/ url, got: ${storageUrl}`);
  }
  const rel = storageUrl.slice("/storage/".length);
  // Frontend e2e cwd is yoga-platform/frontend; backend storage is ../backend/storage.
  const backendStorageRoot = path.resolve(process.cwd(), "..", "backend", "storage");
  const full = path.resolve(backendStorageRoot, rel);
  if (!full.startsWith(`${backendStorageRoot}${path.sep}`)) {
    throw new Error("refusing to write outside backend storage");
  }
  return full;
}

test.describe("Atomic generate/from-pose rejects corrupted schema bytes", () => {
  test.describe.configure({ mode: "serial" });

  test("if schema file becomes non-image, from-pose returns 400 (never starts task)", async () => {
    const auth = await loginWithToken(makeIsolatedToken(`gen-from-pose-corrupt-${TEST_TOKEN}`));
    const accessToken = auth.accessToken;

    const code = `CORR_${Date.now().toString(36).slice(-8)}`.slice(0, 20);
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

    // Upload a valid schema first (so schema_path exists).
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
    const schemaJson = (await schemaRes.json()) as { schema_path?: unknown };
    expect(typeof schemaJson.schema_path).toBe("string");
    const schemaPath = schemaJson.schema_path as string;

    // Corrupt the file on disk to simulate legacy/imported/mismatched data.
    const diskPath = storageUrlToBackendPath(schemaPath);
    await fs.writeFile(diskPath, Buffer.from("fake image content", "utf8"));

    const genRes = await authedFetch(accessToken, `/api/v1/generate/from-pose/${poseId}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ additional_notes: "atomic" }),
    });
    assertNo5xx(genRes.status, "generate/from-pose with corrupted schema");
    expect(genRes.status).toBe(400);
    const err = (await safeJson(genRes)) as { detail?: unknown } | undefined;
    expect(String(err?.detail || "")).toContain("corrupted");

    await authedFetch(accessToken, `/api/v1/poses/${poseId}`, { method: "DELETE" }).catch(() => undefined);
  });
});
