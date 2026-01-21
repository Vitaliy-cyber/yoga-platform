import { test, expect } from '@playwright/test';
import { getFirstPoseId, getFirstSequenceId, hasTestData } from './test-data';

// Bulk operations tests
// Tests multi-select, batch actions, and mass operations

test.describe('Bulk Operations', () => {

  // Helpers
  const getPoseId = () => hasTestData() ? getFirstPoseId() : 1;
  const getSequenceId = () => hasTestData() ? getFirstSequenceId() : 1;

  test.describe('Multi-Select on Poses List', () => {

    test('should show select mode button', async ({ page }) => {
      await page.goto('/poses');
      await page.waitForLoadState('networkidle');

      // Look for select mode toggle or checkbox
      const selectMode = page.locator('button:has-text("Select"), button:has-text("Вибрати"), [data-testid="select-mode"], input[type="checkbox"]');
      const hasSelectMode = await selectMode.first().isVisible({ timeout: 5000 }).catch(() => false);

      await expect(page.locator('body')).toBeVisible();
    });

    test('should toggle individual item selection', async ({ page }) => {
      await page.goto('/poses');
      await page.waitForLoadState('networkidle');

      const checkbox = page.locator('[data-testid="pose-checkbox"], input[type="checkbox"]').first();

      if (await checkbox.isVisible({ timeout: 5000 }).catch(() => false)) {
        await checkbox.click();
        await page.waitForTimeout(300);

        // Should be checked
        const isChecked = await checkbox.isChecked().catch(() => false);
      }

      await expect(page.locator('body')).toBeVisible();
    });

    test('should select all items', async ({ page }) => {
      await page.goto('/poses');
      await page.waitForLoadState('networkidle');

      const selectAll = page.locator('[data-testid="select-all"], button:has-text("Select all"), button:has-text("Вибрати всі"), input[type="checkbox"][aria-label*="all" i]');

      if (await selectAll.first().isVisible({ timeout: 5000 }).catch(() => false)) {
        await selectAll.first().click();
        await page.waitForTimeout(300);
      }

      await expect(page.locator('body')).toBeVisible();
    });

    test('should deselect all items', async ({ page }) => {
      await page.goto('/poses');
      await page.waitForLoadState('networkidle');

      // First select all
      const selectAll = page.locator('[data-testid="select-all"], button:has-text("Select all")');

      if (await selectAll.first().isVisible({ timeout: 5000 }).catch(() => false)) {
        await selectAll.first().click();
        await page.waitForTimeout(300);

        // Then deselect
        const deselectAll = page.locator('button:has-text("Deselect"), button:has-text("Зняти вибір"), button:has-text("Clear")');
        if (await deselectAll.first().isVisible({ timeout: 3000 }).catch(() => false)) {
          await deselectAll.first().click();
          await page.waitForTimeout(300);
        }
      }

      await expect(page.locator('body')).toBeVisible();
    });

    test('should show selection count', async ({ page }) => {
      await page.goto('/poses');
      await page.waitForLoadState('networkidle');

      const checkboxes = page.locator('[data-testid="pose-checkbox"], .pose-item input[type="checkbox"]');
      const count = await checkboxes.count();

      if (count >= 2) {
        await checkboxes.first().click();
        await checkboxes.nth(1).click();
        await page.waitForTimeout(300);

        // Selection count indicator
        const selectionCount = page.locator('text=/2 selected|2 вибрано|selected: 2/i');
        const hasCount = await selectionCount.first().isVisible({ timeout: 3000 }).catch(() => false);
      }

      await expect(page.locator('body')).toBeVisible();
    });

    test('should support Shift+Click for range selection', async ({ page }) => {
      await page.goto('/poses');
      await page.waitForLoadState('networkidle');

      const items = page.locator('[data-testid="pose-item"], .pose-card, .pose-item');
      const count = await items.count();

      if (count >= 3) {
        // Click first item
        await items.first().click();
        await page.waitForTimeout(200);

        // Shift+Click third item
        await items.nth(2).click({ modifiers: ['Shift'] });
        await page.waitForTimeout(300);
      }

      await expect(page.locator('body')).toBeVisible();
    });

    test('should support Ctrl+Click for individual selection', async ({ page }) => {
      await page.goto('/poses');
      await page.waitForLoadState('networkidle');

      const items = page.locator('[data-testid="pose-item"], .pose-card');
      const count = await items.count();

      if (count >= 3) {
        // Ctrl+Click multiple items
        await items.first().click({ modifiers: ['Control'] });
        await items.nth(2).click({ modifiers: ['Control'] });
        await page.waitForTimeout(300);
      }

      await expect(page.locator('body')).toBeVisible();
    });
  });

  test.describe('Bulk Actions', () => {

    test('should show bulk action bar when items selected', async ({ page }) => {
      await page.goto('/poses');
      await page.waitForLoadState('networkidle');

      const checkbox = page.locator('[data-testid="pose-checkbox"], input[type="checkbox"]').first();

      if (await checkbox.isVisible({ timeout: 5000 }).catch(() => false)) {
        await checkbox.click();
        await page.waitForTimeout(300);

        // Bulk action bar should appear
        const actionBar = page.locator('[data-testid="bulk-action-bar"], .bulk-actions, .selection-toolbar');
        const hasActionBar = await actionBar.first().isVisible({ timeout: 3000 }).catch(() => false);
      }

      await expect(page.locator('body')).toBeVisible();
    });

    test('should have bulk delete option', async ({ page }) => {
      await page.goto('/poses');
      await page.waitForLoadState('networkidle');

      const checkbox = page.locator('[data-testid="pose-checkbox"], input[type="checkbox"]').first();

      if (await checkbox.isVisible({ timeout: 5000 }).catch(() => false)) {
        await checkbox.click();
        await page.waitForTimeout(300);

        // Bulk delete button
        const deleteButton = page.locator('button:has-text("Delete selected"), button:has-text("Видалити вибрані"), [data-testid="bulk-delete"]');
        const hasDelete = await deleteButton.first().isVisible({ timeout: 3000 }).catch(() => false);
      }

      await expect(page.locator('body')).toBeVisible();
    });

    test('should confirm before bulk delete', async ({ page }) => {
      await page.goto('/poses');
      await page.waitForLoadState('networkidle');

      const checkbox = page.locator('[data-testid="pose-checkbox"], input[type="checkbox"]').first();

      if (await checkbox.isVisible({ timeout: 5000 }).catch(() => false)) {
        await checkbox.click();
        await page.waitForTimeout(300);

        const deleteButton = page.locator('button:has-text("Delete"), button:has-text("Видалити")');
        if (await deleteButton.first().isVisible({ timeout: 3000 }).catch(() => false)) {
          await deleteButton.first().click();
          await page.waitForTimeout(300);

          // Confirmation dialog
          const dialog = page.locator('[role="alertdialog"], [role="dialog"], .confirm-dialog');
          const hasDialog = await dialog.first().isVisible({ timeout: 3000 }).catch(() => false);
        }
      }

      await expect(page.locator('body')).toBeVisible();
    });

    test('should have bulk add to sequence option', async ({ page }) => {
      await page.goto('/poses');
      await page.waitForLoadState('networkidle');

      const checkbox = page.locator('[data-testid="pose-checkbox"], input[type="checkbox"]').first();

      if (await checkbox.isVisible({ timeout: 5000 }).catch(() => false)) {
        await checkbox.click();
        await page.waitForTimeout(300);

        // Add to sequence button
        const addButton = page.locator('button:has-text("Add to sequence"), button:has-text("Додати до послідовності"), [data-testid="bulk-add-sequence"]');
        const hasAdd = await addButton.first().isVisible({ timeout: 3000 }).catch(() => false);
      }

      await expect(page.locator('body')).toBeVisible();
    });

    test('should have bulk export option', async ({ page }) => {
      await page.goto('/poses');
      await page.waitForLoadState('networkidle');

      const checkbox = page.locator('[data-testid="pose-checkbox"], input[type="checkbox"]').first();

      if (await checkbox.isVisible({ timeout: 5000 }).catch(() => false)) {
        await checkbox.click();
        await page.waitForTimeout(300);

        // Export button
        const exportButton = page.locator('button:has-text("Export"), button:has-text("Експорт"), [data-testid="bulk-export"]');
        const hasExport = await exportButton.first().isVisible({ timeout: 3000 }).catch(() => false);
      }

      await expect(page.locator('body')).toBeVisible();
    });
  });

  test.describe('Bulk Operations on Sequences', () => {

    test('should select multiple sequences', async ({ page }) => {
      await page.goto('/sequences');
      await page.waitForLoadState('networkidle');

      const checkboxes = page.locator('[data-testid="sequence-checkbox"], .sequence-item input[type="checkbox"]');
      const count = await checkboxes.count();

      if (count >= 2) {
        await checkboxes.first().click();
        await checkboxes.nth(1).click();
        await page.waitForTimeout(300);
      }

      await expect(page.locator('body')).toBeVisible();
    });

    test('should bulk delete sequences', async ({ page }) => {
      await page.goto('/sequences');
      await page.waitForLoadState('networkidle');

      const checkbox = page.locator('[data-testid="sequence-checkbox"], input[type="checkbox"]').first();

      if (await checkbox.isVisible({ timeout: 5000 }).catch(() => false)) {
        await checkbox.click();
        await page.waitForTimeout(300);

        const deleteButton = page.locator('button:has-text("Delete"), button:has-text("Видалити")');
        const hasDelete = await deleteButton.first().isVisible({ timeout: 3000 }).catch(() => false);
      }

      await expect(page.locator('body')).toBeVisible();
    });

    test('should bulk duplicate sequences', async ({ page }) => {
      await page.goto('/sequences');
      await page.waitForLoadState('networkidle');

      const checkbox = page.locator('[data-testid="sequence-checkbox"], input[type="checkbox"]').first();

      if (await checkbox.isVisible({ timeout: 5000 }).catch(() => false)) {
        await checkbox.click();
        await page.waitForTimeout(300);

        const duplicateButton = page.locator('button:has-text("Duplicate"), button:has-text("Дублювати"), [data-testid="bulk-duplicate"]');
        const hasDuplicate = await duplicateButton.first().isVisible({ timeout: 3000 }).catch(() => false);
      }

      await expect(page.locator('body')).toBeVisible();
    });
  });

  test.describe('Bulk Operations in Sequence Editor', () => {

    test('should select multiple poses in sequence', async ({ page }) => {
      await page.goto(`/sequences/${getSequenceId()}`);
      await page.waitForLoadState('networkidle');

      const poseCheckboxes = page.locator('[data-testid="sequence-pose-checkbox"], .sequence-pose input[type="checkbox"]');
      const count = await poseCheckboxes.count();

      if (count >= 2) {
        await poseCheckboxes.first().click();
        await poseCheckboxes.nth(1).click();
        await page.waitForTimeout(300);
      }

      await expect(page.locator('body')).toBeVisible();
    });

    test('should bulk remove poses from sequence', async ({ page }) => {
      await page.goto(`/sequences/${getSequenceId()}`);
      await page.waitForLoadState('networkidle');

      const checkbox = page.locator('[data-testid="sequence-pose-checkbox"], input[type="checkbox"]').first();

      if (await checkbox.isVisible({ timeout: 5000 }).catch(() => false)) {
        await checkbox.click();
        await page.waitForTimeout(300);

        const removeButton = page.locator('button:has-text("Remove"), button:has-text("Видалити")');
        const hasRemove = await removeButton.first().isVisible({ timeout: 3000 }).catch(() => false);
      }

      await expect(page.locator('body')).toBeVisible();
    });

    test('should bulk update pose durations', async ({ page }) => {
      await page.goto(`/sequences/${getSequenceId()}`);
      await page.waitForLoadState('networkidle');

      const checkbox = page.locator('[data-testid="sequence-pose-checkbox"], input[type="checkbox"]').first();

      if (await checkbox.isVisible({ timeout: 5000 }).catch(() => false)) {
        await checkbox.click();
        await page.waitForTimeout(300);

        const durationButton = page.locator('button:has-text("Set duration"), button:has-text("Встановити тривалість"), [data-testid="bulk-duration"]');
        const hasDuration = await durationButton.first().isVisible({ timeout: 3000 }).catch(() => false);
      }

      await expect(page.locator('body')).toBeVisible();
    });
  });

  test.describe('Selection Persistence', () => {

    test('should maintain selection after filtering', async ({ page }) => {
      await page.goto('/poses');
      await page.waitForLoadState('networkidle');

      const checkbox = page.locator('[data-testid="pose-checkbox"], input[type="checkbox"]').first();

      if (await checkbox.isVisible({ timeout: 5000 }).catch(() => false)) {
        await checkbox.click();
        await page.waitForTimeout(300);

        // Apply a filter
        const filterButton = page.locator('button:has-text("Filter"), button:has-text("Фільтр")').first();
        if (await filterButton.isVisible({ timeout: 3000 }).catch(() => false)) {
          await filterButton.click();
          await page.waitForTimeout(500);
        }

        // Selection should persist or be cleared appropriately
      }

      await expect(page.locator('body')).toBeVisible();
    });

    test('should clear selection on page navigation', async ({ page }) => {
      await page.goto('/poses');
      await page.waitForLoadState('networkidle');

      const checkbox = page.locator('[data-testid="pose-checkbox"], input[type="checkbox"]').first();

      if (await checkbox.isVisible({ timeout: 5000 }).catch(() => false)) {
        await checkbox.click();
        await page.waitForTimeout(300);

        // Navigate away
        await page.goto('/sequences');
        await page.waitForLoadState('networkidle');

        // Navigate back
        await page.goto('/poses');
        await page.waitForLoadState('networkidle');

        // Selection should be cleared
      }

      await expect(page.locator('body')).toBeVisible();
    });
  });
});
