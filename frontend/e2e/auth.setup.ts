import { test as setup } from '@playwright/test';
import { TEST_TOKEN } from './fixtures';

const authFile = 'playwright/.auth/user.json';

/**
 * Setup authentication state that will be reused across tests.
 * This runs once before all tests that depend on it.
 *
 * Uses REAL API - no mocks!
 */
setup('authenticate', async ({ page }) => {
  // Navigate to login page
  await page.goto('/login');
  await page.waitForLoadState('networkidle');

  // Fill in the token - this will create a test user if it doesn't exist
  const tokenInput = page.locator(
    'input[type="text"], input[type="password"], input[name="token"], input[id="token"]'
  ).first();
  await tokenInput.fill(TEST_TOKEN);

  // Submit login form
  const submitButton = page.locator(
    'button[type="submit"], button:has-text("Sign"), button:has-text("Login"), button:has-text("Увійти")'
  ).first();
  await submitButton.click();

  // Wait for successful redirect to dashboard
  await page.waitForURL('/', { timeout: 15000 });

  // Wait a bit for the app to stabilize
  await page.waitForLoadState('networkidle');

  // Save authentication state (cookies + localStorage) to file
  // This will be reused by other tests
  await page.context().storageState({ path: authFile });
});
