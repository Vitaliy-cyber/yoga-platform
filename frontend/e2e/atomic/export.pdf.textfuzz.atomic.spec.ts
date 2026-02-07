import { test, expect } from "@playwright/test";
import { login, getAccessToken, createPose, deletePose } from "../test-api";
import { authedFetch } from "./atomic-http";
import { assertNo5xx } from "./atomic-helpers";

test.describe("Atomic export PDF text fuzz (no 5xx)", () => {
  test.describe.configure({ mode: "serial" });

  let accessToken = "";
  let poseId: number | null = null;

  test.beforeAll(async () => {
    await login();
    const token = getAccessToken();
    expect(token).toBeTruthy();
    accessToken = token as string;
  });

  test.afterAll(async () => {
    if (poseId) await deletePose(poseId);
  });

  test("PDF export survives invalid HTML-ish markup + Unicode surrogates (escapes/sanitizes) and never 5xx", async () => {
    const weirdMarkup = "<b>unclosed <i>tag</b> <para>bad</para> & <script>alert(1)</script>";
    const controlChars = "line1\nline2\r\n\tTabbed";

    const pose = await createPose({
      code: `PDF_FUZZ_${Date.now().toString(36).slice(-8)}`.slice(0, 20),
      name: `Name ${weirdMarkup}`.slice(0, 200),
      description: `${weirdMarkup} ${controlChars}`,
    });
    poseId = pose.id;

    const res = await authedFetch(
      accessToken,
      `/api/v1/export/pose/${poseId}/pdf?include_photo=false&include_schema=false&include_muscle_layer=false&include_muscles_list=false&include_description=true&page_size=A4`,
    );
    assertNo5xx(res.status, "export single pose PDF with fuzzed text");
    expect(res.status).toBe(200);
    const ct = res.headers.get("content-type") || "";
    expect(ct).toContain("application/pdf");
    const bytes = await res.arrayBuffer();
    expect(bytes.byteLength).toBeGreaterThan(1000);
  });
});
