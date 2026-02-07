import { test, expect } from "@playwright/test";
import { getCorePoseIdA, getCorePoseIdB } from "../test-data";

test.describe("Compare page (core)", () => {
  test("renders with two core poses", async ({ page }) => {
    const a = getCorePoseIdA();
    const b = getCorePoseIdB();
    test.skip(!a || !b, "Core seed poses not available");

    await page.goto(`/compare?poses=${a},${b}`);
    await expect(page.getByTestId("compare-clear-all")).toBeVisible({
      timeout: 30_000,
    });
    await expect(page.getByTestId(`compare-pose-card-${a}`)).toBeVisible();
    await expect(page.getByTestId(`compare-pose-card-${b}`)).toBeVisible();
  });

  test("tabs are clickable and slider tab shows image slider", async ({
    page,
  }) => {
    const a = getCorePoseIdA();
    const b = getCorePoseIdB();
    test.skip(!a || !b, "Core seed poses not available");

    await page.goto(`/compare?poses=${a},${b}`);
    await expect(page.getByTestId("compare-tabs")).toBeVisible();

    await page.getByTestId("compare-tab-overlap").click();
    await page.getByTestId("compare-tab-muscles").click();

    await page.getByTestId("compare-tab-slider").click();
    await expect(page.getByTestId("compare-image-slider")).toBeVisible();
  });

  test("per-pose layer toggle buttons exist", async ({ page }) => {
    const a = getCorePoseIdA();
    const b = getCorePoseIdB();
    test.skip(!a || !b, "Core seed poses not available");

    await page.goto(`/compare?poses=${a},${b}`);
    await expect(page.getByTestId(`compare-toggle-photo-${a}`)).toBeVisible();
    await expect(page.getByTestId(`compare-toggle-muscles-${a}`)).toBeVisible();
  });

  test("layer toggle switches without errors", async ({ page }) => {
    const a = getCorePoseIdA();
    const b = getCorePoseIdB();
    test.skip(!a || !b, "Core seed poses not available");

    await page.goto(`/compare?poses=${a},${b}`);
    await page.getByTestId(`compare-toggle-muscles-${a}`).click();
    await page.getByTestId(`compare-toggle-photo-${a}`).click();
  });

  test("slider supports keyboard controls", async ({ page }) => {
    const a = getCorePoseIdA();
    const b = getCorePoseIdB();
    test.skip(!a || !b, "Core seed poses not available");

    await page.goto(`/compare?poses=${a},${b}`);
    await page.getByTestId("compare-tab-slider").click();

    const slider = page.getByTestId("compare-image-slider");
    await slider.focus();

    const before = await slider.getAttribute("aria-valuenow");
    await page.keyboard.press("ArrowLeft");
    const after = await slider.getAttribute("aria-valuenow");

    expect(before).not.toBeNull();
    expect(after).not.toBeNull();
    expect(after).not.toEqual(before);
  });

  test("remove pose redirects to gallery when <2 poses remain", async ({
    page,
  }) => {
    const a = getCorePoseIdA();
    const b = getCorePoseIdB();
    test.skip(!a || !b, "Core seed poses not available");

    await page.goto(`/compare?poses=${a},${b}`);
    await page.getByTestId(`compare-remove-${a}`).click();
    await expect(page).toHaveURL("/poses");
  });

  test("clear all returns to gallery", async ({ page }) => {
    const a = getCorePoseIdA();
    const b = getCorePoseIdB();
    test.skip(!a || !b, "Core seed poses not available");

    await page.goto(`/compare?poses=${a},${b}`);
    await page.getByTestId("compare-clear-all").click();
    await expect(page).toHaveURL("/poses");
  });
});
