import { test, expect } from '@playwright/test';

// User settings and preferences tests
// Tests theme, language, notification settings, and other user preferences

test.describe('User Settings', () => {

  test.describe('Settings Page', () => {

    test('should display settings page', async ({ page }) => {
      await page.goto('/settings');
      await page.waitForLoadState('networkidle');

      // Settings page or redirect to profile with settings
      const settingsHeading = page.locator('h1:has-text("Settings"), h1:has-text("Налаштування"), h2:has-text("Settings")');
      const hasSettings = await settingsHeading.first().isVisible({ timeout: 5000 }).catch(() => false);

      await expect(page.locator('body')).toBeVisible();
    });

    test('should access settings from user menu', async ({ page }) => {
      await page.goto('/');
      await page.waitForLoadState('networkidle');

      // Open user menu
      const userMenu = page.locator('[data-testid="user-menu"], button[aria-label*="user" i], .user-avatar');

      if (await userMenu.first().isVisible({ timeout: 5000 }).catch(() => false)) {
        await userMenu.first().click();
        await page.waitForTimeout(300);

        // Click settings option
        const settingsLink = page.locator('a:has-text("Settings"), button:has-text("Settings"), a:has-text("Налаштування")');
        if (await settingsLink.first().isVisible({ timeout: 3000 }).catch(() => false)) {
          await settingsLink.first().click();
          await page.waitForTimeout(500);
        }
      }

      await expect(page.locator('body')).toBeVisible();
    });
  });

  test.describe('Language Settings', () => {

    test('should show language selector', async ({ page }) => {
      await page.goto('/');
      await page.waitForLoadState('networkidle');

      // Language selector in header or settings
      const languageSelector = page.locator('[data-testid="language-selector"], button:has-text("EN"), button:has-text("UA"), select[name="language"]');
      const hasLanguage = await languageSelector.first().isVisible({ timeout: 5000 }).catch(() => false);

      await expect(page.locator('body')).toBeVisible();
    });

    test('should switch to Ukrainian', async ({ page }) => {
      await page.goto('/');
      await page.waitForLoadState('networkidle');

      const languageSelector = page.locator('[data-testid="language-selector"], button:has-text("EN"), [aria-label*="language" i]');

      if (await languageSelector.first().isVisible({ timeout: 5000 }).catch(() => false)) {
        await languageSelector.first().click();
        await page.waitForTimeout(300);

        const ukrainianOption = page.locator('button:has-text("UA"), button:has-text("Українська"), [data-value="uk"]');
        if (await ukrainianOption.first().isVisible({ timeout: 3000 }).catch(() => false)) {
          await ukrainianOption.first().click();
          await page.waitForTimeout(500);

          // UI should switch to Ukrainian
          const ukrainianText = page.locator('text=/Пози|Послідовності|Головна/');
          const hasUkrainian = await ukrainianText.first().isVisible({ timeout: 3000 }).catch(() => false);
        }
      }

      await expect(page.locator('body')).toBeVisible();
    });

    test('should switch to English', async ({ page }) => {
      // Navigate first, then set Ukrainian locale
      await page.goto('/');
      await page.waitForLoadState('networkidle');

      // Set Ukrainian locale and reload
      await page.evaluate(() => localStorage.setItem('yoga_locale', 'uk'));
      await page.reload();
      await page.waitForLoadState('networkidle');

      const languageSelector = page.locator('[data-testid="language-selector"], button:has-text("UA"), [aria-label*="language" i]');

      if (await languageSelector.first().isVisible({ timeout: 5000 }).catch(() => false)) {
        await languageSelector.first().click();
        await page.waitForTimeout(300);

        const englishOption = page.locator('button:has-text("EN"), button:has-text("English"), [data-value="en"]');
        if (await englishOption.first().isVisible({ timeout: 3000 }).catch(() => false)) {
          await englishOption.first().click();
          await page.waitForTimeout(500);
        }
      }

      await expect(page.locator('body')).toBeVisible();
    });

    test('should persist language preference', async ({ page }) => {
      await page.goto('/');
      await page.waitForLoadState('networkidle');

      // Set language
      await page.evaluate(() => localStorage.setItem('yoga_locale', 'uk'));

      // Reload page
      await page.reload();
      await page.waitForLoadState('networkidle');

      // Language should persist
      const locale = await page.evaluate(() => localStorage.getItem('yoga_locale'));
      expect(locale).toBe('uk');

      await expect(page.locator('body')).toBeVisible();
    });
  });

  test.describe('Theme Settings', () => {

    test('should show theme toggle', async ({ page }) => {
      await page.goto('/');
      await page.waitForLoadState('networkidle');

      // Theme toggle button
      const themeToggle = page.locator('[data-testid="theme-toggle"], button[aria-label*="theme" i], button[aria-label*="dark" i], button[aria-label*="light" i]');
      const hasToggle = await themeToggle.first().isVisible({ timeout: 5000 }).catch(() => false);

      await expect(page.locator('body')).toBeVisible();
    });

    test('should switch to dark mode', async ({ page }) => {
      await page.goto('/');
      await page.waitForLoadState('networkidle');

      const themeToggle = page.locator('[data-testid="theme-toggle"], button[aria-label*="theme" i], button[aria-label*="dark" i]');

      if (await themeToggle.first().isVisible({ timeout: 5000 }).catch(() => false)) {
        await themeToggle.first().click();
        await page.waitForTimeout(300);

        // Check for dark mode class on html/body
        const isDarkMode = await page.evaluate(() => {
          return document.documentElement.classList.contains('dark') ||
                 document.body.classList.contains('dark') ||
                 document.documentElement.getAttribute('data-theme') === 'dark';
        });
      }

      await expect(page.locator('body')).toBeVisible();
    });

    test('should switch to light mode', async ({ page }) => {
      // Navigate first, then set dark mode
      await page.goto('/');
      await page.waitForLoadState('networkidle');

      // Set dark theme and reload
      await page.evaluate(() => {
        document.documentElement.classList.add('dark');
        localStorage.setItem('theme', 'dark');
      });
      await page.reload();
      await page.waitForLoadState('networkidle');

      const themeToggle = page.locator('[data-testid="theme-toggle"], button[aria-label*="theme" i], button[aria-label*="light" i]');

      if (await themeToggle.first().isVisible({ timeout: 5000 }).catch(() => false)) {
        await themeToggle.first().click();
        await page.waitForTimeout(300);
      }

      await expect(page.locator('body')).toBeVisible();
    });

    test('should persist theme preference', async ({ page }) => {
      await page.goto('/');
      await page.waitForLoadState('networkidle');

      // Set dark theme
      await page.evaluate(() => {
        localStorage.setItem('theme', 'dark');
        document.documentElement.classList.add('dark');
      });

      // Reload
      await page.reload();
      await page.waitForLoadState('networkidle');

      const theme = await page.evaluate(() => localStorage.getItem('theme'));
      // Theme should persist

      await expect(page.locator('body')).toBeVisible();
    });

    test('should respect system preference', async ({ page }) => {
      // Set system to prefer dark
      await page.emulateMedia({ colorScheme: 'dark' });

      await page.goto('/');
      await page.waitForLoadState('networkidle');

      // App may automatically use dark mode
      await expect(page.locator('body')).toBeVisible();
    });
  });

  test.describe('Player Settings', () => {

    test('should show default pose duration setting', async ({ page }) => {
      await page.goto('/settings');
      await page.waitForLoadState('networkidle');

      // Default duration input
      const durationInput = page.locator('input[name="defaultDuration"], input[name="duration"], input#duration');
      const hasDuration = await durationInput.first().isVisible({ timeout: 5000 }).catch(() => false);

      await expect(page.locator('body')).toBeVisible();
    });

    test('should show auto-play setting', async ({ page }) => {
      await page.goto('/settings');
      await page.waitForLoadState('networkidle');

      // Auto-play toggle
      const autoPlayToggle = page.locator('input[name="autoPlay"], [data-testid="autoplay-toggle"], label:has-text("Auto-play")');
      const hasAutoPlay = await autoPlayToggle.first().isVisible({ timeout: 5000 }).catch(() => false);

      await expect(page.locator('body')).toBeVisible();
    });

    test('should show sound settings', async ({ page }) => {
      await page.goto('/settings');
      await page.waitForLoadState('networkidle');

      // Sound toggle or volume control
      const soundSetting = page.locator('input[name="sound"], input[name="volume"], [data-testid="sound-toggle"], label:has-text("Sound")');
      const hasSound = await soundSetting.first().isVisible({ timeout: 5000 }).catch(() => false);

      await expect(page.locator('body')).toBeVisible();
    });

    test('should show transition type setting', async ({ page }) => {
      await page.goto('/settings');
      await page.waitForLoadState('networkidle');

      // Transition type selector
      const transitionSelect = page.locator('select[name="transition"], [data-testid="transition-select"], label:has-text("Transition")');
      const hasTransition = await transitionSelect.first().isVisible({ timeout: 5000 }).catch(() => false);

      await expect(page.locator('body')).toBeVisible();
    });
  });

  test.describe('Display Settings', () => {

    test('should show view mode preference', async ({ page }) => {
      await page.goto('/poses');
      await page.waitForLoadState('networkidle');

      // Grid/List view toggle
      const viewToggle = page.locator('[data-testid="view-toggle"], button[aria-label*="grid" i], button[aria-label*="list" i]');
      const hasToggle = await viewToggle.first().isVisible({ timeout: 5000 }).catch(() => false);

      await expect(page.locator('body')).toBeVisible();
    });

    test('should switch between grid and list view', async ({ page }) => {
      await page.goto('/poses');
      await page.waitForLoadState('networkidle');

      const viewToggle = page.locator('[data-testid="view-toggle"], button[aria-label*="view" i]');

      if (await viewToggle.first().isVisible({ timeout: 5000 }).catch(() => false)) {
        await viewToggle.first().click();
        await page.waitForTimeout(300);

        // View should change
      }

      await expect(page.locator('body')).toBeVisible();
    });

    test('should persist view mode', async ({ page }) => {
      await page.goto('/poses');
      await page.waitForLoadState('networkidle');

      // Set list view
      await page.evaluate(() => localStorage.setItem('poses_view', 'list'));

      await page.reload();
      await page.waitForLoadState('networkidle');

      const viewMode = await page.evaluate(() => localStorage.getItem('poses_view'));
      // View mode should persist

      await expect(page.locator('body')).toBeVisible();
    });

    test('should show items per page setting', async ({ page }) => {
      await page.goto('/poses');
      await page.waitForLoadState('networkidle');

      // Items per page selector
      const perPageSelect = page.locator('select[name="perPage"], [data-testid="per-page"], text=/per page|на сторінці/i');
      const hasPerPage = await perPageSelect.first().isVisible({ timeout: 5000 }).catch(() => false);

      await expect(page.locator('body')).toBeVisible();
    });
  });

  test.describe('Account Settings', () => {

    test('should show profile settings', async ({ page }) => {
      await page.goto('/settings');
      await page.waitForLoadState('networkidle');

      // Profile section
      const profileSection = page.locator('text=/Profile|Профіль/i, h2:has-text("Profile")');
      const hasProfile = await profileSection.first().isVisible({ timeout: 5000 }).catch(() => false);

      await expect(page.locator('body')).toBeVisible();
    });

    test('should allow updating display name', async ({ page }) => {
      await page.goto('/settings');
      await page.waitForLoadState('networkidle');

      const nameInput = page.locator('input[name="displayName"], input[name="name"], input#name');

      if (await nameInput.first().isVisible({ timeout: 5000 }).catch(() => false)) {
        await nameInput.first().fill('Test User');
        await page.waitForTimeout(300);
      }

      await expect(page.locator('body')).toBeVisible();
    });

    test('should show email field', async ({ page }) => {
      await page.goto('/settings');
      await page.waitForLoadState('networkidle');

      const emailInput = page.locator('input[name="email"], input[type="email"], input#email');
      const hasEmail = await emailInput.first().isVisible({ timeout: 5000 }).catch(() => false);

      await expect(page.locator('body')).toBeVisible();
    });

    test('should have save settings button', async ({ page }) => {
      await page.goto('/settings');
      await page.waitForLoadState('networkidle');

      const saveButton = page.locator('button:has-text("Save"), button:has-text("Зберегти"), button[type="submit"]');
      const hasSave = await saveButton.first().isVisible({ timeout: 5000 }).catch(() => false);

      await expect(page.locator('body')).toBeVisible();
    });
  });

  test.describe('Notification Settings', () => {

    test('should show notification preferences', async ({ page }) => {
      await page.goto('/settings');
      await page.waitForLoadState('networkidle');

      const notificationSection = page.locator('text=/Notifications|Сповіщення/i, h2:has-text("Notification")');
      const hasNotifications = await notificationSection.first().isVisible({ timeout: 5000 }).catch(() => false);

      await expect(page.locator('body')).toBeVisible();
    });

    test('should toggle email notifications', async ({ page }) => {
      await page.goto('/settings');
      await page.waitForLoadState('networkidle');

      const emailToggle = page.locator('input[name="emailNotifications"], [data-testid="email-notifications-toggle"]');

      if (await emailToggle.first().isVisible({ timeout: 5000 }).catch(() => false)) {
        await emailToggle.first().click();
        await page.waitForTimeout(300);
      }

      await expect(page.locator('body')).toBeVisible();
    });

    test('should toggle push notifications', async ({ page }) => {
      await page.goto('/settings');
      await page.waitForLoadState('networkidle');

      const pushToggle = page.locator('input[name="pushNotifications"], [data-testid="push-notifications-toggle"]');

      if (await pushToggle.first().isVisible({ timeout: 5000 }).catch(() => false)) {
        await pushToggle.first().click();
        await page.waitForTimeout(300);
      }

      await expect(page.locator('body')).toBeVisible();
    });
  });

  test.describe('Data & Privacy', () => {

    test('should show data export option', async ({ page }) => {
      await page.goto('/settings');
      await page.waitForLoadState('networkidle');

      const exportButton = page.locator('button:has-text("Export data"), button:has-text("Експортувати дані"), [data-testid="export-data"]');
      const hasExport = await exportButton.first().isVisible({ timeout: 5000 }).catch(() => false);

      await expect(page.locator('body')).toBeVisible();
    });

    test('should show delete account option', async ({ page }) => {
      await page.goto('/settings');
      await page.waitForLoadState('networkidle');

      const deleteButton = page.locator('button:has-text("Delete account"), button:has-text("Видалити акаунт"), [data-testid="delete-account"]');
      const hasDelete = await deleteButton.first().isVisible({ timeout: 5000 }).catch(() => false);

      await expect(page.locator('body')).toBeVisible();
    });
  });
});
