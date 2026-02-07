import { expect, type Page } from "@playwright/test";
import fs from "fs/promises";
import path from "path";

export async function installUnhandledRejectionProbe(page: Page): Promise<void> {
  await page.addInitScript(() => {
    (window as any).__atomicUnhandled = [];
    window.addEventListener("unhandledrejection", (event) => {
      (window as any).__atomicUnhandled.push({
        reason: String((event as PromiseRejectionEvent).reason || "unknown"),
      });
    });
  });
}

export async function getUnhandled(page: Page): Promise<unknown[]> {
  return page.evaluate(() => (window as any).__atomicUnhandled || []);
}

export function watchPageErrors(page: Page): { get: () => string[] } {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  return { get: () => errors };
}

export function watchApi5xx(page: Page): { get: () => Array<{ url: string; status: number }> } {
  const bad: Array<{ url: string; status: number }> = [];
  page.on("response", (res) => {
    const url = res.url();
    if (!url.includes("/api/v1/")) return;
    const status = res.status();
    if (status >= 500) bad.push({ url, status });
  });
  return { get: () => bad };
}

export async function expectNoClientCrash(opts: {
  page: Page;
  pageErrors: { get: () => string[] };
  api5xx: { get: () => Array<{ url: string; status: number }> };
  label: string;
}): Promise<void> {
  const unhandled = await getUnhandled(opts.page);
  expect(opts.pageErrors.get(), `${opts.label}: pageerror indicates a client crash`).toEqual([]);
  expect(unhandled, `${opts.label}: unhandledrejection indicates broken cleanup`).toEqual([]);
  expect(opts.api5xx.get(), `${opts.label}: API 5xx detected`).toEqual([]);
}

export async function downloadToBuffer(
  page: Page,
  action: () => Promise<void>,
  timeoutMs: number = 60_000,
): Promise<{ buffer: Buffer; filePath: string; suggestedFilename: string }> {
  const downloadPromise = page.waitForEvent("download", { timeout: timeoutMs });
  await action();
  const download = await downloadPromise;
  const suggestedFilename = download.suggestedFilename();
  const filePath = path.join(
    "/tmp",
    `pw-download-${Date.now()}-${Math.random().toString(16).slice(2)}-${suggestedFilename}`,
  );
  await download.saveAs(filePath);
  const buffer = await fs.readFile(filePath);
  return { buffer, filePath, suggestedFilename };
}

export function parseJsonBuffer(buffer: Buffer): unknown {
  const text = buffer.toString("utf-8").trim();
  return JSON.parse(text);
}

function splitCsvLine(line: string): string[] {
  const out: string[] = [];
  let cur = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i];
    if (ch === '"') {
      const next = line[i + 1];
      if (inQuotes && next === '"') {
        cur += '"';
        i += 1;
        continue;
      }
      inQuotes = !inQuotes;
      continue;
    }
    if (ch === "," && !inQuotes) {
      out.push(cur);
      cur = "";
      continue;
    }
    cur += ch;
  }
  out.push(cur);
  return out;
}

export function parseCsvBuffer(buffer: Buffer): { header: string[]; rows: string[][]; raw: string } {
  const raw = buffer.toString("utf-8").replace(/\r\n/g, "\n");
  if (raw.includes("\u0000")) throw new Error("CSV contains NUL byte");
  const lines = raw.split("\n").filter((l) => l.length > 0);
  if (!lines.length) throw new Error("CSV is empty");
  const header = splitCsvLine(lines[0]);
  if (header.length < 2) throw new Error(`CSV header too small: ${header.join(",")}`);
  const rows = lines.slice(1).map(splitCsvLine);
  return { header, rows, raw };
}

export function assertPdfSmoke(buffer: Buffer): void {
  const head = buffer.subarray(0, 8).toString("ascii");
  if (!head.startsWith("%PDF-")) {
    throw new Error(`Not a PDF (header=${JSON.stringify(head)})`);
  }
  if (buffer.length < 200) {
    throw new Error(`PDF too small (${buffer.length} bytes)`);
  }
  const tail = buffer.subarray(Math.max(0, buffer.length - 4096)).toString("ascii");
  if (!tail.includes("%%EOF")) {
    throw new Error("PDF missing %%EOF trailer");
  }
}

