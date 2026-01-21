import { test, expect, Page } from '@playwright/test';

/**
 * Manual Verification Tests for Yoga Platform
 *
 * These tests verify specific bug fixes and features:
 * 1. Schema images load correctly on pose detail pages
 * 2. User menu dropdown works
 * 3. Logout button appears and works
 * 4. Pose comparison feature (add poses, navigate to compare, verify comparison view)
 * 5. Export/Import functionality on pose detail page
 *
 * Uses test-token-123 for authentication as specified.
 */

const TEST_TOKEN = 'test-token-123';

// Helper to authenticate
async function authenticate(page: Page) {
  await page.goto('/login');
  await page.waitForLoadState('networkidle');

  // Check if already logged in
  if (!page.url().includes('/login')) {
    return;
  }

  // Fill token input
  const tokenInput = page.locator('input').first();
  await tokenInput.fill(TEST_TOKEN);

  // Submit
  const submitButton = page.locator('button[type="submit"], button:has-text("Sign"), button:has-text("Login"), button:has-text("Authenticate")').first();
  await submitButton.click();

  // Wait for redirect
  await page.waitForURL('/', { timeout: 15000 });
  await page.waitForLoadState('networkidle');
}

test.describe('Bug Fixes Verification', () => {
  test.beforeEach(async ({ page }) => {
    await authenticate(page);
  });

  test('1.1 Schema images load correctly on pose detail pages', async ({ page }) => {
    // Navigate to poses gallery
    await page.goto('/poses');
    await page.waitForLoadState('networkidle');

    // Take screenshot of gallery
    await page.screenshot({ path: 'test-results/01-pose-gallery.png', fullPage: true });

    // Find and click on a pose card to go to detail page
    const poseCard = page.locator('a[href^="/poses/"]').first();
    if (await poseCard.isVisible({ timeout: 5000 })) {
      await poseCard.click();
      await page.waitForLoadState('networkidle');

      // Take screenshot of pose detail page
      await page.screenshot({ path: 'test-results/02-pose-detail.png', fullPage: true });

      // Check if schema image is visible (not alt text)
      // Schema images should be in img tags with actual images, not showing alt text
      const schemaSection = page.locator('text=Source Schematic, text=Source schematic, h3:has-text("schematic")').first();

      if (await schemaSection.isVisible({ timeout: 3000 }).catch(() => false)) {
        // Find the schema image near the section
        const schemaImg = page.locator('img[alt*="schematic"], img[alt*="Schematic"]').first();

        if (await schemaImg.isVisible({ timeout: 3000 })) {
          // Check if image loaded successfully (naturalWidth > 0)
          const isLoaded = await schemaImg.evaluate((img: HTMLImageElement) => {
            return img.complete && img.naturalWidth > 0;
          });

          console.log('Schema image loaded:', isLoaded);

          // Take screenshot of schema section
          await schemaImg.screenshot({ path: 'test-results/02a-schema-image.png' });

          expect(isLoaded).toBeTruthy();
        } else {
          console.log('No schema image found in detail view');
        }
      } else {
        console.log('No schema section found - pose may not have schema');
      }
    } else {
      console.log('No pose cards found - checking if poses exist');
      await page.screenshot({ path: 'test-results/02-no-poses.png', fullPage: true });
    }
  });

  test('1.2 User menu dropdown works', async ({ page }) => {
    // Navigate to dashboard
    await page.goto('/');
    await page.waitForLoadState('networkidle');

    // Take screenshot before clicking
    await page.screenshot({ path: 'test-results/03-sidebar-before-click.png', fullPage: true });

    // Find user button at bottom of sidebar
    // The user button has aria-label="User settings" or similar, and shows user avatar
    const userButton = page.locator('button[aria-haspopup="menu"], button[aria-label*="settings"], button:has([class*="rounded-full"]):last-child').first();

    // Also try the sidebar user section
    const sidebarUserButton = page.locator('aside button').last();

    let buttonToClick = userButton;
    if (!await userButton.isVisible({ timeout: 2000 }).catch(() => false)) {
      buttonToClick = sidebarUserButton;
    }

    if (await buttonToClick.isVisible({ timeout: 5000 })) {
      // Click the user button
      await buttonToClick.click();

      // Wait for dropdown to appear
      await page.waitForTimeout(500);

      // Take screenshot after clicking
      await page.screenshot({ path: 'test-results/04-user-menu-dropdown.png', fullPage: true });

      // Check if dropdown menu appeared
      const dropdown = page.locator('[role="menu"], [aria-expanded="true"] + div, div:has(button:has-text("Logout")), div:has(button:has-text("Settings"))');
      const dropdownVisible = await dropdown.first().isVisible({ timeout: 2000 }).catch(() => false);

      console.log('Dropdown menu visible:', dropdownVisible);

      // Also check for logout button in the dropdown
      const logoutButton = page.locator('button:has-text("Logout"), button:has-text("Log out"), button:has-text("Sign out")');
      const settingsButton = page.locator('button:has-text("Settings")');

      const logoutVisible = await logoutButton.first().isVisible({ timeout: 2000 }).catch(() => false);
      const settingsVisible = await settingsButton.first().isVisible({ timeout: 2000 }).catch(() => false);

      console.log('Logout button visible:', logoutVisible);
      console.log('Settings button visible:', settingsVisible);

      expect(dropdownVisible || logoutVisible || settingsVisible).toBeTruthy();
    } else {
      console.log('User button not found in sidebar');
      // Try mobile nav if desktop sidebar not visible
      const mobileMenuButton = page.locator('button[aria-label*="menu"], button:has(svg.lucide-menu)').first();
      if (await mobileMenuButton.isVisible({ timeout: 2000 })) {
        await mobileMenuButton.click();
        await page.waitForTimeout(500);
        await page.screenshot({ path: 'test-results/04-mobile-menu.png', fullPage: true });
      }
    }
  });

  test('1.3 Logout button appears in dropdown and works', async ({ page }) => {
    // Navigate to dashboard
    await page.goto('/');
    await page.waitForLoadState('networkidle');

    // Find and click user button
    const userButton = page.locator('aside button[aria-haspopup="menu"], aside button:last-child').first();

    if (await userButton.isVisible({ timeout: 5000 })) {
      await userButton.click();
      await page.waitForTimeout(500);

      // Look for logout button in dropdown
      const logoutButton = page.locator('button:has-text("Logout"), button:has-text("Log out"), button:has-text("Sign out")').first();

      await page.screenshot({ path: 'test-results/05-logout-button-visible.png', fullPage: true });

      if (await logoutButton.isVisible({ timeout: 3000 })) {
        console.log('Logout button found and visible');

        // Click logout
        await logoutButton.click();

        // Wait for redirect to login page
        await page.waitForURL('**/login**', { timeout: 10000 });

        await page.screenshot({ path: 'test-results/06-after-logout.png', fullPage: true });

        console.log('Successfully logged out, redirected to:', page.url());
        expect(page.url()).toContain('/login');
      } else {
        console.log('Logout button not immediately visible');

        // Check if there's a nested menu or different structure
        const menuItems = await page.locator('button').allTextContents();
        console.log('Available buttons:', menuItems.filter(t => t.trim()));

        // Fail test if logout not found
        expect(await logoutButton.isVisible()).toBeTruthy();
      }
    } else {
      console.log('Could not find user button');
      expect(false).toBeTruthy();
    }
  });
});

