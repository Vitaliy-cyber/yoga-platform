import { defineConfig, devices } from "@playwright/test";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
process.env.PLAYWRIGHT_BASE_URL ??= "http://127.0.0.1:3000";
process.env.PLAYWRIGHT_API_URL ??= "http://127.0.0.1:8001";

const PLAYWRIGHT_BASE_URL = process.env.PLAYWRIGHT_BASE_URL;
const PLAYWRIGHT_API_URL = process.env.PLAYWRIGHT_API_URL;
const parsedApiUrl = new URL(PLAYWRIGHT_API_URL);
const PLAYWRIGHT_API_PORT = parsedApiUrl.port
  ? Number(parsedApiUrl.port)
  : parsedApiUrl.protocol === "https:"
    ? 443
    : 80;

/**
 * Legacy Playwright configuration.
 *
 * Runs the full (mostly broad/heuristic) E2E suite in `./e2e`.
 * The default `playwright.config.ts` runs a smaller, deterministic core suite.
 */
export default defineConfig({
  testDir: "./e2e",
  globalSetup: path.join(__dirname, "e2e", "global-setup.ts"),
  globalTeardown: path.join(__dirname, "e2e", "global-teardown.ts"),
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : 4,
  reporter: [["html", { outputFolder: "playwright-report" }], ["list"]],
  use: {
    baseURL: PLAYWRIGHT_BASE_URL,
    trace: "on-first-retry",
    screenshot: "only-on-failure",
    video: "on-first-retry",
  },
  projects: [
    { name: "setup", testMatch: /.*\.setup\.ts/ },
    {
      name: "chromium",
      use: {
        ...devices["Desktop Chrome"],
        storageState: "playwright/.auth/user.json",
      },
      dependencies: ["setup"],
    },
  ],
  webServer: process.env.CI
    ? undefined
    : [
        ...(process.env.PLAYWRIGHT_START_BACKEND === "0"
          ? []
          : [
              {
                command:
                  process.env.PLAYWRIGHT_BACKEND === "mock"
                    ? "node e2e/mock-backend/server.mjs"
                    : `rm -f /tmp/yoga_platform_pw_e2e.db && APP_MODE=dev E2E_FAST_AI=1 DATABASE_URL=sqlite+aiosqlite:////tmp/yoga_platform_pw_e2e.db STORAGE_BACKEND=local .venv/bin/python -m uvicorn main:app --host 127.0.0.1 --port ${PLAYWRIGHT_API_PORT}`,
                cwd:
                  process.env.PLAYWRIGHT_BACKEND === "mock"
                    ? __dirname
                    : path.join(__dirname, "..", "backend"),
                url: `${PLAYWRIGHT_API_URL}/health`,
                reuseExistingServer: true,
                timeout: 120 * 1000,
              },
            ]),
        {
          command: "npm run dev",
          url: PLAYWRIGHT_BASE_URL,
          reuseExistingServer: true,
          timeout: 120 * 1000,
        },
      ],
  timeout: 30 * 1000,
  expect: { timeout: 10 * 1000 },
});
