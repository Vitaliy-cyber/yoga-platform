import { test, expect } from "@playwright/test";

import { gotoWithRetry } from "./atomic-helpers";
import { getCorePoseIdA, getCorePoseIdB, getCoreSequenceId } from "../test-data";

type ViewportCase = {
  id: string;
  width: number;
  height: number;
};

type RouteCase = {
  id: string;
  path: string;
  expectTestId: string;
  requires?: "poseA" | "poseAB" | "sequence";
};

const viewports: ViewportCase[] = [
  { id: "desktop-1920x1080", width: 1920, height: 1080 },
  { id: "laptop-1366x768", width: 1366, height: 768 },
  { id: "tablet-1024x1366", width: 1024, height: 1366 },
  { id: "mobile-390x844", width: 390, height: 844 },
];

const routes: RouteCase[] = [
  { id: "dashboard", path: "/", expectTestId: "dashboard-view-grid" },
  { id: "poses", path: "/poses", expectTestId: "pose-gallery-count" },
  { id: "upload", path: "/upload", expectTestId: "upload-pose-name" },
  { id: "generate", path: "/generate", expectTestId: "generate-submit" },
  { id: "sequences", path: "/sequences", expectTestId: "sequence-new" },
  { id: "sequence-new", path: "/sequences/new", expectTestId: "sequence-name" },
  { id: "settings", path: "/settings", expectTestId: "settings-locale-en" },
  {
    id: "pose-detail",
    path: "/poses/__POSE_A__",
    expectTestId: "pose-schema-image",
    requires: "poseA",
  },
  {
    id: "compare",
    path: "/compare?poses=__POSE_A__,__POSE_B__",
    expectTestId: "compare-tabs",
    requires: "poseAB",
  },
  {
    id: "sequence-detail",
    path: "/sequences/__SEQ__",
    expectTestId: "sequence-edit",
    requires: "sequence",
  },
];

function resolveRoutePath(routePath: string): string {
  const poseA = getCorePoseIdA();
  const poseB = getCorePoseIdB();
  const sequenceId = getCoreSequenceId();

  return routePath
    .replace("__POSE_A__", String(poseA ?? ""))
    .replace("__POSE_B__", String(poseB ?? ""))
    .replace("__SEQ__", String(sequenceId ?? ""));
}

function shouldSkipRoute(route: RouteCase): string | null {
  const poseA = getCorePoseIdA();
  const poseB = getCorePoseIdB();
  const sequenceId = getCoreSequenceId();

  if (route.requires === "poseA" && !poseA) {
    return "Missing seeded core pose A";
  }
  if (route.requires === "poseAB" && (!poseA || !poseB)) {
    return "Missing seeded core poses A/B";
  }
  if (route.requires === "sequence" && !sequenceId) {
    return "Missing seeded core sequence";
  }
  return null;
}

async function expectNoFatalUiSignals(page: import("@playwright/test").Page): Promise<void> {
  const body = page.locator("body");
  await expect(body).not.toContainText(/Unhandled Runtime Error/i);
  await expect(body).not.toContainText(/Application error/i);
  await expect(body).not.toContainText(/Something went wrong/i);
  await expect(body).not.toContainText(/Internal Server Error/i);
  await expect(body).not.toContainText(/^Cannot GET /i);
}

test.describe("Class-A Atomic UI route x viewport matrix", () => {
  // 10 routes * 4 viewports = 40 additional atomic E2E tests.
  for (const viewport of viewports) {
    for (const route of routes) {
      test(`[${viewport.id}] ${route.id} renders stable UI`, async ({ page }) => {
        const skipReason = shouldSkipRoute(route);
        if (skipReason) {
          test.skip(true, skipReason);
        }

        await page.setViewportSize({
          width: viewport.width,
          height: viewport.height,
        });

        await gotoWithRetry(page, resolveRoutePath(route.path), {
          timeoutMs: 60_000,
          waitUntil: "domcontentloaded",
        });

        await expect(page).not.toHaveURL(/\/login(?:\?|#|$)/, { timeout: 30_000 });
        await expect(page.getByTestId(route.expectTestId)).toBeVisible({
          timeout: 60_000,
        });
        await expectNoFatalUiSignals(page);
      });
    }
  }
});
