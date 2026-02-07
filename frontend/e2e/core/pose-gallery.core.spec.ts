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

test.describe("Pose gallery (core)", () => {
  test("renders gallery and seeded pose cards", async ({ page }) => {
    const poseAId = getCorePoseIdA();
    test.skip(!poseAId, "Core seed pose not available");

    await page.setViewportSize({ width: 1280, height: 720 });
    await page.goto("/poses");

    await expect(page.getByTestId("pose-gallery-count")).toBeVisible();
    await expect(page.getByTestId(`pose-card-${poseAId}`)).toBeVisible();
  });

  test("view mode toggles are clickable", async ({ page }) => {
    await page.goto("/poses");
    await expect(page.getByTestId("pose-gallery-view-grid")).toBeVisible();
    await expect(page.getByTestId("pose-gallery-view-list")).toBeVisible();

    await page.getByTestId("pose-gallery-view-list").click();
    await page.getByTestId("pose-gallery-view-grid").click();
  });

  test("search filters poses deterministically", async ({ page }) => {
    const poseAId = getCorePoseIdA();
    const poseBId = getCorePoseIdB();
    test.skip(!poseAId || !poseBId, "Core seed poses not available");

    await page.goto("/poses");
    await expect(page.getByTestId("pose-gallery-count")).toBeVisible();

    await page.getByTestId("pose-search-input").fill("E2E Core Pose A");
    await expect(page.getByTestId(`pose-card-${poseAId}`)).toBeVisible();
    await expect(page.getByTestId(`pose-card-${poseBId}`)).toHaveCount(0);

    await page.getByTestId("pose-search-input").fill("");
    await expect(page.getByTestId(`pose-card-${poseBId}`)).toBeVisible();
  });

  test("category filter by value works", async ({ page }) => {
    const coreCategoryId = getCoreCategoryId();
    const coreCategory = coreCategoryId
      ? getCategoryById(coreCategoryId)
      : undefined;
    const poseAId = getCorePoseIdA();
    const poseBId = getCorePoseIdB();
    test.skip(
      !coreCategoryId || !coreCategory || !poseAId || !poseBId,
      "Core seed category/poses not available",
    );

    await page.goto("/poses");
    await selectRadixSelectOption(
      page,
      "pose-category-select",
      coreCategory.name,
    );

    await expect(page.getByTestId(`pose-card-${poseAId}`)).toBeVisible();
    await expect(page.getByTestId(`pose-card-${poseBId}`)).toBeVisible();

    // Reset to "all"
    await selectRadixSelectOption(
      page,
      "pose-category-select",
      /^(All Categories|Усі категорії)$/i,
    );
    await expect(page.getByTestId("pose-gallery-count")).toBeVisible();
  });

  test("status filter: complete includes core poses", async ({ page }) => {
    const poseAId = getCorePoseIdA();
    test.skip(!poseAId, "Core seed pose not available");

    await page.goto("/poses");
    await selectRadixSelectOption(
      page,
      "pose-status-select",
      /^(Complete|Завершено)$/i,
    );
    await expect(page.getByTestId(`pose-card-${poseAId}`)).toBeVisible();
  });

  test("status filter: draft includes signed pose (schema only)", async ({
    page,
  }) => {
    const signedPoseId = getCreatedPoseId();
    test.skip(!signedPoseId, "Signed test pose not available");

    await page.goto("/poses");
    await selectRadixSelectOption(
      page,
      "pose-status-select",
      /^(Draft|Чернетка)$/i,
    );
    await expect(page.getByTestId(`pose-card-${signedPoseId}`)).toBeVisible();
  });

  test("compare: selecting two poses shows compare bar", async ({ page }) => {
    const poseAId = getCorePoseIdA();
    const poseBId = getCorePoseIdB();
    test.skip(!poseAId || !poseBId, "Core seed poses not available");

    await page.goto("/poses");
    await page.getByTestId(`pose-card-${poseAId}`).hover();
    await page.getByTestId(`pose-compare-toggle-${poseAId}`).click();

    await expect(page.getByTestId("compare-bar")).toBeVisible();
    await expect(page.getByTestId(`compare-bar-pose-${poseAId}`)).toBeVisible();

    await page.getByTestId(`pose-card-${poseBId}`).hover();
    await page.getByTestId(`pose-compare-toggle-${poseBId}`).click();

    await expect(page.getByTestId(`compare-bar-pose-${poseBId}`)).toBeVisible();
    await expect(page.getByTestId("compare-bar-compare")).toBeEnabled();
  });

  test("compare: remove pose from bar works", async ({ page }) => {
    const poseAId = getCorePoseIdA();
    const poseBId = getCorePoseIdB();
    test.skip(!poseAId || !poseBId, "Core seed poses not available");

    await page.goto("/poses");
    await page.getByTestId(`pose-card-${poseAId}`).hover();
    await page.getByTestId(`pose-compare-toggle-${poseAId}`).click();
    await page.getByTestId(`pose-card-${poseBId}`).hover();
    await page.getByTestId(`pose-compare-toggle-${poseBId}`).click();

    await expect(page.getByTestId("compare-bar")).toBeVisible();
    await page.getByTestId(`compare-bar-remove-${poseBId}`).click();
    await expect(page.getByTestId(`compare-bar-pose-${poseBId}`)).toHaveCount(
      0,
    );
    await expect(page.getByTestId(`compare-bar-pose-${poseAId}`)).toBeVisible();
  });

  test("compare: clear all hides compare bar", async ({ page }) => {
    const poseAId = getCorePoseIdA();
    test.skip(!poseAId, "Core seed pose not available");

    await page.goto("/poses");
    await page.getByTestId(`pose-card-${poseAId}`).hover();
    await page.getByTestId(`pose-compare-toggle-${poseAId}`).click();

    await expect(page.getByTestId("compare-bar")).toBeVisible();
    await page.getByTestId("compare-bar-clear").click();
    await expect(page.getByTestId("compare-bar")).toHaveCount(0);
  });

  test("compare: navigating from bar opens compare page", async ({ page }) => {
    const poseAId = getCorePoseIdA();
    const poseBId = getCorePoseIdB();
    test.skip(!poseAId || !poseBId, "Core seed poses not available");

    await page.goto("/poses");
    await page.getByTestId(`pose-card-${poseAId}`).hover();
    await page.getByTestId(`pose-compare-toggle-${poseAId}`).click();
    await page.getByTestId(`pose-card-${poseBId}`).hover();
    await page.getByTestId(`pose-compare-toggle-${poseBId}`).click();

    await page.getByTestId("compare-bar-compare").click();
    await expect(page).toHaveURL(
      new RegExp(`/compare\\?poses=${poseAId}(?:,|%2C)${poseBId}`),
    );
    await expect(
      page.getByTestId(`compare-pose-card-${poseAId}`),
    ).toBeVisible();
    await expect(
      page.getByTestId(`compare-pose-card-${poseBId}`),
    ).toBeVisible();
  });
});
