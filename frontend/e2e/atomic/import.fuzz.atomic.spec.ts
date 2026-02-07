import { test, expect } from "@playwright/test";
import { loginWithToken, authedFetch, safeJson } from "./atomic-http";
import { assertNo5xx, concurrentAll, getEnvInt } from "./atomic-helpers";

const USER1_TOKEN =
  process.env.E2E_TEST_TOKEN || "e2e-test-token-playwright-2024";

function formWithFile(bytes: Uint8Array, filename: string, mimeType: string): FormData {
  const form = new FormData();
  const blob = new Blob([bytes], { type: mimeType });
  form.append("file", blob, filename);
  return form;
}

test.describe("Atomic import fuzz (no mocks)", () => {
  const concurrency = getEnvInt("ATOMIC_CONCURRENCY", 8);
  let accessToken = "";

  test.beforeAll(async () => {
    const u1 = await loginWithToken(USER1_TOKEN);
    accessToken = u1.accessToken;
  });

  test("preview/json rejects invalid JSON without leaking stack traces", async () => {
    const bad = new TextEncoder().encode("{not json");
    const res = await authedFetch(accessToken, "/api/v1/import/preview/json", {
      method: "POST",
      body: formWithFile(bad, "bad.json", "application/json"),
    });
    assertNo5xx(res.status, "preview bad json");
    expect([200, 400, 422]).toContain(res.status);
    const json = (await safeJson(res)) as { validation_errors?: string[] } | undefined;
    const msg = JSON.stringify(json || "");
    expect(msg).not.toContain("Traceback");
    expect(msg).not.toContain("/home/");
  });

  test("poses/json rejects wrong extension (400) without 5xx", async () => {
    const ok = new TextEncoder().encode("[]");
    const res = await authedFetch(accessToken, "/api/v1/import/poses/json", {
      method: "POST",
      body: formWithFile(ok, "poses.txt", "text/plain"),
    });
    assertNo5xx(res.status, "import poses/json wrong ext");
    expect([400, 422]).toContain(res.status);
  });

  test("poses/csv rejects wrong extension (400) without 5xx", async () => {
    const ok = new TextEncoder().encode("code,name\nA,Pose\n");
    const res = await authedFetch(accessToken, "/api/v1/import/poses/csv", {
      method: "POST",
      body: formWithFile(ok, "poses.json", "application/json"),
    });
    assertNo5xx(res.status, "import poses/csv wrong ext");
    expect([400, 422]).toContain(res.status);
  });

  test("file size guard: oversized preview/json returns 413 (no 5xx)", async () => {
    const sizeMb = getEnvInt("ATOMIC_IMPORT_BIG_MB", 11);
    const big = new Uint8Array(sizeMb * 1024 * 1024);
    big.fill(0x61); // 'a'
    const res = await authedFetch(accessToken, "/api/v1/import/preview/json", {
      method: "POST",
      body: formWithFile(big, "big.json", "application/json"),
    });
    assertNo5xx(res.status, "preview big json");
    expect([400, 413, 422]).toContain(res.status);
  });

  test("storm: invalid JSON imports do not 5xx under concurrency", async () => {
    const iterations = getEnvInt("ATOMIC_ITERATIONS", 50);
    const bad = new TextEncoder().encode("{not json");

    const tasks = Array.from({ length: iterations }, (_, i) => async () => {
      const res = await authedFetch(accessToken, "/api/v1/import/poses/json", {
        method: "POST",
        body: formWithFile(bad, `bad-${i}.json`, "application/json"),
      });
      assertNo5xx(res.status, "storm import bad json");
      await safeJson(res);
      return res.status;
    });

    const statuses = await concurrentAll(tasks, concurrency);
    expect(statuses.length).toBe(iterations);
  });
});
