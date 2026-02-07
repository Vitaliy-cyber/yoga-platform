import { test, expect } from "@playwright/test";

const tinyPng = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR4nGNgYAAAAAMAASsJTYQAAAAASUVORK5CYII=",
  "base64",
);

test.describe("Upload (core)", () => {
  test("creates a new pose with uploaded schema", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 720 });

    const name = `E2E Upload ${Date.now()}`;

    await page.goto("/upload");
    await expect(page.getByTestId("upload-pose-name")).toBeVisible();
    await page.getByTestId("upload-pose-name").fill(name);

    await page.getByTestId("upload-file-input").setInputFiles({
      name: "schema.png",
      mimeType: "image/png",
      buffer: tinyPng,
    });

    await page.getByTestId("upload-submit").click();

    await expect(page).toHaveURL(/\/poses\/\d+/, { timeout: 15000 });
    await expect(
      page.getByRole("heading", { name, exact: true }),
    ).toBeVisible();
    await expect(page.getByTestId("pose-schema-image")).toBeVisible();
  });
});
