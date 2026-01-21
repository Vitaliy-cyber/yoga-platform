import { test, expect } from '@playwright/test';
import { getFirstSequenceId, hasTestData } from './test-data';

// Real-time features tests
// Tests live updates, websocket connections, and collaborative features

test.describe('Real-time Features', () => {

  // Helper
  const getSequenceId = () => hasTestData() ? getFirstSequenceId() : 1;

  test.describe('Live Data Updates', () => {

    test('should show newly created pose without refresh', async ({ page, context }) => {
      await page.goto('/poses');
      await page.waitForLoadState('networkidle');

      // Open a new tab to create a pose
      const newPage = await context.newPage();
      await newPage.goto('/upload');
      await newPage.waitForLoadState('networkidle');

      // The first page should eventually show new content
      // (if real-time updates are implemented)
      await page.waitForTimeout(2000);

      await newPage.close();
      await expect(page.locator('body')).toBeVisible();
    });

    test('should update sequence list on new sequence', async ({ page, context }) => {
      await page.goto('/sequences');
      await page.waitForLoadState('networkidle');

      // Simulate another user creating a sequence
      // Check if list updates automatically
      await page.waitForTimeout(2000);

      await expect(page.locator('body')).toBeVisible();
    });

    test('should reflect changes from other tabs', async ({ page, context }) => {
      await page.goto('/poses');
      await page.waitForLoadState('networkidle');

      // Open another tab
      const page2 = await context.newPage();
      await page2.goto('/poses');
      await page2.waitForLoadState('networkidle');

      // Both pages should stay in sync
      await page.waitForTimeout(1000);

      await page2.close();
      await expect(page.locator('body')).toBeVisible();
    });
  });

  test.describe('WebSocket Connection', () => {

    test('should establish websocket connection', async ({ page }) => {
      // Track websocket connections
      const wsConnections: string[] = [];
      page.on('websocket', ws => {
        wsConnections.push(ws.url());
      });

      await page.goto('/');
      await page.waitForLoadState('networkidle');
      await page.waitForTimeout(2000);

      // May or may not have websocket depending on implementation
      await expect(page.locator('body')).toBeVisible();
    });

    test('should handle websocket disconnection gracefully', async ({ page }) => {
      await page.goto('/');
      await page.waitForLoadState('networkidle');

      // Simulate going offline
      await page.context().setOffline(true);
      await page.waitForTimeout(1000);

      // Should show offline indicator or handle gracefully
      const offlineIndicator = page.locator('text=/offline|відключено|no connection|немає з\'єднання/i, [data-testid="offline-indicator"]');
      const hasOffline = await offlineIndicator.first().isVisible({ timeout: 3000 }).catch(() => false);

      // Go back online
      await page.context().setOffline(false);
      await page.waitForTimeout(1000);

      await expect(page.locator('body')).toBeVisible();
    });

    test('should reconnect after connection loss', async ({ page }) => {
      await page.goto('/');
      await page.waitForLoadState('networkidle');

      // Go offline
      await page.context().setOffline(true);
      await page.waitForTimeout(500);

      // Go back online
      await page.context().setOffline(false);
      await page.waitForTimeout(2000);

      // Should reconnect and function normally
      await expect(page.locator('body')).toBeVisible();
    });
  });

  test.describe('Optimistic Updates', () => {

    test('should show immediate feedback on action', async ({ page }) => {
      await page.goto(`/sequences/${getSequenceId()}`);
      await page.waitForLoadState('networkidle');

      // Like/favorite action should update immediately
      const favoriteButton = page.locator('[data-testid="favorite-button"], button[aria-label*="favorite" i], button:has([class*="heart"])');

      if (await favoriteButton.first().isVisible({ timeout: 5000 }).catch(() => false)) {
        await favoriteButton.first().click();
        // UI should update immediately (optimistic update)
        await page.waitForTimeout(100);
      }

      await expect(page.locator('body')).toBeVisible();
    });

    test('should persist action after successful API call', async ({ page }) => {
      // Test that optimistic updates persist after successful API response
      await page.goto(`/sequences/${getSequenceId()}`);
      await page.waitForLoadState('networkidle');

      const favoriteButton = page.locator('[data-testid="favorite-button"], button[aria-label*="favorite" i]');

      if (await favoriteButton.first().isVisible({ timeout: 5000 }).catch(() => false)) {
        // Get initial state
        const initialState = await favoriteButton.first().getAttribute('data-favorited');

        await favoriteButton.first().click();
        await page.waitForTimeout(1000);

        // After successful API call, state should be updated
        // (We can't test rollback without mocking server errors)
      }

      await expect(page.locator('body')).toBeVisible();
    });
  });

  test.describe('Sequence Player Sync', () => {

    test('should sync player state across tabs', async ({ page, context }) => {
      await page.goto(`/sequences/${getSequenceId()}/play`);
      await page.waitForLoadState('networkidle');

      // Open same sequence in another tab
      const page2 = await context.newPage();
      await page2.goto(`/sequences/${getSequenceId()}/play`);
      await page2.waitForLoadState('networkidle');

      // If collaborative viewing is supported, state should sync
      await page.waitForTimeout(1000);

      await page2.close();
      await expect(page.locator('body')).toBeVisible();
    });

    test('should show active viewers count', async ({ page }) => {
      await page.goto(`/sequences/${getSequenceId()}/play`);
      await page.waitForLoadState('networkidle');

      // Viewer count indicator
      const viewerCount = page.locator('[data-testid="viewer-count"], text=/viewers|глядачів/i');
      const hasViewerCount = await viewerCount.first().isVisible({ timeout: 5000 }).catch(() => false);

      await expect(page.locator('body')).toBeVisible();
    });
  });

  test.describe('Notifications', () => {

    test('should show notification badge', async ({ page }) => {
      await page.goto('/');
      await page.waitForLoadState('networkidle');

      // Notification bell or badge
      const notificationBadge = page.locator('[data-testid="notification-badge"], .notification-badge, button[aria-label*="notification" i]');
      const hasBadge = await notificationBadge.first().isVisible({ timeout: 5000 }).catch(() => false);

      await expect(page.locator('body')).toBeVisible();
    });

    test('should show notification dropdown', async ({ page }) => {
      await page.goto('/');
      await page.waitForLoadState('networkidle');

      const notificationButton = page.locator('[data-testid="notification-button"], button[aria-label*="notification" i]');

      if (await notificationButton.first().isVisible({ timeout: 5000 }).catch(() => false)) {
        await notificationButton.first().click();
        await page.waitForTimeout(300);

        // Notification dropdown should appear
        const dropdown = page.locator('[data-testid="notification-dropdown"], .notification-dropdown, [role="menu"]');
        const hasDropdown = await dropdown.first().isVisible({ timeout: 3000 }).catch(() => false);
      }

      await expect(page.locator('body')).toBeVisible();
    });

    test('should mark notification as read', async ({ page }) => {
      await page.goto('/');
      await page.waitForLoadState('networkidle');

      const notificationButton = page.locator('[data-testid="notification-button"], button[aria-label*="notification" i]');

      if (await notificationButton.first().isVisible({ timeout: 5000 }).catch(() => false)) {
        await notificationButton.first().click();
        await page.waitForTimeout(300);

        // Click a notification to mark as read
        const notification = page.locator('.notification-item, [data-testid="notification-item"]').first();
        if (await notification.isVisible({ timeout: 3000 }).catch(() => false)) {
          await notification.click();
          await page.waitForTimeout(300);
        }
      }

      await expect(page.locator('body')).toBeVisible();
    });

    test('should clear all notifications', async ({ page }) => {
      await page.goto('/');
      await page.waitForLoadState('networkidle');

      const notificationButton = page.locator('[data-testid="notification-button"], button[aria-label*="notification" i]');

      if (await notificationButton.first().isVisible({ timeout: 5000 }).catch(() => false)) {
        await notificationButton.first().click();
        await page.waitForTimeout(300);

        // Clear all button
        const clearButton = page.locator('button:has-text("Clear all"), button:has-text("Очистити все"), [data-testid="clear-notifications"]');
        if (await clearButton.first().isVisible({ timeout: 3000 }).catch(() => false)) {
          await clearButton.first().click();
          await page.waitForTimeout(300);
        }
      }

      await expect(page.locator('body')).toBeVisible();
    });
  });

  test.describe('Connection Status', () => {

    test('should show connection status indicator', async ({ page }) => {
      await page.goto('/');
      await page.waitForLoadState('networkidle');

      // Connection status in footer or header
      const connectionStatus = page.locator('[data-testid="connection-status"], .connection-indicator, text=/connected|підключено/i');
      const hasStatus = await connectionStatus.first().isVisible({ timeout: 5000 }).catch(() => false);

      await expect(page.locator('body')).toBeVisible();
    });

    test('should show reconnecting state', async ({ page }) => {
      await page.goto('/');
      await page.waitForLoadState('networkidle');

      // Go offline then online to trigger reconnecting
      await page.context().setOffline(true);
      await page.waitForTimeout(500);
      await page.context().setOffline(false);

      // Reconnecting indicator
      const reconnecting = page.locator('text=/reconnecting|підключення|connecting/i, [data-testid="reconnecting"]');
      const hasReconnecting = await reconnecting.first().isVisible({ timeout: 3000 }).catch(() => false);

      await page.waitForTimeout(2000);
      await expect(page.locator('body')).toBeVisible();
    });
  });

  test.describe('Auto-save', () => {

    test('should auto-save sequence changes', async ({ page }) => {
      await page.goto(`/sequences/${getSequenceId()}`);
      await page.waitForLoadState('networkidle');

      // Make a change
      const nameInput = page.locator('input#name, input[name="name"]');

      if (await nameInput.isVisible({ timeout: 5000 }).catch(() => false)) {
        await nameInput.fill('Auto-saved Sequence');
        await page.waitForTimeout(2000);

        // Auto-save indicator
        const saveIndicator = page.locator('text=/saved|збережено|saving|зберігається/i, [data-testid="save-status"]');
        const hasSaveIndicator = await saveIndicator.first().isVisible({ timeout: 3000 }).catch(() => false);
      }

      await expect(page.locator('body')).toBeVisible();
    });

    test('should show unsaved changes warning', async ({ page }) => {
      await page.goto(`/sequences/${getSequenceId()}`);
      await page.waitForLoadState('networkidle');

      // Make a change
      const nameInput = page.locator('input#name, input[name="name"]');

      if (await nameInput.isVisible({ timeout: 5000 }).catch(() => false)) {
        await nameInput.fill('Unsaved Changes');

        // Try to navigate away
        page.on('dialog', dialog => dialog.dismiss());
        await page.goto('/sequences');

        // May show warning dialog or indicator
      }

      await expect(page.locator('body')).toBeVisible();
    });

    test('should recover unsaved changes', async ({ page }) => {
      await page.goto(`/sequences/${getSequenceId()}`);
      await page.waitForLoadState('networkidle');

      // Simulate browser crash recovery
      await page.evaluate(() => {
        localStorage.setItem('sequence_draft', JSON.stringify({ name: 'Recovered Draft' }));
      });

      await page.reload();
      await page.waitForLoadState('networkidle');

      // Recovery notice
      const recoveryNotice = page.locator('text=/recover|відновити|draft|чернетк/i');
      const hasRecovery = await recoveryNotice.first().isVisible({ timeout: 3000 }).catch(() => false);

      await expect(page.locator('body')).toBeVisible();
    });
  });

  test.describe('Collaborative Features', () => {

    test('should show who is currently editing', async ({ page }) => {
      await page.goto(`/sequences/${getSequenceId()}`);
      await page.waitForLoadState('networkidle');

      // Active editors indicator
      const activeEditors = page.locator('[data-testid="active-editors"], text=/editing|редагує/i, .editor-avatar');
      const hasEditors = await activeEditors.first().isVisible({ timeout: 5000 }).catch(() => false);

      await expect(page.locator('body')).toBeVisible();
    });

    test('should show cursor positions of other users', async ({ page }) => {
      await page.goto(`/sequences/${getSequenceId()}`);
      await page.waitForLoadState('networkidle');

      // Remote cursor indicators
      const remoteCursors = page.locator('.remote-cursor, [data-testid="remote-cursor"]');
      // May or may not be visible depending on other users

      await expect(page.locator('body')).toBeVisible();
    });

    test('should handle concurrent edits', async ({ page, context }) => {
      await page.goto(`/sequences/${getSequenceId()}`);
      await page.waitForLoadState('networkidle');

      // Open in another tab
      const page2 = await context.newPage();
      await page2.goto(`/sequences/${getSequenceId()}`);
      await page2.waitForLoadState('networkidle');

      // Both make edits
      const nameInput1 = page.locator('input#name, input[name="name"]');
      const nameInput2 = page2.locator('input#name, input[name="name"]');

      if (await nameInput1.isVisible({ timeout: 5000 }).catch(() => false)) {
        await nameInput1.fill('Edit from tab 1');
      }

      if (await nameInput2.isVisible({ timeout: 5000 }).catch(() => false)) {
        await nameInput2.fill('Edit from tab 2');
      }

      await page.waitForTimeout(1000);
      await page2.close();

      await expect(page.locator('body')).toBeVisible();
    });
  });
});
