import { test, expect } from "@playwright/test";
import { TEST_TOKEN } from "../fixtures";
import { getCorePoseIdA } from "../test-data";
import { authedFetch, loginWithToken } from "./atomic-http";
import { assertNo5xx, concurrentAll } from "./atomic-helpers";

test.describe("Atomic export PDF concurrency (break-it; never 5xx)", () => {
  test.describe.configure({ mode: "serial" });

  let accessToken = "";

  test.beforeAll(async () => {
    accessToken = (await loginWithToken(TEST_TOKEN)).accessToken;
    expect(accessToken).toBeTruthy();
  });

  async function fetchPdf(path: string): Promise<number> {
    const res = await authedFetch(accessToken, path, {
      method: "GET",
      headers: { Accept: "application/pdf" },
    });
    assertNo5xx(res.status, "export/pdf");
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type") || "").toContain("application/pdf");
    const buf = await res.arrayBuffer();
    return buf.byteLength;
  }

  test("concurrent single-pose pdf export returns valid PDFs", async () => {
    const poseId = getCorePoseIdA();
    test.skip(!poseId, "Core seed pose not available");

    const tasks = Array.from({ length: 8 }, (_, i) => async () => {
      const size = await fetchPdf(
        `/api/v1/export/pose/${poseId as number}/pdf?include_photo=false&include_muscle_layer=false&include_schema=true&include_description=false&include_muscles_list=true&page_size=A4&i=${i}`,
      );
      expect(size).toBeGreaterThan(500);
      return size;
    });

    const sizes = await concurrentAll(tasks, 4);
    expect(sizes.length).toBe(8);
  });

  test("concurrent multi-pose pdf export never 5xx", async () => {
    const tasks = Array.from({ length: 3 }, (_, i) => async () => {
      const size = await fetchPdf(`/api/v1/export/poses/pdf?page_size=A4&i=${i}`);
      expect(size).toBeGreaterThan(500);
      return size;
    });

    const sizes = await concurrentAll(tasks, 3);
    expect(sizes.length).toBe(3);
  });
});

