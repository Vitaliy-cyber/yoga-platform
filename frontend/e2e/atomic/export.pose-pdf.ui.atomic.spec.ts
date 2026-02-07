import { test, expect } from "@playwright/test";
import { TEST_TOKEN } from "../fixtures";
import { authedFetch, loginWithToken } from "./atomic-http";
import { assertNo5xx, gotoWithRetry } from "./atomic-helpers";
import {
  assertPdfSmoke,
  downloadToBuffer,
  expectNoClientCrash,
  installUnhandledRejectionProbe,
  watchApi5xx,
  watchPageErrors,
} from "./ui-helpers";

test.describe("Atomic export: single pose PDF (PoseDetail UI; real download; no 5xx)", () => {
  test.describe.configure({ mode: "serial" });
  test.use({ acceptDownloads: true });

  test("pose detail PDF button triggers a valid PDF download", async ({ page }) => {
    test.setTimeout(180_000);

    await installUnhandledRejectionProbe(page);
    const pageErrors = watchPageErrors(page);
    const api5xx = watchApi5xx(page);

    const { accessToken } = await loginWithToken(TEST_TOKEN);
    expect(accessToken).toBeTruthy();

    const code = `PDF${Date.now().toString(36).slice(-10)}`.slice(0, 20);
    const created = await authedFetch(accessToken, "/api/v1/poses", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ code, name: `Atomic PDF ${code}`, description: "atomic pdf export" }),
    });
    assertNo5xx(created.status, "create pose");
    expect(created.status).toBe(201);
    const createdJson = (await created.json()) as { id: number };
    const poseId = createdJson.id;

    try {
      await gotoWithRetry(page, `/poses/${poseId}`, { timeoutMs: 60_000 });
      await expect(page.getByTestId("pose-export-pdf")).toBeVisible({ timeout: 60_000 });

      const dl = await downloadToBuffer(
        page,
        async () => {
          await page.getByTestId("pose-export-pdf").click();
        },
        120_000,
      );
      assertPdfSmoke(dl.buffer);

      await expectNoClientCrash({ page, pageErrors, api5xx, label: "pose pdf export" });
    } finally {
      await authedFetch(accessToken, `/api/v1/poses/${poseId}`, { method: "DELETE" }).catch(
        () => undefined,
      );
    }
  });
});

