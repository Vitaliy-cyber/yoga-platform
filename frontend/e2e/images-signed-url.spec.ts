import { test, expect } from '@playwright/test';
import { getCreatedPoseId } from './test-data';
import { getPoseImageSignedUrl, login } from './test-api';

test('signed image url loads in img tag', async ({ page, request }) => {
  const poseId = getCreatedPoseId();
  if (!poseId) {
    test.skip();
  }

  await login();
  const { signed_url } = await getPoseImageSignedUrl(poseId, 'schema');

  const response = await request.get(signed_url);
  expect(response.ok()).toBeTruthy();
  const contentType = response.headers()['content-type'] || '';
  expect(contentType).toMatch(/image\//);

  await page.goto('/');
  const loaded = await page.evaluate((url) => {
    return new Promise<boolean>((resolve) => {
      const img = new Image();
      img.onload = () => resolve(img.naturalWidth > 0);
      img.onerror = () => resolve(false);
      img.src = url;
      document.body.appendChild(img);
    });
  }, signed_url);

  expect(loaded).toBe(true);
});
