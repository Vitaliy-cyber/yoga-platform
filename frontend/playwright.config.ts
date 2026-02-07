import { defineConfig, devices } from "@playwright/test";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Force IPv4 loopback by default.
// In some sandboxed environments, connections to IPv6 localhost (::1) can fail with EPERM,
// causing flaky "connection refused / backend unhealthy" failures.
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
const PLAYWRIGHT_E2E_FAST_AI = process.env.PLAYWRIGHT_E2E_FAST_AI ?? "1";

/**
 * Playwright configuration for Yoga Platform E2E tests.
 * Tests run against REAL API (no mocks) for accurate integration testing.
 *
 * The test system is SELF-SUFFICIENT:
 * - global-setup.ts creates all test data (categories, poses, sequences)
 * - Tests use dynamic IDs from test-data.ts
 * - global-teardown.ts cleans up after tests
 *
 * @see https://playwright.dev/docs/test-configuration
 */
export default defineConfig({
  // Core E2E suite (small + deterministic). Legacy/generated specs remain in ./e2e
  // and can be run via playwright.legacy.config.ts.
  testDir: "./e2e/core",

  /* Global setup - creates test data before all tests */
  globalSetup: path.join(__dirname, "e2e", "global-setup.ts"),

  /* Global teardown - cleans up test data after all tests */
  globalTeardown: path.join(__dirname, "e2e", "global-teardown.ts"),

  /* Run tests in files in parallel */
  fullyParallel: true,

  /* Fail the build on CI if you accidentally left test.only in the source code. */
  forbidOnly: !!process.env.CI,

  /* Retry on CI only */
  retries: process.env.CI ? 2 : 0,

  /* Limit workers to avoid overwhelming the API */
  workers: process.env.CI ? 1 : 4,

  /* Reporter to use. See https://playwright.dev/docs/test-reporters */
  reporter: [["html", { outputFolder: "playwright-report" }], ["list"]],

  /* Shared settings for all the projects below. See https://playwright.dev/docs/api/class-testoptions. */
  use: {
    /* Base URL to use in actions like `await page.goto('/')`. */
    baseURL: PLAYWRIGHT_BASE_URL,

    /* Collect trace when retrying the failed test. See https://playwright.dev/docs/trace-viewer */
    trace: "on-first-retry",

    /* Screenshot on failure */
    screenshot: "only-on-failure",

    /* Video recording */
    video: "on-first-retry",
  },

  /* Configure projects for major browsers */
  projects: [
    /* Setup project for authentication state */
    {
      name: "setup",
      testMatch: /.*\.setup\.ts/,
    },

    {
      name: "chromium",
      use: {
        ...devices["Desktop Chrome"],
        // Use saved auth state from setup
        storageState: "playwright/.auth/user.json",
      },
      dependencies: ["setup"],
    },

    /* Skip other browsers for faster testing with real API */
    // Uncomment for full cross-browser testing:
    // {
    //   name: 'firefox',
    //   use: { ...devices['Desktop Firefox'] },
    //   dependencies: ['setup'],
    // },
    // {
    //   name: 'webkit',
    //   use: { ...devices['Desktop Safari'] },
    //   dependencies: ['setup'],
    // },
  ],

  /* Start backend + frontend locally (disable backend via PLAYWRIGHT_START_BACKEND=0) */
  webServer: process.env.CI
    ? undefined
    : [
        ...(process.env.PLAYWRIGHT_START_BACKEND === "0"
          ? []
          : [
              (() => {
                const dbPath =
                  process.env.PLAYWRIGHT_DB_PATH ||
                  "/tmp/yoga_platform_pw_e2e_persist.db";
                const sqliteUrl = dbPath.startsWith("/")
                  ? `sqlite+aiosqlite:////${dbPath.slice(1)}`
                  : `sqlite+aiosqlite:////${dbPath}`;
                const resetPrefix =
                  process.env.PLAYWRIGHT_RESET_DB === "1"
                    ? `rm -f ${dbPath} && `
                    : "";

                return {
                  command:
                    process.env.PLAYWRIGHT_BACKEND === "mock"
                      ? `PORT=${PLAYWRIGHT_API_PORT} exec node e2e/mock-backend/server.mjs`
                      : `${resetPrefix}APP_MODE=dev E2E_FAST_AI=${PLAYWRIGHT_E2E_FAST_AI} AIOSQLITE_INLINE=1 LOG_LEVEL=WARNING DATABASE_URL=${sqliteUrl} STORAGE_BACKEND=local exec .venv/bin/python -m uvicorn main:app --host 127.0.0.1 --port ${PLAYWRIGHT_API_PORT} --log-level warning --no-proxy-headers`,
                  cwd:
                    process.env.PLAYWRIGHT_BACKEND === "mock"
                      ? __dirname
                      : path.join(__dirname, "..", "backend"),
                  url: `${PLAYWRIGHT_API_URL}/health`,
                  reuseExistingServer: true,
                  timeout: 120 * 1000,
                };
              })(),
            ]),
        ...(process.env.PLAYWRIGHT_START_FRONTEND === "0"
          ? []
          : [
              {
                // Run Vite directly (not via `npm run dev`) so Playwright can reliably terminate
                // the process on teardown. `npm` can leave child processes behind.
                command:
                  "exec node node_modules/vite/bin/vite.js --host 127.0.0.1 --port 3000 --strictPort",
                url: PLAYWRIGHT_BASE_URL,
                reuseExistingServer: true,
                timeout: 120 * 1000,
              },
            ]),
      ],

  /* Timeout for each test */
  timeout: 30 * 1000,

  /* Timeout for expect assertions */
  expect: {
    timeout: 10 * 1000,
  },
});
