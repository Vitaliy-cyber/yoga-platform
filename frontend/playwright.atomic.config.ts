import baseConfig from "./playwright.config";

/**
 * Atomic suite:
 * - High-coverage, bulk/concurrent probes against real dev backend+frontend.
 * - Kept separate from the stable core suite to avoid slowing everyday runs.
 */
const baseWebServer = (baseConfig as unknown as { webServer?: unknown }).webServer;
const ATOMIC_WEB_SERVER_TIMEOUT = 240 * 1000;
const ATOMIC_REUSE_EXISTING_SERVER = process.env.PLAYWRIGHT_REUSE_EXISTING_SERVER === "1";

const atomicWebServer = Array.isArray(baseWebServer)
  ? baseWebServer.map((s) => ({
      ...(s as Record<string, unknown>),
      // Atomic runs are long; when Playwright "reuses" a server started by a previous run,
      // that previous run can still be tearing it down which makes the backend disappear mid-suite.
      // Default to owning the servers for this run; opt-in reuse via env for local workflows.
      reuseExistingServer: ATOMIC_REUSE_EXISTING_SERVER,
      timeout: ATOMIC_WEB_SERVER_TIMEOUT,
    }))
  : baseWebServer
    ? {
        ...(baseWebServer as Record<string, unknown>),
        reuseExistingServer: ATOMIC_REUSE_EXISTING_SERVER,
        timeout: ATOMIC_WEB_SERVER_TIMEOUT,
      }
    : baseWebServer;

export default {
  ...baseConfig,
  testDir: "./e2e/atomic",
  fullyParallel: false,
  workers: 1,
  // Atomic suites can be very large; keep reporting lightweight to avoid
  // accumulating huge in-memory HTML reports (can lead to OOM-kills).
  reporter: [["line"]],
  use: {
    ...(baseConfig as unknown as { use?: Record<string, unknown> }).use,
    trace: "off",
    video: "off",
  },
  // Atomic runs are long and can outlive a terminal-started dev server. Force Playwright to
  // spawn/own both servers so they can't disappear mid-run (connection refused flake).
  webServer: atomicWebServer,
  timeout: 90 * 1000,
  expect: {
    timeout: 20 * 1000,
  },
};