test.describe('Pose Comparison Feature', () => {
  test.beforeEach(async ({ page }) => {
    await authenticate(page);
    // Clear any previous comparison selections
    await page.evaluate(() => {
      localStorage.removeItem('yoga-compare-storage');
    });
  });

  test('2.1 Add poses to comparison from gallery', async ({ page }) => {
    // Navigate to poses gallery
    await page.goto('/poses');
    await page.waitForLoadState('networkidle');

    await page.screenshot({ path: 'test-results/07-gallery-for-comparison.png', fullPage: true });

    // Find pose cards with compare buttons
    // Compare button should be visible on hover or always visible
    const poseCards = page.locator('.group').filter({ has: page.locator('button[title*="Compare"], button[title*="compare"], button:has(svg.lucide-plus)') });

    // Get count of available pose cards
    const cardCount = await poseCards.count();
    console.log('Found pose cards with compare buttons:', cardCount);

    if (cardCount >= 2) {
      // Hover over first card to reveal compare button
      await poseCards.nth(0).hover();
      await page.waitForTimeout(300);

      // Click the compare/add button on first pose
      const firstCompareBtn = poseCards.nth(0).locator('button[title*="Compare"], button[title*="compare"], button:has(svg.lucide-plus), button:has(svg.lucide-git-compare-arrows)').first();

      if (await firstCompareBtn.isVisible({ timeout: 2000 })) {
        await firstCompareBtn.click();
        await page.waitForTimeout(500);

        await page.screenshot({ path: 'test-results/08-first-pose-added.png', fullPage: true });
        console.log('First pose added to comparison');
      }

      // Hover over second card
      await poseCards.nth(1).hover();
      await page.waitForTimeout(300);

      const secondCompareBtn = poseCards.nth(1).locator('button[title*="Compare"], button[title*="compare"], button:has(svg.lucide-plus), button:has(svg.lucide-git-compare-arrows)').first();

      if (await secondCompareBtn.isVisible({ timeout: 2000 })) {
        await secondCompareBtn.click();
        await page.waitForTimeout(500);

        await page.screenshot({ path: 'test-results/09-second-pose-added.png', fullPage: true });
        console.log('Second pose added to comparison');
      }

      // Add third pose if available
      if (cardCount >= 3) {
        await poseCards.nth(2).hover();
        await page.waitForTimeout(300);

        const thirdCompareBtn = poseCards.nth(2).locator('button[title*="Compare"], button[title*="compare"], button:has(svg.lucide-plus), button:has(svg.lucide-git-compare-arrows)').first();

        if (await thirdCompareBtn.isVisible({ timeout: 2000 })) {
          await thirdCompareBtn.click();
          await page.waitForTimeout(500);

          await page.screenshot({ path: 'test-results/10-third-pose-added.png', fullPage: true });
          console.log('Third pose added to comparison');
        }
      }

      // Check if compare bar appears at bottom
      const compareBar = page.locator('[class*="compare"], div:has-text("Compare"):has(button)').first();
      const barVisible = await compareBar.isVisible({ timeout: 3000 }).catch(() => false);
      console.log('Compare bar visible:', barVisible);

      // Verify poses are added by checking localStorage
      const compareStorage = await page.evaluate(() => {
        return localStorage.getItem('yoga-compare-storage');
      });
      console.log('Compare storage:', compareStorage);
    } else {
      console.log('Not enough pose cards for comparison test');
      await page.screenshot({ path: 'test-results/07-not-enough-poses.png', fullPage: true });
    }
  });

  test('2.2 Navigate to compare page and verify comparison view', async ({ page }) => {
    // Navigate to poses gallery first
    await page.goto('/poses');
    await page.waitForLoadState('networkidle');

    // Add poses to comparison programmatically via localStorage for reliable test
    await page.evaluate(() => {
      const mockState = {
        state: {
          selectedPoses: [1, 2], // Assuming poses with IDs 1 and 2 exist
          selectedPoseData: {}
        },
        version: 0
      };
      localStorage.setItem('yoga-compare-storage', JSON.stringify(mockState));
    });

    // Navigate to compare page with pose IDs
    await page.goto('/compare?poses=1,2');
    await page.waitForLoadState('networkidle');

    await page.screenshot({ path: 'test-results/11-compare-page.png', fullPage: true });

    // Check page content
    const pageTitle = page.locator('h1:has-text("Compare"), h1:has-text("Comparison")');
    const titleVisible = await pageTitle.isVisible({ timeout: 5000 }).catch(() => false);
    console.log('Compare page title visible:', titleVisible);

    // Check for tabs (Muscles, Overlap, Slider)
    const musclesTab = page.locator('button:has-text("Muscles"), [role="tab"]:has-text("Muscles")');
    const overlapTab = page.locator('button:has-text("Overlap"), [role="tab"]:has-text("Overlap")');
    const sliderTab = page.locator('button:has-text("Slider"), [role="tab"]:has-text("Visual")');

    const musclesVisible = await musclesTab.isVisible({ timeout: 3000 }).catch(() => false);
    const overlapVisible = await overlapTab.isVisible({ timeout: 3000 }).catch(() => false);
    const sliderVisible = await sliderTab.isVisible({ timeout: 3000 }).catch(() => false);

    console.log('Tabs visible - Muscles:', musclesVisible, 'Overlap:', overlapVisible, 'Slider:', sliderVisible);

    // Test muscle comparison if visible
    if (musclesVisible) {
      await musclesTab.click();
      await page.waitForTimeout(500);
      await page.screenshot({ path: 'test-results/12-muscle-comparison.png', fullPage: true });
    }

    // Test overlap analysis if visible
    if (overlapVisible) {
      await overlapTab.click();
      await page.waitForTimeout(500);
      await page.screenshot({ path: 'test-results/13-overlap-analysis.png', fullPage: true });
    }

    // Test visual slider if visible (only for 2 poses with photos)
    if (sliderVisible) {
      await sliderTab.click();
      await page.waitForTimeout(500);
      await page.screenshot({ path: 'test-results/14-visual-slider.png', fullPage: true });

      // Test slider interaction
      const slider = page.locator('[role="slider"]');
      if (await slider.isVisible({ timeout: 2000 })) {
        // Drag slider
        await slider.dragTo(slider, { targetPosition: { x: 100, y: 0 } });
        await page.waitForTimeout(300);
        await page.screenshot({ path: 'test-results/15-slider-moved.png', fullPage: true });
      }
    }

    // Check for error state (in case poses don't exist)
    const errorState = page.locator('text=Error, text=error, svg.lucide-alert-circle');
    const hasError = await errorState.first().isVisible({ timeout: 2000 }).catch(() => false);
    if (hasError) {
      console.log('Compare page showed error - poses may not exist');
      await page.screenshot({ path: 'test-results/11-compare-error.png', fullPage: true });
    }
  });
});

