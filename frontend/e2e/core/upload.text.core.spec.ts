import { test, expect } from "@playwright/test";

const API_BASE_URL = process.env.PLAYWRIGHT_API_URL || "http://127.0.0.1:8000";

test.describe("Upload text (core)", () => {
  test("creates a new pose from text prompt (AI from-text) and redirects to detail", async ({
    page,
  }) => {
    const health = await page.request.get(`${API_BASE_URL}/health`);
    const healthJson = (await health.json().catch(() => null)) as { ai_enabled?: boolean } | null;
    test.skip(!healthJson?.ai_enabled, "AI generation not enabled on backend (/health ai_enabled=false)");

    test.setTimeout(150_000);
    await page.setViewportSize({ width: 1280, height: 720 });

    const name = `E2E Upload Text ${Date.now()}`;

    await page.goto("/upload");
    await page.getByTestId("upload-pose-name").fill(name);

    const tablist = page.getByRole("tablist").first();
    await tablist.getByRole("tab").nth(1).click();

    await page
      .getByTestId("upload-text-description")
      .fill("Generate a yoga pose photo and muscles from text: warrior pose");

    await expect(page.getByTestId("upload-submit")).toBeEnabled();
    await page.getByTestId("upload-submit").click();

    await expect(page).toHaveURL(/\/poses\/\d+/, { timeout: 120_000 });
    await expect(page.getByRole("heading", { name, exact: true })).toBeVisible();
    await expect(page.getByTestId("pose-regenerate")).toBeVisible({ timeout: 60_000 });
  });
});

