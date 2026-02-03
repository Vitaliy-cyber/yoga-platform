import { test, expect } from '@playwright/test';
import { startHttpsProxyToHttp } from './https-proxy';

test.describe('HTTPS mixed-content regression (regeneration probe)', () => {
  test.use({ ignoreHTTPSErrors: true });

  let proxy: { url: string; close: () => Promise<void> } | null = null;

  test.beforeAll(async () => {
    proxy = await startHttpsProxyToHttp({
      listenHost: '127.0.0.1',
      listenPort: 3443,
      targetHost: '127.0.0.1',
      targetPort: 3000,
    });
  });

  test.afterAll(async () => {
    if (proxy) {
      await proxy.close();
      proxy = null;
    }
  });

  test('upgrades http signed_url to https and fetches image bytes', async ({ page }) => {
    if (!proxy) throw new Error('proxy not started');

    const pngBody = Buffer.from(
      // 1x1 transparent PNG
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO8p0m4AAAAASUVORK5CYII=',
      'base64'
    );

    await page.route('**/api/v1/poses/**', async (route) => {
      const url = new URL(route.request().url());

      if (url.pathname.endsWith('/signed-url')) {
        // Simulate the historical bug: backend returns an http:// signed URL even when page is https://
        const signedUrl = `http://127.0.0.1:3443${url.pathname.replace('/signed-url', '')}?expires=9999999999&user_id=1&sig=test&v=1`;
        await route.fulfill({
          status: 200,
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ signed_url: signedUrl, expires_at: 9999999999 }),
        });
        return;
      }

      // Image fetch (should be https://... after frontend sanitization)
      if (url.pathname.match(/^\/api\/v1\/poses\/\d+\/image\/(schema|photo)$/)) {
        await route.fulfill({
          status: 200,
          headers: {
            'content-type': 'image/png',
            'cache-control': 'private, max-age=86400',
          },
          body: pngBody,
        });
        return;
      }

      await route.fulfill({ status: 404, body: 'not mocked' });
    });

    await page.goto(`${proxy.url}/e2e-probe.html`, { waitUntil: 'domcontentloaded' });

    const result = await page.evaluate(async () => {
      const mod = await import('/src/services/api.ts');
      const { getSignedImageUrl } = mod as typeof import('../src/services/api');

      const photoUrl = await getSignedImageUrl(1, 'photo', { allowProxyFallback: false });
      const schemaUrl = await getSignedImageUrl(1, 'schema', { allowProxyFallback: false });

      const fetchOne = async (url: string) => {
        const res = await fetch(url);
        if (!res.ok) {
          throw new Error(`fetch failed: ${res.status}`);
        }
        const contentType = res.headers.get('content-type') || '';
        const size = (await res.arrayBuffer()).byteLength;
        return { url, contentType, size };
      };

      return {
        photo: await fetchOne(photoUrl),
        schema: await fetchOne(schemaUrl),
      };
    });

    expect(result.photo.url.startsWith('https://')).toBe(true);
    expect(result.schema.url.startsWith('https://')).toBe(true);
    expect(result.photo.contentType).toMatch(/image\/png/);
    expect(result.schema.contentType).toMatch(/image\/png/);
    expect(result.photo.size).toBeGreaterThan(0);
    expect(result.schema.size).toBeGreaterThan(0);
  });
});

