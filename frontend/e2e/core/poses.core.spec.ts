import { test, expect } from '@playwright/test';
import { getCorePoseIdA, getCorePoseIdB } from '../test-data';

test.describe('Poses (core)', () => {
  test('poses gallery renders and shows seeded poses', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 720 });

    await page.goto('/');
    await page.getByTestId('nav-poses').click();
    await expect(page).toHaveURL('/poses');

    await expect(page.getByTestId('pose-gallery-count')).toBeVisible();

    const poseAId = getCorePoseIdA();
    if (poseAId) {
      await expect(page.getByTestId(`pose-card-${poseAId}`)).toBeVisible();
    }
  });

  test('search filters poses deterministically', async ({ page }) => {
    const poseAId = getCorePoseIdA();
    const poseBId = getCorePoseIdB();
    test.skip(!poseAId || !poseBId, 'Core seed data not available');

    await page.goto('/poses');
    await expect(page.getByTestId('pose-gallery-count')).toBeVisible();

    await page.getByTestId('pose-search-input').fill('E2E Core Pose A');
    await expect(page.getByTestId(`pose-card-${poseAId!}`)).toBeVisible();
    await expect(page.getByTestId(`pose-card-${poseBId!}`)).toHaveCount(0);
  });

  test('pose detail shows schema image for seeded pose', async ({ page }) => {
    const poseAId = getCorePoseIdA();
    test.skip(!poseAId, 'Core seed pose not available');

    await page.goto(`/poses/${poseAId}`);
    await expect(page.getByTestId('pose-schema-image')).toBeVisible();
    await expect(page.getByTestId('pose-schema-image')).toHaveAttribute('src', /.+/);
  });
});
