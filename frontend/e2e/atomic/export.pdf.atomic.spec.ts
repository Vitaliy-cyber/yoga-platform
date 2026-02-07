import { test, expect } from "@playwright/test";
import { assertNo5xx, concurrentAll, getEnvInt } from "./atomic-helpers";
import { authedFetch, loginWithToken } from "./atomic-http";

const USER1_TOKEN =
  process.env.E2E_TEST_TOKEN || "e2e-test-token-playwright-2024";

function assertSafeContentDisposition(header: string): void {
  expect(header).toContain("attachment");
  expect(header).not.toContain("\n");
  expect(header).not.toContain("\r");
}

async function getSeedPoseId(accessToken: string, code: string): Promise<number | undefined> {
  const res = await authedFetch(accessToken, `/api/v1/poses/code/${encodeURIComponent(code)}`);
  assertNo5xx(res.status, `pose by code ${code}`);
  if (res.status !== 200) return undefined;
  const json = (await res.json()) as { id?: number };
  return typeof json.id === "number" ? json.id : undefined;
}

test.describe("Atomic export PDF (no 5xx)", () => {
  test.describe.configure({ mode: "serial" });

  const concurrency = getEnvInt("ATOMIC_CONCURRENCY", 8);
  const attempts = getEnvInt("ATOMIC_PDF_ATTEMPTS", 8);
  let accessToken = "";
  let poseId: number | undefined;

  test.beforeAll(async () => {
    accessToken = (await loginWithToken(USER1_TOKEN)).accessToken;
    poseId = await getSeedPoseId(accessToken, "E2E_CORE_A");
  });

  test("export single pose PDF returns application/pdf and attachment headers", async () => {
    test.skip(!poseId, "Seed pose not available");

    const res = await authedFetch(accessToken, `/api/v1/export/pose/${poseId}/pdf`);
    assertNo5xx(res.status, "export pose pdf");
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type") || "").toContain("application/pdf");
    assertSafeContentDisposition(res.headers.get("content-disposition") || "");

    const bytes = new Uint8Array(await res.arrayBuffer());
    expect(bytes.length).toBeGreaterThan(1024);
    const prefix = String.fromCharCode(...bytes.slice(0, 5));
    expect(prefix).toBe("%PDF-");
  });

  test("export all poses PDF returns application/pdf and attachment headers (or 404) but never 5xx", async () => {
    const res = await authedFetch(accessToken, "/api/v1/export/poses/pdf");
    assertNo5xx(res.status, "export poses pdf");
    expect([200, 404].includes(res.status)).toBeTruthy();

    if (res.status === 200) {
      expect(res.headers.get("content-type") || "").toContain("application/pdf");
      assertSafeContentDisposition(res.headers.get("content-disposition") || "");
      const bytes = new Uint8Array(await res.arrayBuffer());
      expect(bytes.length).toBeGreaterThan(1024);
      const prefix = String.fromCharCode(...bytes.slice(0, 5));
      expect(prefix).toBe("%PDF-");
    }
  });

  test("invalid page_size never 5xx (422 expected)", async () => {
    test.skip(!poseId, "Seed pose not available");

    const res = await authedFetch(
      accessToken,
      `/api/v1/export/pose/${poseId}/pdf?page_size=NotARealSize`,
      { headers: { Accept: "application/json" } },
    );
    assertNo5xx(res.status, "export pose pdf invalid page_size");
    expect([200, 422].includes(res.status)).toBeTruthy();
  });

  test("storm: pdf export under concurrency never 5xx", async () => {
    test.skip(!poseId, "Seed pose not available");

    const tasks = Array.from({ length: attempts }, (_v, i) => async () => {
      const includePhoto = i % 2 === 0;
      const includeSchema = i % 3 !== 0;
      const includeMuscleLayer = i % 4 !== 0;
      const pageSize = i % 2 === 0 ? "A4" : "Letter";

      const res = await authedFetch(
        accessToken,
        `/api/v1/export/pose/${poseId}/pdf?include_photo=${includePhoto}&include_schema=${includeSchema}&include_muscle_layer=${includeMuscleLayer}&page_size=${pageSize}&i=${i}`,
        { headers: { Accept: "application/pdf" } },
      );

      assertNo5xx(res.status, `export pose pdf#${i}`);
      if (res.status === 200) {
        const bytes = new Uint8Array(await res.arrayBuffer());
        expect(bytes.length).toBeGreaterThan(512);
      }
      return res.status;
    });

    const statuses = await concurrentAll(tasks, Math.min(concurrency, 6));
    expect(statuses.length).toBe(attempts);
    expect(statuses.every((s) => s < 500)).toBeTruthy();
  });
});

