import { defineConfig, devices } from "@playwright/test";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

process.env.PLAYWRIGHT_API_URL ??= "http://127.0.0.1:8001";
const PLAYWRIGHT_API_URL = process.env.PLAYWRIGHT_API_URL;
const parsedApiUrl = new URL(PLAYWRIGHT_API_URL);
const PLAYWRIGHT_API_PORT = parsedApiUrl.port
  ? Number(parsedApiUrl.port)
  : parsedApiUrl.protocol === "https:"
    ? 443
    : 80;

export default defineConfig({
  testDir: "./e2e/atomic",
  fullyParallel: false,
  workers: 1,
  timeout: 90 * 1000,
  expect: { timeout: 20 * 1000 },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
  webServer: process.env.PLAYWRIGHT_START_BACKEND === "0"
    ? undefined
    : [
        (() => {
          const dbPath =
            process.env.PLAYWRIGHT_DB_PATH ||
            "/tmp/yoga_platform_pw_e2e_api.db";
          const sqliteUrl = dbPath.startsWith("/")
            ? `sqlite+aiosqlite:////${dbPath.slice(1)}`
            : `sqlite+aiosqlite:////${dbPath}`;
          const resetPrefix =
            process.env.PLAYWRIGHT_RESET_DB === "1"
              ? `rm -f ${dbPath} && `
              : "";

          return {
            command: `${resetPrefix}APP_MODE=dev E2E_FAST_AI=1 AIOSQLITE_INLINE=1 DATABASE_URL=${sqliteUrl} STORAGE_BACKEND=local exec .venv/bin/python -m uvicorn main:app --host 127.0.0.1 --port ${PLAYWRIGHT_API_PORT}`,
            cwd: path.join(__dirname, "..", "backend"),
            url: `${PLAYWRIGHT_API_URL}/health`,
            reuseExistingServer: false,
            timeout: 120 * 1000,
          };
        })(),
      ],
});
