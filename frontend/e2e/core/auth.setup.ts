import { test as setup, expect } from "@playwright/test";
import { TEST_TOKEN } from "../fixtures";
import fs from "fs";
import path from "path";

const authFile = "playwright/.auth/user.json";

setup("authenticate", async ({ page }) => {
  fs.mkdirSync(path.dirname(authFile), { recursive: true });

  await page.goto("/login", { waitUntil: "domcontentloaded" });
  // Vite dev server can respond before React mounts on cold start.
  await expect(page.locator("#token")).toBeVisible({ timeout: 60_000 });

  await page.locator("#token").fill(TEST_TOKEN);
  await page.locator('button[type="submit"]').click();

  await expect(page).toHaveURL("/", { timeout: 30_000 });
  await page.waitForLoadState("domcontentloaded");

  await page.context().storageState({ path: authFile });
});
