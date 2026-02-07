import { test, expect } from "@playwright/test";
import { getCoreCategoryId, getCategoryById } from "../test-data";

const tinyPng = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR4nGNgYAAAAAMAASsJTYQAAAAASUVORK5CYII=",
  "base64",
);

async function selectRadixSelectOption(
  page: import("@playwright/test").Page,
  triggerTestId: string,
  option: string | RegExp,
) {
  await page.getByTestId(triggerTestId).click();
  await page.getByRole("option", { name: option }).click();
}

test.describe("Upload validation (core)", () => {
  test("submit is disabled initially", async ({ page }) => {
    await page.goto("/upload");
    await expect(page.getByTestId("upload-submit")).toBeDisabled();
  });

  test("name without file keeps submit disabled (schematic mode)", async ({
    page,
  }) => {
    await page.goto("/upload");
    await page.getByTestId("upload-pose-name").fill("E2E Upload Validation");
    await expect(page.getByTestId("upload-submit")).toBeDisabled();
  });

  test("file without name keeps submit disabled", async ({ page }) => {
    await page.goto("/upload");
    await page.getByTestId("upload-file-input").setInputFiles({
      name: "schema.png",
      mimeType: "image/png",
      buffer: tinyPng,
    });
    await expect(page.getByTestId("upload-submit")).toBeDisabled();
  });

  test("name + file enables submit", async ({ page }) => {
    await page.goto("/upload");
    await page.getByTestId("upload-pose-name").fill("E2E Upload Validation");
    await page.getByTestId("upload-file-input").setInputFiles({
      name: "schema.png",
      mimeType: "image/png",
      buffer: tinyPng,
    });
    await expect(page.getByTestId("upload-submit")).toBeEnabled();
  });

  test("can pick a category by value", async ({ page }) => {
    const coreCategoryId = getCoreCategoryId();
    const coreCategory = coreCategoryId
      ? getCategoryById(coreCategoryId)
      : undefined;
    test.skip(!coreCategoryId || !coreCategory, "Core category not available");

    await page.goto("/upload");
    await selectRadixSelectOption(
      page,
      "upload-category-select",
      coreCategory.name,
    );
    await expect(page.getByTestId("upload-category-select")).toBeVisible();
  });

  test("text mode allows submit without file", async ({ page }) => {
    await page.goto("/upload");
    await page.getByTestId("upload-pose-name").fill("E2E Upload Text Mode");

    const tablist = page.getByRole("tablist").first();
    await tablist.getByRole("tab").nth(1).click();

    await page.getByTestId("upload-text-description").fill("Generate from text: test prompt");
    await expect(page.getByTestId("upload-submit")).toBeEnabled();
  });

  test("switching back to schematic requires a file", async ({ page }) => {
    await page.goto("/upload");
    await page.getByTestId("upload-pose-name").fill("E2E Upload Switch Tabs");

    const tablist = page.getByRole("tablist").first();
    await tablist.getByRole("tab").nth(1).click();
    await page.getByTestId("upload-text-description").fill("Generate from text: test prompt");
    await expect(page.getByTestId("upload-submit")).toBeEnabled();

    await tablist.getByRole("tab").nth(0).click();
    await expect(page.getByTestId("upload-submit")).toBeDisabled();
  });
});
