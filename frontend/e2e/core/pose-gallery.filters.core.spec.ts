import { test, expect } from "@playwright/test";
import {
  getCoreCategoryId,
  getCorePoseIdA,
  getCorePoseIdB,
  getCreatedPoseId,
  getCategoryById,
} from "../test-data";

async function selectRadixSelectOption(
  page: import("@playwright/test").Page,
  triggerTestId: string,
  option: string | RegExp,
) {
  await page.getByTestId(triggerTestId).click();
  await page.getByRole("option", { name: option }).click();
}

test.describe("Pose gallery filters (core)", () => {
  test("default filter shows core pose A", async ({ page }) => {
    const poseAId = getCorePoseIdA();
    test.skip(!poseAId, "Core seed pose not available");

    await page.goto("/poses");
    await expect(page.getByTestId(`pose-card-${poseAId}`)).toBeVisible();
  });

  test("status=draft hides a complete core pose", async ({ page }) => {
    const poseAId = getCorePoseIdA();
    test.skip(!poseAId, "Core seed pose not available");

    await page.goto("/poses");
    await selectRadixSelectOption(
      page,
      "pose-status-select",
      /^(Draft|Чернетка)$/i,
    );
    await expect(page.getByTestId(`pose-card-${poseAId}`)).toHaveCount(0);
  });

  test("status=complete hides signed/schema-only pose", async ({ page }) => {
    const signedPoseId = getCreatedPoseId();
    test.skip(!signedPoseId, "Signed test pose not available");

    await page.goto("/poses");
    await selectRadixSelectOption(
      page,
      "pose-status-select",
      /^(Complete|Завершено)$/i,
    );
    await expect(page.getByTestId(`pose-card-${signedPoseId}`)).toHaveCount(0);
  });

  test("category=core hides signed pose", async ({ page }) => {
    const coreCategoryId = getCoreCategoryId();
    const coreCategory = coreCategoryId
      ? getCategoryById(coreCategoryId)
      : undefined;
    const signedPoseId = getCreatedPoseId();
    test.skip(
      !coreCategoryId || !coreCategory || !signedPoseId,
      "Seed category/pose not available",
    );

    await page.goto("/poses");
    await selectRadixSelectOption(
      page,
      "pose-category-select",
      coreCategory.name,
    );
    await expect(page.getByTestId(`pose-card-${signedPoseId}`)).toHaveCount(0);
  });

  test("category=core shows both core poses", async ({ page }) => {
    const coreCategoryId = getCoreCategoryId();
    const coreCategory = coreCategoryId
      ? getCategoryById(coreCategoryId)
      : undefined;
    const poseAId = getCorePoseIdA();
    const poseBId = getCorePoseIdB();
    test.skip(
      !coreCategoryId || !coreCategory || !poseAId || !poseBId,
      "Core seed data not available",
    );

    await page.goto("/poses");
    await selectRadixSelectOption(
      page,
      "pose-category-select",
      coreCategory.name,
    );
    await expect(page.getByTestId(`pose-card-${poseAId}`)).toBeVisible();
    await expect(page.getByTestId(`pose-card-${poseBId}`)).toBeVisible();
  });

  test("category param in URL is respected", async ({ page }) => {
    const coreCategoryId = getCoreCategoryId();
    const poseAId = getCorePoseIdA();
    test.skip(!coreCategoryId || !poseAId, "Core seed data not available");

    await page.goto(`/poses?category=${coreCategoryId}`);
    await expect(page.getByTestId(`pose-card-${poseAId}`)).toBeVisible();
  });

  test("clearing category filter clears URL param", async ({ page }) => {
    const coreCategoryId = getCoreCategoryId();
    const coreCategory = coreCategoryId
      ? getCategoryById(coreCategoryId)
      : undefined;
    test.skip(
      !coreCategoryId || !coreCategory,
      "Core seed category not available",
    );

    await page.goto("/poses");
    await selectRadixSelectOption(
      page,
      "pose-category-select",
      coreCategory.name,
    );
    await expect(page).toHaveURL(`/poses?category=${coreCategoryId}`);

    await selectRadixSelectOption(
      page,
      "pose-category-select",
      /^(All Categories|Усі категорії)$/i,
    );
    await expect(page).toHaveURL("/poses");
  });

  test("search + draft shows signed pose", async ({ page }) => {
    const signedPoseId = getCreatedPoseId();
    test.skip(!signedPoseId, "Signed test pose not available");

    await page.goto("/poses");
    await selectRadixSelectOption(
      page,
      "pose-status-select",
      /^(Draft|Чернетка)$/i,
    );
    await page.getByTestId("pose-search-input").fill("Signed Image");
    await expect(page.getByTestId(`pose-card-${signedPoseId}`)).toBeVisible();
  });

  test("search + complete shows core pose A", async ({ page }) => {
    const poseAId = getCorePoseIdA();
    test.skip(!poseAId, "Core seed pose not available");

    await page.goto("/poses");
    await selectRadixSelectOption(
      page,
      "pose-status-select",
      /^(Complete|Завершено)$/i,
    );
    await page.getByTestId("pose-search-input").fill("Core Pose A");
    await expect(page.getByTestId(`pose-card-${poseAId}`)).toBeVisible();
  });
});
