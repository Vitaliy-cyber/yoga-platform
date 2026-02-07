import { test, expect } from "@playwright/test";
import { getCorePoseIdA } from "../test-data";

test.describe("Atomic regenerate modal: missing task_id hardening", () => {
  test.describe.configure({ mode: "serial" });

  test("does not open WebSocket when task_id is missing (surfaces error and allows retry)", async ({
    page,
  }) => {
    const poseId = getCorePoseIdA();
    test.skip(!poseId, "Core seed pose not available");

    await page.route(`**/api/v1/generate/from-pose/${poseId as number}`, async (route) => {
      await route.fulfill({
        status: 200,
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          status: "pending",
          progress: 0,
          status_message: "Atomic: missing task_id",
        }),
      });
    });

    // If the client tries to connect, this test should fail.
    await page.routeWebSocket("**/ws/generate/**", async (ws) => {
      throw new Error(`Atomic: WebSocket should not be opened (url=${ws.url()})`);
    });

    await page.goto(`/poses/${poseId as number}`);
    await page.getByTestId("pose-regenerate").click();
    await expect(page.getByTestId("pose-regenerate-start")).toBeVisible();

    await page.getByTestId("pose-regenerate-feedback").fill("atomic: missing task id");
    await page.getByTestId("pose-regenerate-start").click();

    const dialog = page.getByRole("dialog");
    await expect(dialog.locator("div.bg-red-50")).toBeVisible();
    await expect(page.getByTestId("pose-regenerate-start")).toBeVisible();
    await expect(page.getByTestId("pose-regenerate-start")).toBeEnabled();
  });
});

