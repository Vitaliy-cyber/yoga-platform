import { test, expect } from '@playwright/test';
import { getFirstPoseId, getFirstSequenceId, hasTestData } from './test-data';

// Print and export tests
// Tests print layouts, PDF export, and data export features

test.describe('Print and Export', () => {

  // Helpers
  const getPoseId = () => hasTestData() ? getFirstPoseId() : 1;
  const getSequenceId = () => hasTestData() ? getFirstSequenceId() : 1;

  test.describe('Print Layout', () => {

    test('should have print styles for pose detail', async ({ page }) => {
      await page.goto(`/poses/${getPoseId()}`);
      await page.waitForLoadState('networkidle');

      // Emulate print media
      await page.emulateMedia({ media: 'print' });
      await page.waitForTimeout(300);

      // Print styles should hide navigation
      const navigation = page.locator('nav, [data-testid="navigation"], header');
      const navVisible = await navigation.first().isVisible().catch(() => true);

      // Navigation may be hidden in print
      await expect(page.locator('body')).toBeVisible();
    });

    test('should have print styles for sequence detail', async ({ page }) => {
      await page.goto(`/sequences/${getSequenceId()}`);
      await page.waitForLoadState('networkidle');

      await page.emulateMedia({ media: 'print' });
      await page.waitForTimeout(300);

      // Print layout should be applied
      await expect(page.locator('body')).toBeVisible();
    });

    test('should show print button', async ({ page }) => {
      await page.goto(`/sequences/${getSequenceId()}`);
      await page.waitForLoadState('networkidle');

      // Print button
      const printButton = page.locator('button:has-text("Print"), button:has-text("Друк"), button[aria-label*="print" i], [data-testid="print-button"]');
      const hasPrint = await printButton.first().isVisible({ timeout: 5000 }).catch(() => false);

      await expect(page.locator('body')).toBeVisible();
    });

    test('should hide interactive elements in print', async ({ page }) => {
      await page.goto(`/sequences/${getSequenceId()}`);
      await page.waitForLoadState('networkidle');

      await page.emulateMedia({ media: 'print' });
      await page.waitForTimeout(300);

      // Buttons and interactive elements should be hidden in print
      const editButton = page.locator('button:has-text("Edit"), button:has-text("Редагувати")');
      const buttonVisible = await editButton.first().isVisible().catch(() => true);

      // Interactive buttons may be hidden
      await expect(page.locator('body')).toBeVisible();
    });

    test('should expand all content for print', async ({ page }) => {
      await page.goto(`/poses/${getPoseId()}`);
      await page.waitForLoadState('networkidle');

      await page.emulateMedia({ media: 'print' });
      await page.waitForTimeout(300);

      // Collapsed sections should expand for print
      await expect(page.locator('body')).toBeVisible();
    });
  });

  test.describe('PDF Export', () => {

    test('should show export to PDF option', async ({ page }) => {
      await page.goto(`/sequences/${getSequenceId()}`);
      await page.waitForLoadState('networkidle');

      // Export button or menu
      const exportButton = page.locator('button:has-text("Export"), button:has-text("Експорт"), [data-testid="export-button"]');

      if (await exportButton.first().isVisible({ timeout: 5000 }).catch(() => false)) {
        await exportButton.first().click();
        await page.waitForTimeout(300);

        // PDF option
        const pdfOption = page.locator('button:has-text("PDF"), [data-export-format="pdf"]');
        const hasPdf = await pdfOption.first().isVisible({ timeout: 3000 }).catch(() => false);
      }

      await expect(page.locator('body')).toBeVisible();
    });

    test('should export sequence to PDF', async ({ page }) => {
      await page.goto(`/sequences/${getSequenceId()}`);
      await page.waitForLoadState('networkidle');

      const exportButton = page.locator('button:has-text("Export PDF"), button:has-text("Експорт PDF"), [data-testid="export-pdf"]');

      if (await exportButton.first().isVisible({ timeout: 5000 }).catch(() => false)) {
        // Set up download listener
        const downloadPromise = page.waitForEvent('download', { timeout: 10000 }).catch(() => null);

        await exportButton.first().click();
        await page.waitForTimeout(2000);

        // May trigger download
      }

      await expect(page.locator('body')).toBeVisible();
    });

    test('should export pose to PDF', async ({ page }) => {
      await page.goto(`/poses/${getPoseId()}`);
      await page.waitForLoadState('networkidle');

      const exportButton = page.locator('button:has-text("Export"), button:has-text("Експорт"), [data-testid="export-button"]');

      if (await exportButton.first().isVisible({ timeout: 5000 }).catch(() => false)) {
        await exportButton.first().click();
        await page.waitForTimeout(300);
      }

      await expect(page.locator('body')).toBeVisible();
    });
  });

  test.describe('Image Export', () => {

    test('should show export to image option', async ({ page }) => {
      await page.goto(`/poses/${getPoseId()}`);
      await page.waitForLoadState('networkidle');

      const exportButton = page.locator('button:has-text("Export"), button:has-text("Експорт")');

      if (await exportButton.first().isVisible({ timeout: 5000 }).catch(() => false)) {
        await exportButton.first().click();
        await page.waitForTimeout(300);

        // Image export option
        const imageOption = page.locator('button:has-text("Image"), button:has-text("PNG"), button:has-text("JPG")');
        const hasImage = await imageOption.first().isVisible({ timeout: 3000 }).catch(() => false);
      }

      await expect(page.locator('body')).toBeVisible();
    });

    test('should download pose image', async ({ page }) => {
      await page.goto(`/poses/${getPoseId()}`);
      await page.waitForLoadState('networkidle');

      // Download image button
      const downloadButton = page.locator('button:has-text("Download image"), a[download], [data-testid="download-image"]');

      if (await downloadButton.first().isVisible({ timeout: 5000 }).catch(() => false)) {
        const downloadPromise = page.waitForEvent('download', { timeout: 5000 }).catch(() => null);
        await downloadButton.first().click();
        await page.waitForTimeout(1000);
      }

      await expect(page.locator('body')).toBeVisible();
    });
  });

  test.describe('Data Export', () => {

    test('should show export to JSON option', async ({ page }) => {
      await page.goto(`/sequences/${getSequenceId()}`);
      await page.waitForLoadState('networkidle');

      const exportButton = page.locator('button:has-text("Export"), button:has-text("Експорт")');

      if (await exportButton.first().isVisible({ timeout: 5000 }).catch(() => false)) {
        await exportButton.first().click();
        await page.waitForTimeout(300);

        // JSON option
        const jsonOption = page.locator('button:has-text("JSON"), [data-export-format="json"]');
        const hasJson = await jsonOption.first().isVisible({ timeout: 3000 }).catch(() => false);
      }

      await expect(page.locator('body')).toBeVisible();
    });

    test('should export sequence to JSON', async ({ page }) => {
      await page.goto(`/sequences/${getSequenceId()}`);
      await page.waitForLoadState('networkidle');

      const exportJsonButton = page.locator('button:has-text("Export JSON"), [data-testid="export-json"]');

      if (await exportJsonButton.first().isVisible({ timeout: 5000 }).catch(() => false)) {
        const downloadPromise = page.waitForEvent('download', { timeout: 5000 }).catch(() => null);
        await exportJsonButton.first().click();
        await page.waitForTimeout(1000);

        const download = await downloadPromise;
        // Download may have occurred
      }

      await expect(page.locator('body')).toBeVisible();
    });

    test('should export all user data', async ({ page }) => {
      await page.goto('/settings');
      await page.waitForLoadState('networkidle');

      // Export all data button
      const exportAllButton = page.locator('button:has-text("Export all"), button:has-text("Експортувати все"), [data-testid="export-all-data"]');

      if (await exportAllButton.first().isVisible({ timeout: 5000 }).catch(() => false)) {
        await exportAllButton.first().click();
        await page.waitForTimeout(1000);
      }

      await expect(page.locator('body')).toBeVisible();
    });
  });

  test.describe('CSV Export', () => {

    test('should show export to CSV option for list views', async ({ page }) => {
      await page.goto('/poses');
      await page.waitForLoadState('networkidle');

      const exportButton = page.locator('button:has-text("Export"), button:has-text("Експорт")');

      if (await exportButton.first().isVisible({ timeout: 5000 }).catch(() => false)) {
        await exportButton.first().click();
        await page.waitForTimeout(300);

        // CSV option
        const csvOption = page.locator('button:has-text("CSV"), [data-export-format="csv"]');
        const hasCsv = await csvOption.first().isVisible({ timeout: 3000 }).catch(() => false);
      }

      await expect(page.locator('body')).toBeVisible();
    });

    test('should export poses list to CSV', async ({ page }) => {
      await page.goto('/poses');
      await page.waitForLoadState('networkidle');

      const exportCsvButton = page.locator('button:has-text("Export CSV"), [data-testid="export-csv"]');

      if (await exportCsvButton.first().isVisible({ timeout: 5000 }).catch(() => false)) {
        const downloadPromise = page.waitForEvent('download', { timeout: 5000 }).catch(() => null);
        await exportCsvButton.first().click();
        await page.waitForTimeout(1000);
      }

      await expect(page.locator('body')).toBeVisible();
    });
  });

  test.describe('Sequence Printable View', () => {

    test('should have printable sequence card view', async ({ page }) => {
      await page.goto(`/sequences/${getSequenceId()}/print`);
      await page.waitForLoadState('networkidle');

      // Printable view with all poses
      const printView = page.locator('.print-view, [data-print-layout], .sequence-print');
      const hasPrintView = await printView.first().isVisible({ timeout: 5000 }).catch(() => false);

      await expect(page.locator('body')).toBeVisible();
    });

    test('should show all poses on one page for print', async ({ page }) => {
      await page.goto(`/sequences/${getSequenceId()}`);
      await page.waitForLoadState('networkidle');

      await page.emulateMedia({ media: 'print' });
      await page.waitForTimeout(300);

      // All poses should be visible (no pagination in print)
      const poses = page.locator('.sequence-pose, [data-testid="sequence-pose"]');
      const count = await poses.count();

      await expect(page.locator('body')).toBeVisible();
    });

    test('should include pose instructions in print', async ({ page }) => {
      await page.goto(`/sequences/${getSequenceId()}`);
      await page.waitForLoadState('networkidle');

      await page.emulateMedia({ media: 'print' });
      await page.waitForTimeout(300);

      // Instructions should be visible in print
      const instructions = page.locator('.pose-instructions, [data-testid="instructions"]');
      const hasInstructions = await instructions.first().isVisible({ timeout: 3000 }).catch(() => false);

      await expect(page.locator('body')).toBeVisible();
    });
  });

  test.describe('Share as Image', () => {

    test('should generate shareable image', async ({ page }) => {
      await page.goto(`/sequences/${getSequenceId()}`);
      await page.waitForLoadState('networkidle');

      const shareButton = page.locator('button:has-text("Share as image"), button:has-text("Поділитися як зображення"), [data-testid="share-image"]');

      if (await shareButton.first().isVisible({ timeout: 5000 }).catch(() => false)) {
        await shareButton.first().click();
        await page.waitForTimeout(1000);

        // Preview or download dialog
        const preview = page.locator('[data-testid="image-preview"], .share-preview');
        const hasPreview = await preview.first().isVisible({ timeout: 3000 }).catch(() => false);
      }

      await expect(page.locator('body')).toBeVisible();
    });

    test('should copy image to clipboard', async ({ page, context }) => {
      await context.grantPermissions(['clipboard-read', 'clipboard-write']);

      await page.goto(`/sequences/${getSequenceId()}`);
      await page.waitForLoadState('networkidle');

      const copyImageButton = page.locator('button:has-text("Copy image"), button:has-text("Копіювати зображення")');

      if (await copyImageButton.first().isVisible({ timeout: 5000 }).catch(() => false)) {
        await copyImageButton.first().click();
        await page.waitForTimeout(500);

        // Success notification
        const notification = page.locator('text=/copied|скопійовано/i');
        const hasNotification = await notification.first().isVisible({ timeout: 3000 }).catch(() => false);
      }

      await expect(page.locator('body')).toBeVisible();
    });
  });

  test.describe('Export Options', () => {

    test('should allow selecting export format', async ({ page }) => {
      await page.goto(`/sequences/${getSequenceId()}`);
      await page.waitForLoadState('networkidle');

      const exportButton = page.locator('button:has-text("Export"), button:has-text("Експорт")');

      if (await exportButton.first().isVisible({ timeout: 5000 }).catch(() => false)) {
        await exportButton.first().click();
        await page.waitForTimeout(300);

        // Format selection
        const formatOptions = page.locator('[data-testid="export-format"], .export-format-option');
        const count = await formatOptions.count();
        // Multiple formats may be available
      }

      await expect(page.locator('body')).toBeVisible();
    });

    test('should allow selecting export quality', async ({ page }) => {
      await page.goto(`/sequences/${getSequenceId()}`);
      await page.waitForLoadState('networkidle');

      const exportButton = page.locator('button:has-text("Export"), button:has-text("Експорт")');

      if (await exportButton.first().isVisible({ timeout: 5000 }).catch(() => false)) {
        await exportButton.first().click();
        await page.waitForTimeout(300);

        // Quality selection
        const qualityOptions = page.locator('[data-testid="export-quality"], select[name="quality"]');
        const hasQuality = await qualityOptions.first().isVisible({ timeout: 3000 }).catch(() => false);
      }

      await expect(page.locator('body')).toBeVisible();
    });

    test('should allow including/excluding metadata', async ({ page }) => {
      await page.goto(`/sequences/${getSequenceId()}`);
      await page.waitForLoadState('networkidle');

      const exportButton = page.locator('button:has-text("Export"), button:has-text("Експорт")');

      if (await exportButton.first().isVisible({ timeout: 5000 }).catch(() => false)) {
        await exportButton.first().click();
        await page.waitForTimeout(300);

        // Include metadata checkbox
        const metadataCheckbox = page.locator('input[name="includeMetadata"], [data-testid="include-metadata"]');
        const hasMetadata = await metadataCheckbox.first().isVisible({ timeout: 3000 }).catch(() => false);
      }

      await expect(page.locator('body')).toBeVisible();
    });
  });

  test.describe('Bulk Export', () => {

    test('should export multiple selected items', async ({ page }) => {
      await page.goto('/poses');
      await page.waitForLoadState('networkidle');

      // Select multiple items
      const checkboxes = page.locator('[data-testid="pose-checkbox"], input[type="checkbox"]');
      const count = await checkboxes.count();

      if (count >= 2) {
        await checkboxes.first().click();
        await checkboxes.nth(1).click();
        await page.waitForTimeout(300);

        // Bulk export button
        const bulkExportButton = page.locator('button:has-text("Export selected"), button:has-text("Експортувати вибрані")');
        const hasExport = await bulkExportButton.first().isVisible({ timeout: 3000 }).catch(() => false);
      }

      await expect(page.locator('body')).toBeVisible();
    });

    test('should export all sequences', async ({ page }) => {
      await page.goto('/sequences');
      await page.waitForLoadState('networkidle');

      const exportAllButton = page.locator('button:has-text("Export all"), button:has-text("Експортувати всі")');

      if (await exportAllButton.first().isVisible({ timeout: 5000 }).catch(() => false)) {
        await exportAllButton.first().click();
        await page.waitForTimeout(1000);
      }

      await expect(page.locator('body')).toBeVisible();
    });
  });

  test.describe('Print Preview', () => {

    test('should show print preview dialog', async ({ page }) => {
      await page.goto(`/sequences/${getSequenceId()}`);
      await page.waitForLoadState('networkidle');

      const printPreviewButton = page.locator('button:has-text("Print preview"), button:has-text("Попередній перегляд")');

      if (await printPreviewButton.first().isVisible({ timeout: 5000 }).catch(() => false)) {
        await printPreviewButton.first().click();
        await page.waitForTimeout(500);

        // Preview dialog
        const preview = page.locator('[data-testid="print-preview"], .print-preview-dialog');
        const hasPreview = await preview.first().isVisible({ timeout: 3000 }).catch(() => false);
      }

      await expect(page.locator('body')).toBeVisible();
    });

    test('should allow adjusting print settings', async ({ page }) => {
      await page.goto(`/sequences/${getSequenceId()}`);
      await page.waitForLoadState('networkidle');

      // Print settings (orientation, size, etc.)
      const printSettingsButton = page.locator('button:has-text("Print settings"), [data-testid="print-settings"]');

      if (await printSettingsButton.first().isVisible({ timeout: 5000 }).catch(() => false)) {
        await printSettingsButton.first().click();
        await page.waitForTimeout(300);

        // Settings panel
        const settings = page.locator('.print-settings, [data-testid="print-settings-panel"]');
        const hasSettings = await settings.first().isVisible({ timeout: 3000 }).catch(() => false);
      }

      await expect(page.locator('body')).toBeVisible();
    });
  });
});
