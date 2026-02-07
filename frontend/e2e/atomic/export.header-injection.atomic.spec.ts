import { test, expect } from "@playwright/test";
import { assertNo5xx } from "./atomic-helpers";
import { authedFetch, loginWithToken } from "./atomic-http";

const USER1_TOKEN =
  process.env.E2E_TEST_TOKEN || "e2e-test-token-playwright-2024";

async function createPose(accessToken: string, code: string, name: string): Promise<number> {
  const res = await authedFetch(accessToken, "/api/v1/poses", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ code, name }),
  });
  assertNo5xx(res.status, "create pose");
  expect(res.status).toBe(201);
  const json = (await res.json()) as { id: number };
  return json.id;
}

async function deletePose(accessToken: string, id: number): Promise<void> {
  await authedFetch(accessToken, `/api/v1/poses/${id}`, { method: "DELETE" }).catch(
    () => undefined,
  );
}

test.describe("Atomic export header injection hardening (break-it; no 5xx)", () => {
  test.describe.configure({ mode: "serial" });

  test("Content-Disposition filename is CRLF-safe even if pose fields contain CR/LF", async () => {
    const { accessToken } = await loginWithToken(USER1_TOKEN);

    const code = `HDR_${Date.now().toString(36).slice(-10)}`.slice(0, 20);
    const nastyName = `pose\"\r\nX-Evil: 1\r\n\r\n`;
    const poseId = await createPose(accessToken, code, nastyName);

    try {
      const res = await authedFetch(
        accessToken,
        `/api/v1/export/pose/${poseId}/pdf?page_size=A4`,
        { headers: { Accept: "application/pdf" } },
      );
      assertNo5xx(res.status, "export pose pdf");
      expect(res.status).toBe(200);

      const cd = res.headers.get("content-disposition") || "";
      // Must not be able to inject new headers / response splitting.
      expect(cd).not.toMatch(/[\r\n]/);
      expect(cd.toLowerCase()).toContain("attachment");
      expect(cd.toLowerCase()).toContain("filename=");
    } finally {
      await deletePose(accessToken, poseId);
    }
  });
});

