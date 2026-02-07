import { test, expect } from "@playwright/test";
import { getCorePoseIdA, getCreatedPoseId } from "../test-data";

test.describe("Pose detail (core)", () => {
  test("core pose shows schema + active image", async ({ page }) => {
    const poseId = getCorePoseIdA();
    test.skip(!poseId, "Core seed pose not available");

    await page.goto(`/poses/${poseId}`);
    await expect(page.getByTestId("pose-schema-image")).toBeVisible();
    await expect(page.getByTestId("pose-schema-image")).toHaveAttribute(
      "src",
      /.+/,
    );

    await expect(page.getByTestId("pose-active-image")).toBeVisible();
    await expect(page.getByTestId("pose-active-image")).toHaveAttribute(
      "src",
      /.+/,
    );
  });

  test("core pose: photo/muscles tabs are present", async ({ page }) => {
    const poseId = getCorePoseIdA();
    test.skip(!poseId, "Core seed pose not available");

    await page.goto(`/poses/${poseId}`);
    await expect(page.getByTestId("pose-tab-photo")).toBeVisible();
    await expect(page.getByTestId("pose-tab-muscles")).toBeVisible();
  });

  test("core pose: switching tabs updates active image", async ({ page }) => {
    const poseId = getCorePoseIdA();
    test.skip(!poseId, "Core seed pose not available");

    await page.goto(`/poses/${poseId}`);
    await expect(page.getByTestId("pose-active-image")).toBeVisible();

    await page.getByTestId("pose-tab-muscles").click();
    await expect(page.getByTestId("pose-tab-muscles")).toHaveAttribute(
      "data-state",
      "active",
    );
    await expect(page.getByTestId("pose-active-image")).toBeVisible();

    await page.getByTestId("pose-tab-photo").click();
    await expect(page.getByTestId("pose-tab-photo")).toHaveAttribute(
      "data-state",
      "active",
    );
    await expect(page.getByTestId("pose-active-image")).toBeVisible();
  });

  test("core pose: reanalyze button is visible", async ({ page }) => {
    const poseId = getCorePoseIdA();
    test.skip(!poseId, "Core seed pose not available");

    await page.goto(`/poses/${poseId}`);
    await expect(page.getByTestId("pose-reanalyze-muscles")).toBeVisible();
  });

  test("core pose: reanalyze can be triggered", async ({ page }) => {
    const poseId = getCorePoseIdA();
    test.skip(!poseId, "Core seed pose not available");

    await page.goto(`/poses/${poseId}`);
    await page.getByTestId("pose-reanalyze-muscles").click();
    await expect(page.getByTestId("pose-reanalyze-muscles")).toBeVisible();
  });

  test("signed/schema-only pose shows schema but no active image", async ({
    page,
  }) => {
    const poseId = getCreatedPoseId();
    test.skip(!poseId, "Signed test pose not available");

    await page.goto(`/poses/${poseId}`);
    await expect(page.getByTestId("pose-schema-image")).toBeVisible();
    await expect(page.getByTestId("pose-active-image")).toHaveCount(0);
  });

  test("schema-only pose has no analyze muscles button", async ({ page }) => {
    const poseId = getCreatedPoseId();
    test.skip(!poseId, "Signed test pose not available");

    await page.goto(`/poses/${poseId}`);
    await expect(page.getByTestId("pose-analyze-muscles")).toHaveCount(0);
    await expect(page.getByTestId("pose-reanalyze-muscles")).toHaveCount(0);
  });
});
