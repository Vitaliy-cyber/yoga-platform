import { test, expect } from "@playwright/test";

const tinyPng = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR4nGNgYAAAAAMAASsJTYQAAAAASUVORK5CYII=",
  "base64",
);

test.describe("Generate (core)", () => {
  test("renders generate form", async ({ page }) => {
    await page.goto("/generate");
    // File input is intentionally hidden; we only require it to exist.
    await expect(page.getByTestId("generate-file-input")).toBeAttached();
    await expect(page.getByTestId("generate-submit")).toBeVisible({
      timeout: 30_000,
    });
  });

  test("submit disabled until file is chosen (if supported)", async ({
    page,
  }) => {
    await page.goto("/generate");
    const submit = page.getByTestId("generate-submit");
    await expect(submit).toBeVisible();
    await expect(submit).toBeDisabled();
  });

  test("choosing a file enables submit", async ({ page }) => {
    await page.goto("/generate");
    await page.getByTestId("generate-file-input").setInputFiles({
      name: "schema.png",
      mimeType: "image/png",
      buffer: tinyPng,
    });
    await expect(page.getByTestId("generate-submit")).toBeEnabled();
  });

  test("reset clears results after a generation", async ({ page }) => {
    await page.goto("/generate");
    await page.getByTestId("generate-file-input").setInputFiles({
      name: "schema.png",
      mimeType: "image/png",
      buffer: tinyPng,
    });

    await page.getByTestId("generate-submit").click();
    await expect(page.getByTestId("generate-result-photo")).toBeVisible({
      timeout: 30_000,
    });

    await page.getByTestId("generate-reset").click();
    await expect(page.getByTestId("generate-result-photo")).toHaveCount(0);
    await expect(page.getByTestId("generate-submit")).toBeDisabled();
  });

  test("full generation flow produces photo + muscles results", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1280, height: 720 });
    await page.goto("/generate");

    await page.getByTestId("generate-file-input").setInputFiles({
      name: "schema.png",
      mimeType: "image/png",
      buffer: tinyPng,
    });

    await page.getByTestId("generate-submit").click();
    await expect(page.getByTestId("generate-progress")).toBeVisible();

    await expect(page.getByTestId("generate-result-photo")).toBeVisible({
      timeout: 30_000,
    });
    await expect(page.getByTestId("generate-result-muscles")).toBeVisible({
      timeout: 30_000,
    });

    await expect(page.getByTestId("generate-result-photo")).toHaveAttribute(
      "src",
      /.+/,
    );
    await expect(page.getByTestId("generate-result-muscles")).toHaveAttribute(
      "src",
      /.+/,
    );
  });

  test("viewer opens after generation", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 720 });
    await page.goto("/generate");

    await page.getByTestId("generate-file-input").setInputFiles({
      name: "schema.png",
      mimeType: "image/png",
      buffer: tinyPng,
    });
    await page.getByTestId("generate-submit").click();

    await expect(page.getByTestId("generate-result-photo")).toBeVisible({
      timeout: 30_000,
    });

    await page.getByTestId("generate-open-viewer").click();
    await expect(page.getByTestId("generate-viewer-image")).toBeVisible();

    await page.getByTestId("generate-viewer-tab-muscles").click();
    await expect(page.getByTestId("generate-viewer-image")).toBeVisible();

    await page.getByTestId("generate-viewer-tab-photo").click();
    await expect(page.getByTestId("generate-viewer-image")).toBeVisible();
  });
});
