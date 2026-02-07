import { test, expect } from "@playwright/test";

const navCases: Array<{
  name: string;
  navTestId: string;
  url: string;
  expectTestId?: string;
}> = [
  {
    name: "dashboard",
    navTestId: "nav-dashboard",
    url: "/",
    expectTestId: "nav-dashboard",
  },
  {
    name: "poses",
    navTestId: "nav-poses",
    url: "/poses",
    expectTestId: "pose-gallery-count",
  },
  {
    name: "sequences",
    navTestId: "nav-sequences",
    url: "/sequences",
    expectTestId: "sequence-new",
  },
  {
    name: "upload",
    navTestId: "nav-upload",
    url: "/upload",
    expectTestId: "upload-pose-name",
  },
  { name: "analytics", navTestId: "nav-analytics", url: "/analytics" },
];

test.describe("Navigation (core)", () => {
  for (const c of navCases) {
    test(`sidebar: opens ${c.name}`, async ({ page }) => {
      await page.setViewportSize({ width: 1280, height: 720 });
      await page.goto("/", { waitUntil: "domcontentloaded" });
      // On cold starts Vite can respond before React mounts; wait for the shell.
      await expect(page.getByTestId("nav-dashboard")).toBeVisible({
        timeout: 60_000,
      });
      await page.getByTestId(c.navTestId).click({ timeout: 60_000 });
      await expect(page).toHaveURL(c.url);
      if (c.expectTestId) {
        await expect(page.getByTestId(c.expectTestId)).toBeVisible();
      }
    });
  }

  test("direct route: /generate renders", async ({ page }) => {
    await page.goto("/generate");
    // File input is intentionally hidden; we only require it to exist.
    await expect(page.getByTestId("generate-file-input")).toBeAttached();
  });

  test("direct route: /settings renders", async ({ page }) => {
    await page.goto("/settings");
    await expect(page.getByTestId("settings-locale-en")).toBeVisible();
    await expect(page.getByTestId("settings-locale-ua")).toBeVisible();
  });

  test("user menu: can open and close", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 720 });
    await page.goto("/");

    await page.getByTestId("user-menu-toggle").click();
    await expect(page.getByTestId("logout-button")).toBeVisible();

    // Close deterministically (toggle).
    await page.getByTestId("user-menu-toggle").click();
    await expect(page.getByTestId("logout-button")).toHaveCount(0);
  });
});
