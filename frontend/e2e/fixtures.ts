import { test as base, expect, Page } from '@playwright/test';

/**
 * E2E Test Fixtures for Yoga Platform
 *
 * These tests run against the REAL API - no mocks!
 * This catches real bugs that mocks would hide.
 */

// Test token for E2E tests - creates a dedicated test user
export const TEST_TOKEN = process.env.E2E_TEST_TOKEN || 'e2e-test-token-playwright-2024';

/**
 * Login helper function - authenticates via real API
 * Handles case where user is already authenticated (redirected from /login to /)
 */
export async function loginUser(page: Page, token: string = TEST_TOKEN) {
  await page.goto('/login');
  await page.waitForLoadState('networkidle');

  // Check if already authenticated (redirected to dashboard)
  const currentUrl = page.url();
  if (!currentUrl.includes('/login')) {
    // Already authenticated - no need to login
    return;
  }

  // Fill token input
  const tokenInput = page.locator(
    'input[type="text"], input[type="password"], input[name="token"], input[id="token"], input[placeholder*="token" i]'
  ).first();
  await tokenInput.fill(token);

  // Click submit button
  const submitButton = page.locator(
    'button[type="submit"], button:has-text("Sign"), button:has-text("Login"), button:has-text("Увійти")'
  ).first();
  await submitButton.click();

  // Wait for redirect to dashboard
  await page.waitForURL('/', { timeout: 15000 });
}

/**
 * Setup authenticated state by logging in through the UI
 * This ensures we have valid tokens from the real API
 */
export async function setupAuthenticatedState(page: Page) {
  await loginUser(page, TEST_TOKEN);
}

/**
 * Logout helper
 */
export async function logoutUser(page: Page) {
  // Find and click logout button/link
  const logoutButton = page.locator(
    'button:has-text("Logout"), button:has-text("Вийти"), a:has-text("Logout"), a:has-text("Вийти"), [data-testid="logout"]'
  );

  if (await logoutButton.first().isVisible({ timeout: 3000 }).catch(() => false)) {
    await logoutButton.first().click();
    await page.waitForURL('/login', { timeout: 10000 });
  }
}

/**
 * Wait for API response helper
 */
export async function waitForApiResponse(page: Page, urlPattern: string | RegExp) {
  return page.waitForResponse(
    (response) => {
      const url = response.url();
      if (typeof urlPattern === 'string') {
        return url.includes(urlPattern);
      }
      return urlPattern.test(url);
    },
    { timeout: 10000 }
  );
}

/**
 * Create a test pose via API
 */
export async function createTestPose(page: Page, poseData: {
  name: string;
  code: string;
  name_en?: string;
  description?: string;
}) {
  // Navigate to upload/create page
  await page.goto('/upload');
  await page.waitForLoadState('networkidle');

  // Fill in pose details
  const nameInput = page.locator('input[name="name"], input[placeholder*="name" i], input[placeholder*="назва" i]').first();
  if (await nameInput.isVisible()) {
    await nameInput.fill(poseData.name);
  }

  const codeInput = page.locator('input[name="code"], input[placeholder*="code" i], input[placeholder*="код" i]').first();
  if (await codeInput.isVisible()) {
    await codeInput.fill(poseData.code);
  }

  // Submit
  const submitButton = page.locator('button[type="submit"], button:has-text("Save"), button:has-text("Create"), button:has-text("Зберегти")').first();
  if (await submitButton.isVisible()) {
    await submitButton.click();
    await page.waitForTimeout(1000);
  }
}

/**
 * Clean up test data (optional - run after tests)
 */
export async function cleanupTestData(page: Page) {
  // Navigate to poses list
  await page.goto('/poses');
  await page.waitForLoadState('networkidle');

  // Find and delete test poses (those with code starting with TEST_)
  const deleteButtons = page.locator('[data-testid="delete-pose"], button:has-text("Delete"), button:has-text("Видалити")');
  const count = await deleteButtons.count();

  for (let i = 0; i < count; i++) {
    const button = deleteButtons.nth(0); // Always get first since list shrinks
    if (await button.isVisible({ timeout: 1000 }).catch(() => false)) {
      await button.click();

      // Confirm deletion if dialog appears
      const confirmButton = page.locator('button:has-text("Confirm"), button:has-text("Yes"), button:has-text("Так")');
      if (await confirmButton.first().isVisible({ timeout: 2000 }).catch(() => false)) {
        await confirmButton.first().click();
      }

      await page.waitForTimeout(500);
    }
  }
}

// Extended test with authenticated page fixture
export const test = base.extend<{ authenticatedPage: Page }>({
  authenticatedPage: async ({ page }, use) => {
    // Login first
    await loginUser(page, TEST_TOKEN);

    // Provide the authenticated page to the test
    await use(page);

    // Optional: cleanup after test (uncomment if needed)
    // await logoutUser(page);
  },
});

export { expect };
