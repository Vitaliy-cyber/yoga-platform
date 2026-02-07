import { test, expect } from "@playwright/test";
import {
  getCorePoseIdA,
  getCorePoseIdB,
  getCoreSequenceId,
} from "../test-data";

type RouteCase = {
  name: string;
  path: string;
  expectTestId?: string;
  skipIf?: () => boolean;
};

function withIds(): {
  poseA: number | null;
  poseB: number | null;
  sequenceId: number | null;
} {
  return {
    poseA: getCorePoseIdA(),
    poseB: getCorePoseIdB(),
    sequenceId: getCoreSequenceId(),
  };
}

const routeCases: RouteCase[] = [
  { name: "dashboard", path: "/", expectTestId: "nav-dashboard" },
  { name: "poses", path: "/poses", expectTestId: "pose-gallery-count" },
  { name: "upload", path: "/upload", expectTestId: "upload-pose-name" },
  { name: "generate", path: "/generate", expectTestId: "generate-submit" },
  { name: "sequences list", path: "/sequences", expectTestId: "sequence-new" },
  {
    name: "new sequence",
    path: "/sequences/new",
    expectTestId: "sequence-name",
  },
  { name: "settings", path: "/settings", expectTestId: "settings-locale-en" },

  {
    name: "pose detail (core A)",
    path: "/poses/__POSE_A__",
    expectTestId: "pose-schema-image",
    skipIf: () => !withIds().poseA,
  },
  {
    name: "compare (core A+B)",
    path: "/compare?poses=__POSE_A__,__POSE_B__",
    expectTestId: "compare-clear-all",
    skipIf: () => !withIds().poseA || !withIds().poseB,
  },
  {
    name: "sequence detail (core)",
    path: "/sequences/__SEQ__",
    expectTestId: "sequence-edit",
    skipIf: () => !withIds().sequenceId,
  },
];

test.describe("Routes smoke (core)", () => {
  for (const c of routeCases) {
    test(`loads: ${c.name}`, async ({ page }) => {
      if (c.skipIf?.()) test.skip(true, "Required seed IDs not available");

      const { poseA, poseB, sequenceId } = withIds();
      const resolved = c.path
        .replace("__POSE_A__", String(poseA ?? ""))
        .replace("__POSE_B__", String(poseB ?? ""))
        .replace("__SEQ__", String(sequenceId ?? ""));

      await page.goto(resolved);
      if (c.expectTestId) {
        await expect(page.getByTestId(c.expectTestId)).toBeVisible({
          timeout: 30_000,
        });
      }
    });
  }

  test("deep link: /poses keeps compare bar hidden by default", async ({
    page,
  }) => {
    await page.goto("/poses");
    await expect(page.getByTestId("compare-bar")).toHaveCount(0);
  });

  test("deep link: /compare shows tabs", async ({ page }) => {
    const { poseA, poseB } = withIds();
    test.skip(!poseA || !poseB, "Core seed poses not available");

    await page.goto(`/compare?poses=${poseA},${poseB}`);
    await expect(page.getByTestId("compare-tabs")).toBeVisible();
  });

  test("deep link: /sequences/new can create and then cancel via back nav", async ({
    page,
  }) => {
    await page.goto("/sequences/new");
    await expect(page.getByTestId("sequence-name")).toBeVisible();
    await page.goto("/sequences");
    await expect(page.getByTestId("sequence-new")).toBeVisible();
  });
});
