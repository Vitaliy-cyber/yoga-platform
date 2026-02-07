import { test, expect } from "@playwright/test";
import { loginWithToken, authedFetch, safeJson } from "./atomic-http";
import { assertNo5xx } from "./atomic-helpers";
import { TEST_TOKEN, loginUser } from "../fixtures";

const API_BASE_URL = process.env.PLAYWRIGHT_API_URL || "http://127.0.0.1:8000";

async function waitForCompleted(accessToken: string, taskId: string, timeoutMs: number = 30_000) {
  const startedAt = Date.now();
  // eslint-disable-next-line no-constant-condition
  while (true) {
    const res = await authedFetch(accessToken, `/api/v1/generate/status/${taskId}`, { method: "GET" });
    assertNo5xx(res.status, "generate/status");
    expect(res.status).toBe(200);
    const json = (await safeJson(res)) as { status?: string; error_message?: string } | undefined;
    if (json?.status === "completed") return;
    if (json?.status === "failed") throw new Error(`generation failed: ${json?.error_message || "unknown"}`);
    if (Date.now() - startedAt > timeoutMs) throw new Error("generation timeout");
    // eslint-disable-next-line no-await-in-loop
    await new Promise((r) => setTimeout(r, 300));
  }
}

test.describe("Atomic UI: muscles tab renders a non-blank image", () => {
  test.describe.configure({ mode: "serial" });

  test("muscle layer loads and has some non-white pixels", async ({ page }) => {
    // IMPORTANT: UI atomic contexts are typically pre-authenticated via global setup
    // using TEST_TOKEN storageState. Use the same token for API calls so the UI user
    // has access to the created pose/images.
    const auth = await loginWithToken(TEST_TOKEN);
    const accessToken = auth.accessToken;

    const code = `UI_${Date.now().toString(36).slice(-8)}`.slice(0, 20);
    const createRes = await authedFetch(accessToken, "/api/v1/poses", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ code, name: `Atomic ${code}` }),
    });
    assertNo5xx(createRes.status, "create pose");
    expect(createRes.status).toBe(201);
    const created = (await safeJson(createRes)) as { id?: unknown } | undefined;
    expect(typeof created?.id).toBe("number");
    const poseId = created?.id as number;

    const tinyPng = Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR4nGNgYAAAAAMAASsJTYQAAAAASUVORK5CYII=",
      "base64",
    );
    const form = new FormData();
    form.append("file", new Blob([tinyPng], { type: "image/png" }), "schema.png");
    const schemaRes = await fetch(`${API_BASE_URL}/api/v1/poses/${poseId}/schema`, {
      method: "POST",
      headers: { Authorization: `Bearer ${accessToken}`, Accept: "application/json" },
      body: form,
    });
    expect(schemaRes.status).toBe(200);

    const genRes = await authedFetch(accessToken, `/api/v1/generate/from-pose/${poseId}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ additional_notes: "atomic ui sanity" }),
    });
    assertNo5xx(genRes.status, "generate/from-pose");
    expect(genRes.status).toBe(200);
    const genJson = (await safeJson(genRes)) as { task_id?: string } | undefined;
    const taskId = genJson?.task_id || "";
    expect(taskId).toBeTruthy();
    await waitForCompleted(accessToken, taskId, 30_000);

    const applyRes = await authedFetch(accessToken, `/api/v1/poses/${poseId}/apply-generation/${taskId}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
    });
    assertNo5xx(applyRes.status, "apply-generation");
    expect(applyRes.status).toBe(200);

    // Ensure UI is authenticated (atomic suite may already provide storageState).
    await loginUser(page, TEST_TOKEN);
    await page.goto(`/poses/${poseId}`, { waitUntil: "domcontentloaded" });
    await expect(page.locator('[data-testid="pose-tab-photo"]')).toBeVisible();

    const musclesTab = page.locator('[data-testid="pose-tab-muscles"]');
    await expect(musclesTab).toBeEnabled();

    const img = page.locator('[data-testid="pose-active-image"]');
    await expect(img).toBeVisible();
    const photoSrc = await img.getAttribute("src");
    expect(photoSrc).toBeTruthy();

    await musclesTab.click();
    // Wait for the tab switch to actually load a different image source.
    await expect.poll(async () => (await img.getAttribute("src")) || "", { timeout: 20_000 }).not.toBe(photoSrc as string);

    // Wait for image decode and ensure it has intrinsic size.
    await expect.poll(async () => {
      return img.evaluate((el) => (el as HTMLImageElement).naturalWidth || 0);
    }, { timeout: 20_000 }).toBeGreaterThan(0);

    // Pixel sanity: ensure the rendered image is not completely white/transparent.
    // Works because the image is same-origin (signed-url proxy or local storage), so canvas isn't tainted.
    const metrics = await img.evaluate(async (el) => {
      const image = el as HTMLImageElement;
      await image.decode().catch(() => undefined);
      const w = Math.min(image.naturalWidth || 0, 256);
      const h = Math.min(image.naturalHeight || 0, 256);
      if (!w || !h) return { nonWhiteRatio: 0, redRatio: 0, blueRatio: 0 };
      const canvas = document.createElement("canvas");
      canvas.width = w;
      canvas.height = h;
      const ctx = canvas.getContext("2d");
      if (!ctx) return { nonWhiteRatio: 0, redRatio: 0, blueRatio: 0 };
      ctx.drawImage(image, 0, 0, w, h);
      const data = ctx.getImageData(0, 0, w, h).data;
      let nonWhite = 0;
      let red = 0;
      let blue = 0;
      const total = w * h;
      for (let i = 0; i < data.length; i += 4) {
        const r = data[i]!;
        const g = data[i + 1]!;
        const b = data[i + 2]!;
        const a = data[i + 3]!;
        if (a < 5) continue;
        if (r < 245 || g < 245 || b < 245) nonWhite += 1;
        const isRed = r > 180 && g < 120 && b < 120 && r - g > 60 && r - b > 60;
        const isBlue = b > 180 && r < 120 && g < 120 && b - r > 60 && b - g > 60;
        if (isRed) red += 1;
        if (isBlue) blue += 1;
      }
      return total
        ? { nonWhiteRatio: nonWhite / total, redRatio: red / total, blueRatio: blue / total }
        : { nonWhiteRatio: 0, redRatio: 0, blueRatio: 0 };
    });

    expect(metrics.nonWhiteRatio).toBeGreaterThan(0.001);
    // Muscle visualization should include at least some red/blue highlight pixels.
    expect(metrics.redRatio + metrics.blueRatio).toBeGreaterThan(0.0005);

    await authedFetch(accessToken, `/api/v1/poses/${poseId}`, { method: "DELETE" }).catch(() => undefined);
  });
});
