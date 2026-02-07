import { test, expect } from "@playwright/test";
import { login, getAccessToken, createPose, deletePose } from "../test-api";
import { getFirstCategoryId } from "../test-data";
import { assertNo5xx, concurrentAll, getEnvInt } from "./atomic-helpers";

const API_BASE_URL = process.env.PLAYWRIGHT_API_URL || "http://localhost:8000";

async function uploadSchemaRaw(
  accessToken: string,
  poseId: number,
  buffer: Uint8Array,
  filename: string,
  mimeType: string,
): Promise<Response> {
  const url = `${API_BASE_URL}/api/v1/poses/${poseId}/schema`;
  const form = new FormData();
  const blob = new Blob([buffer], { type: mimeType });
  form.append("file", blob, filename);

  return fetch(url, {
    method: "POST",
    headers: { Authorization: `Bearer ${accessToken}` },
    body: form,
  });
}

test.describe("Atomic upload fuzz (schema)", () => {
  const concurrency = getEnvInt("ATOMIC_CONCURRENCY", 6);
  let poseId: number | null = null;
  let accessToken = "";

  test.beforeAll(async () => {
    await login();
    const token = getAccessToken();
    expect(token).toBeTruthy();
    accessToken = token as string;

    const categoryId = getFirstCategoryId();
    const code = `UF${Date.now().toString(36).slice(-8)}`.slice(0, 20);
    const pose = await createPose({
      code,
      name: "Upload fuzz pose",
      category_id: categoryId,
      description: "Created by atomic upload fuzz",
    });
    poseId = pose.id;
  });

  test.afterAll(async () => {
    if (poseId) await deletePose(poseId);
  });

  test("rejects invalid mime/extension without 5xx", async () => {
    test.skip(!poseId, "pose not created");
    const cases = [
      { filename: "evil.exe", mime: "application/octet-stream", bytes: new Uint8Array([0x4d, 0x5a, 0x90, 0x00]) }, // MZ header
      { filename: "image.png", mime: "image/png", bytes: new Uint8Array([0x89, 0x50, 0x4e, 0x47]) },
      { filename: "schema.txt", mime: "text/plain", bytes: new TextEncoder().encode("not a schema") },
      { filename: "schema.json", mime: "application/json", bytes: new TextEncoder().encode("{bad json") },
    ];

    for (const c of cases) {
      // eslint-disable-next-line no-await-in-loop
      const res = await uploadSchemaRaw(accessToken, poseId as number, c.bytes, c.filename, c.mime);
      assertNo5xx(res.status, `upload ${c.filename} (${c.mime})`);
      expect([200, 201, 400, 413, 415, 422]).toContain(res.status);
    }
  });

  test("storm: repeated invalid uploads do not 5xx under concurrency", async () => {
    test.skip(!poseId, "pose not created");
    const iterations = getEnvInt("ATOMIC_ITERATIONS", 40);
    const bytes = new TextEncoder().encode("not a valid schema");

    const tasks = Array.from({ length: iterations }, (_, i) => async () => {
      const filename = i % 2 === 0 ? "storm.exe" : "storm.txt";
      const mime = i % 2 === 0 ? "application/octet-stream" : "text/plain";
      const res = await uploadSchemaRaw(accessToken, poseId as number, bytes, filename, mime);
      assertNo5xx(res.status, `storm upload ${i}`);
      return res.status;
    });

    const statuses = await concurrentAll(tasks, concurrency);
    expect(statuses.length).toBe(iterations);
  });
});