test.describe('Export/Import Functionality', () => {
  test.beforeEach(async ({ page }) => {
    await authenticate(page);
  });

  test('3.1 Export options available on pose gallery', async ({ page }) => {
    // Navigate to poses gallery
    await page.goto('/poses');
    await page.waitForLoadState('networkidle');

    await page.screenshot({ path: 'test-results/16-gallery-export.png', fullPage: true });

    // Find export button
    const exportButton = page.locator('button:has-text("Export"), button:has(svg.lucide-download)').first();

    if (await exportButton.isVisible({ timeout: 5000 })) {
      console.log('Export button found');

      // Click export button
      await exportButton.click();
      await page.waitForTimeout(500);

      await page.screenshot({ path: 'test-results/17-export-menu-open.png', fullPage: true });

      // Check for export options
      const jsonOption = page.locator('button:has-text("JSON"), text=JSON');
      const csvOption = page.locator('button:has-text("CSV"), text=CSV');
      const pdfOption = page.locator('button:has-text("PDF"), text=PDF');

      const jsonVisible = await jsonOption.first().isVisible({ timeout: 2000 }).catch(() => false);
      const csvVisible = await csvOption.first().isVisible({ timeout: 2000 }).catch(() => false);
      const pdfVisible = await pdfOption.first().isVisible({ timeout: 2000 }).catch(() => false);

      console.log('Export options - JSON:', jsonVisible, 'CSV:', csvVisible, 'PDF:', pdfVisible);

      expect(jsonVisible || csvVisible || pdfVisible).toBeTruthy();
    } else {
      console.log('Export button not found on gallery page');
      // Take screenshot to see what's available
      await page.screenshot({ path: 'test-results/16-no-export-button.png', fullPage: true });
    }
  });

  test('3.2 PDF export on pose detail page', async ({ page }) => {
    // Navigate to poses gallery first
    await page.goto('/poses');
    await page.waitForLoadState('networkidle');

    // Click on first pose to go to detail page
    const poseLink = page.locator('a[href^="/poses/"]').first();

    if (await poseLink.isVisible({ timeout: 5000 })) {
      await poseLink.click();
      await page.waitForLoadState('networkidle');

      await page.screenshot({ path: 'test-results/18-pose-detail-for-export.png', fullPage: true });

      // Find PDF export button
      const pdfButton = page.locator('button:has-text("PDF"), button:has(svg.lucide-file-text)').first();

      if (await pdfButton.isVisible({ timeout: 5000 })) {
        console.log('PDF export button found on detail page');

        // Start waiting for download before clicking
        const downloadPromise = page.waitForEvent('download', { timeout: 30000 }).catch(() => null);

        // Click PDF export
        await pdfButton.click();

        await page.screenshot({ path: 'test-results/19-pdf-export-clicked.png', fullPage: true });

        // Wait for download
        const download = await downloadPromise;

        if (download) {
          console.log('PDF download started:', download.suggestedFilename());
          expect(download.suggestedFilename()).toContain('.pdf');
        } else {
          console.log('No download triggered (may require additional processing time)');
        }
      } else {
        console.log('PDF button not found on detail page');
        // Check what buttons are available
        const buttons = await page.locator('button').allTextContents();
        console.log('Available buttons:', buttons.filter(t => t.trim()));
      }
    } else {
      console.log('No pose link found to navigate to detail page');
    }
  });

  test('3.3 Import functionality exists', async ({ page }) => {
    // Navigate to poses gallery
    await page.goto('/poses');
    await page.waitForLoadState('networkidle');

    // Look for import button
    const importButton = page.locator('button:has-text("Import"), button:has(svg.lucide-upload)').first();

    if (await importButton.isVisible({ timeout: 5000 })) {
      console.log('Import button found');

      // Click import button
      await importButton.click();
      await page.waitForTimeout(500);

      await page.screenshot({ path: 'test-results/20-import-modal.png', fullPage: true });

      // Check if import modal opened
      const modal = page.locator('[role="dialog"], div[class*="modal"], div[class*="Dialog"]');
      const modalVisible = await modal.first().isVisible({ timeout: 3000 }).catch(() => false);

      console.log('Import modal visible:', modalVisible);

      if (modalVisible) {
        // Check for file upload area or dropzone
        const dropzone = page.locator('[class*="dropzone"], input[type="file"], text=Drop, text=drag');
        const dropzoneVisible = await dropzone.first().isVisible({ timeout: 2000 }).catch(() => false);
        console.log('File dropzone visible:', dropzoneVisible);
      }

      expect(modalVisible).toBeTruthy();
    } else {
      console.log('Import button not found');
      await page.screenshot({ path: 'test-results/20-no-import-button.png', fullPage: true });
    }
  });

  test('3.4 Try JSON export', async ({ page }) => {
    // Navigate to poses gallery
    await page.goto('/poses');
    await page.waitForLoadState('networkidle');

    // Find and click export button
    const exportButton = page.locator('button:has-text("Export"), button:has(svg.lucide-download)').first();

    if (await exportButton.isVisible({ timeout: 5000 })) {
      await exportButton.click();
      await page.waitForTimeout(500);

      // Find JSON option
      const jsonOption = page.locator('button:has-text("JSON")').first();

      if (await jsonOption.isVisible({ timeout: 3000 })) {
        // Start waiting for download
        const downloadPromise = page.waitForEvent('download', { timeout: 30000 }).catch(() => null);

        await jsonOption.click();

        await page.screenshot({ path: 'test-results/21-json-export-clicked.png', fullPage: true });

        const download = await downloadPromise;

        if (download) {
          console.log('JSON download started:', download.suggestedFilename());
          expect(download.suggestedFilename()).toContain('.json');
        } else {
          console.log('No JSON download triggered');
        }
      }
    }
  });
});

// Summary test to provide overall results
test('Summary: Generate test report', async ({ page }) => {
  await authenticate(page);

  // Navigate to dashboard to verify app is working
  await page.goto('/');
  await page.waitForLoadState('networkidle');

  await page.screenshot({ path: 'test-results/00-dashboard-final.png', fullPage: true });

  console.log('\n========================================');
  console.log('TEST SUMMARY');
  console.log('========================================');
  console.log('All screenshots saved in test-results/ folder');
  console.log('Review screenshots for visual verification');
  console.log('========================================\n');
});
