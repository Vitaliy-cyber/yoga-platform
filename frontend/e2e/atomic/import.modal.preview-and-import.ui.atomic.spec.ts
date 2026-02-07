import { test, expect } from "@playwright/test";
import { TEST_TOKEN } from "../fixtures";
import { authedFetch, loginWithToken } from "./atomic-http";
import { assertNo5xx } from "./atomic-helpers";
import {
  expectNoClientCrash,
  installUnhandledRejectionProbe,
  watchApi5xx,
  watchPageErrors,
} from "./ui-helpers";

async function getPoseIdByCode(accessToken: string, code: string): Promise<number | null> {
  const res = await authedFetch(accessToken, `/api/v1/poses/code/${encodeURIComponent(code)}`);
  if (res.status === 404) return null;
  assertNo5xx(res.status, "poses/code");
  if (res.status !== 200) return null;
  const json = (await res.json()) as { id?: number };
  return typeof json.id === "number" ? json.id : null;
}

async function deletePoseByCode(accessToken: string, code: string): Promise<void> {
  const id = await getPoseIdByCode(accessToken, code);
  if (!id) return;
  await authedFetch(accessToken, `/api/v1/poses/${id}`, { method: "DELETE" }).catch(() => undefined);
}

test.describe("Atomic import modal (Gallery UI; preview/import; no 5xx)", () => {
  test.describe.configure({ mode: "serial" });
  test.use({ actionTimeout: 30_000 });

  test("JSON preview + import creates poses and UI remains stable", async ({ page }) => {
    test.setTimeout(180_000);

    await installUnhandledRejectionProbe(page);
    const pageErrors = watchPageErrors(page);
    const api5xx = watchApi5xx(page);

    const { accessToken } = await loginWithToken(TEST_TOKEN);
    expect(accessToken).toBeTruthy();

    const codeA = `UIJ${Date.now().toString(36).slice(-8)}A`.slice(0, 20);
    const codeB = `UIJ${Date.now().toString(36).slice(-8)}B`.slice(0, 20);
    const payload = [
      { code: codeA, name: `Atomic UI Import ${codeA}` },
      { code: codeB, name: `Atomic UI Import ${codeB}` },
    ];

    try {
      await page.goto("/poses", { waitUntil: "domcontentloaded" });
      await expect(page.getByTestId("import-open")).toBeVisible({ timeout: 60_000 });
      await page.getByTestId("import-open").click();
      await expect(page.getByTestId("import-dialog")).toBeVisible();

      await page.getByTestId("import-type-json").click();

      const fileInput = page.getByTestId("import-file-input");
      await expect(fileInput).toBeAttached();
      await fileInput.setInputFiles({
        name: "poses.json",
        mimeType: "application/json",
        buffer: Buffer.from(JSON.stringify(payload), "utf-8"),
      });
      await expect(page.getByText("poses.json")).toBeVisible({ timeout: 30_000 });

      await expect(page.getByTestId("import-preview")).toBeVisible();
      await page.getByTestId("import-preview").click();
      await expect(page.getByTestId("import-preview-result")).toBeVisible({ timeout: 60_000 });
      await expect(page.getByTestId("import-preview-result")).toContainText(codeA);

      await page.getByTestId("import-submit").click();
      await expect(page.getByTestId("import-result")).toBeVisible({ timeout: 120_000 });
      await page.getByTestId("import-close").click();

      expect(await getPoseIdByCode(accessToken, codeA)).toBeTruthy();
      expect(await getPoseIdByCode(accessToken, codeB)).toBeTruthy();

      await expectNoClientCrash({ page, pageErrors, api5xx, label: "import json preview+import" });
    } finally {
      await deletePoseByCode(accessToken, codeA);
      await deletePoseByCode(accessToken, codeB);
    }
  });

  test("CSV import creates a pose and UI remains stable", async ({ page }) => {
    test.setTimeout(180_000);

    await installUnhandledRejectionProbe(page);
    const pageErrors = watchPageErrors(page);
    const api5xx = watchApi5xx(page);

    const { accessToken } = await loginWithToken(TEST_TOKEN);
    expect(accessToken).toBeTruthy();

    const code = `UIC${Date.now().toString(36).slice(-10)}`.slice(0, 20);
    const name = `Atomic UI CSV ${code}`;
    const csv = `code,name\n${code},${name}\n`;

    try {
      await page.goto("/poses", { waitUntil: "domcontentloaded" });
      await page.getByTestId("import-open").click();
      await expect(page.getByTestId("import-dialog")).toBeVisible();

      await page.getByTestId("import-type-csv").click();
      const fileInput = page.getByTestId("import-file-input");
      await expect(fileInput).toBeAttached();
      await fileInput.setInputFiles({
        name: "poses.csv",
        mimeType: "text/csv",
        buffer: Buffer.from(csv, "utf-8"),
      });
      await expect(page.getByText("poses.csv")).toBeVisible({ timeout: 30_000 });

      await page.getByTestId("import-submit").click();
      await expect(page.getByTestId("import-result")).toBeVisible({ timeout: 120_000 });
      await page.getByTestId("import-close").click();

      expect(await getPoseIdByCode(accessToken, code)).toBeTruthy();
      await expectNoClientCrash({ page, pageErrors, api5xx, label: "import csv" });
    } finally {
      await deletePoseByCode(accessToken, code);
    }
  });

  test("Backup import creates a pose and UI remains stable", async ({ page }) => {
    test.setTimeout(180_000);

    await installUnhandledRejectionProbe(page);
    const pageErrors = watchPageErrors(page);
    const api5xx = watchApi5xx(page);

    const { accessToken } = await loginWithToken(TEST_TOKEN);
    expect(accessToken).toBeTruthy();

    const code = `UIB${Date.now().toString(36).slice(-10)}`.slice(0, 20);
    const backup = {
      metadata: {
        version: "1.0.0",
        exported_at: new Date().toISOString(),
        user_id: null,
        total_poses: 1,
        total_categories: 0,
      },
      categories: [],
      poses: [{ code, name: `Atomic UI Backup ${code}`, muscles: [] }],
    };

    try {
      await page.goto("/poses", { waitUntil: "domcontentloaded" });
      await page.getByTestId("import-open").click();
      await expect(page.getByTestId("import-dialog")).toBeVisible();

      await page.getByTestId("import-type-backup").click();
      const fileInput = page.getByTestId("import-file-input");
      await expect(fileInput).toBeAttached();
      await fileInput.setInputFiles({
        name: "backup.json",
        mimeType: "application/json",
        buffer: Buffer.from(JSON.stringify(backup), "utf-8"),
      });
      await expect(page.getByText("backup.json")).toBeVisible({ timeout: 30_000 });

      await page.getByTestId("import-submit").click();
      await expect(page.getByTestId("import-result")).toBeVisible({ timeout: 120_000 });
      await page.getByTestId("import-close").click();

      expect(await getPoseIdByCode(accessToken, code)).toBeTruthy();
      await expectNoClientCrash({ page, pageErrors, api5xx, label: "import backup" });
    } finally {
      await deletePoseByCode(accessToken, code);
    }
  });
});
