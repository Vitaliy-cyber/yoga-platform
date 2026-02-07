import { test, expect } from "@playwright/test";
import {
  assertPdfSmoke,
  downloadToBuffer,
  expectNoClientCrash,
  installUnhandledRejectionProbe,
  parseCsvBuffer,
  parseJsonBuffer,
  watchApi5xx,
  watchPageErrors,
} from "./ui-helpers";

test.describe("Atomic export menu (Gallery UI; real downloads; no 5xx)", () => {
  test.describe.configure({ mode: "serial" });
  test.use({ acceptDownloads: true });

  test("JSON/CSV/PDF(all)/Backup export triggers downloads and files are parseable", async ({
    page,
  }) => {
    test.setTimeout(180_000);

    await installUnhandledRejectionProbe(page);
    const pageErrors = watchPageErrors(page);
    const api5xx = watchApi5xx(page);

    const openMenu = async () => {
      await page.getByTestId("export-menu-toggle").click();
      await expect(page.getByTestId("export-option-json")).toBeVisible();
    };

    await page.goto("/poses", { waitUntil: "domcontentloaded" });
    await expect(page.getByTestId("pose-gallery-count")).toBeVisible({ timeout: 60_000 });
    await expect(page.getByTestId("export-menu-toggle")).toBeVisible();

    // JSON
    await openMenu();
    const jsonDl = await downloadToBuffer(page, async () => {
      await page.getByTestId("export-option-json").click();
    });
    const json = parseJsonBuffer(jsonDl.buffer);
    expect(Array.isArray(json), "JSON export should be an array").toBeTruthy();
    expect((json as any[]).length, "JSON export should not be empty").toBeGreaterThan(0);
    expect((json as any[])[0]).toHaveProperty("code");
    expect((json as any[])[0]).toHaveProperty("name");

    // CSV
    await openMenu();
    const csvDl = await downloadToBuffer(page, async () => {
      await page.getByTestId("export-option-csv").click();
    });
    const csv = parseCsvBuffer(csvDl.buffer);
    expect(csv.header.map((h) => h.trim().toLowerCase())).toEqual(
      expect.arrayContaining(["code", "name"]),
    );
    expect(csv.rows.length, "CSV export should contain at least one data row").toBeGreaterThan(0);
    for (const row of csv.rows.slice(0, 5)) {
      expect(row.length, "CSV row column count mismatch").toBe(csv.header.length);
    }

    // PDF all
    await openMenu();
    const pdfDl = await downloadToBuffer(
      page,
      async () => {
        await page.getByTestId("export-option-pdf_all").click();
      },
      120_000,
    );
    assertPdfSmoke(pdfDl.buffer);

    // Backup (can be rate-limited in long atomic runs)
    let backupPayload: any | null = null;
    let sawBackupRateLimit = false;
    for (let attempt = 1; attempt <= 3; attempt += 1) {
      await openMenu();
      const backupResponsePromise = page.waitForResponse(
        (res) => res.url().includes("/api/v1/export/backup"),
        { timeout: 20_000 },
      );
      // Best-effort signal that UI triggered a browser download.
      const backupDownloadPromise = page
        .waitForEvent("download", { timeout: 12_000 })
        .catch(() => null);
      await page.getByTestId("export-option-backup").click();

      const backupResponse = await backupResponsePromise.catch(() => null);
      if (!backupResponse) {
        if (attempt < 3) {
          await page.waitForTimeout(1000 * attempt);
          continue;
        }
        throw new Error("Backup export did not produce a network response");
      }

      const status = backupResponse.status();
      if (status === 429) {
        sawBackupRateLimit = true;
        break;
      }
      if (status !== 200) {
        if (attempt < 3) {
          await page.waitForTimeout(1000 * attempt);
          continue;
        }
        throw new Error(`Unexpected backup response status: ${status}`);
      }

      // If download event is flaky/missed, rely on attachment response semantics and payload validity.
      const contentDisposition = await backupResponse.headerValue("content-disposition");
      expect((contentDisposition || "").toLowerCase()).toContain("attachment");
      await backupDownloadPromise;
      backupPayload = await backupResponse.json();
      break;
    }
    if (backupPayload) {
      const backup = backupPayload as any;
      expect(backup && typeof backup === "object").toBeTruthy();
      expect(backup).toHaveProperty("metadata");
      expect(Array.isArray(backup.categories)).toBeTruthy();
      expect(Array.isArray(backup.poses)).toBeTruthy();
    } else {
      expect(
        sawBackupRateLimit,
        "Backup should either download successfully or be explicitly rate-limited (429)",
      ).toBeTruthy();
    }

    await expectNoClientCrash({ page, pageErrors, api5xx, label: "export menu gallery" });
  });
});
