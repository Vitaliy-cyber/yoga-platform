import { test, expect } from "@playwright/test";
import { getCorePoseIdA, getCorePoseIdB, getCreatedPoseId } from "../test-data";
import { login, createSequence, deleteSequence } from "../test-api";

function parseNumericSuffix(testIdValue: string, prefix: string): number {
  if (!testIdValue.startsWith(prefix)) {
    throw new Error(
      `Unexpected testid: ${testIdValue} (expected prefix ${prefix})`,
    );
  }
  const raw = testIdValue.slice(prefix.length);
  const value = Number(raw);
  if (!Number.isFinite(value))
    throw new Error(`Failed parsing numeric id from: ${testIdValue}`);
  return value;
}

test.describe("Sequences builder (core)", () => {
  test.describe.configure({ mode: "serial" });

  let emptySequenceId: number | null = null;
  let filledSequenceId: number | null = null;

  test.beforeAll(async () => {
    const poseA = getCorePoseIdA();
    const poseB = getCorePoseIdB();
    if (!poseA || !poseB) return;

    await login();

    emptySequenceId = (
      await createSequence({
        name: `E2E Empty Sequence ${Date.now()}`,
        description: "Created by Playwright",
        difficulty: "beginner",
        poses: [],
      })
    ).id;

    filledSequenceId = (
      await createSequence({
        name: `E2E Filled Sequence ${Date.now()}`,
        description: "Created by Playwright",
        difficulty: "beginner",
        poses: [
          { pose_id: poseA, order_index: 0, duration_seconds: 30 },
          { pose_id: poseB, order_index: 1, duration_seconds: 45 },
        ],
      })
    ).id;
  });

  test.afterAll(async () => {
    await login().catch(() => undefined);
    if (filledSequenceId)
      await deleteSequence(filledSequenceId).catch(() => undefined);
    if (emptySequenceId)
      await deleteSequence(emptySequenceId).catch(() => undefined);
  });

  test("sequence list loads", async ({ page }) => {
    await page.goto("/sequences");
    await expect(page.getByTestId("sequence-new")).toBeVisible();
  });

  test("empty sequence shows empty state", async ({ page }) => {
    test.skip(!emptySequenceId, "Empty sequence not created");
    await page.goto(`/sequences/${emptySequenceId}`);
    await expect(page.getByTestId("sequence-builder")).toBeVisible();
    await expect(
      page.getByTestId("sequence-builder-add-first-pose"),
    ).toBeVisible();
  });

  test("empty sequence: can open picker", async ({ page }) => {
    test.skip(!emptySequenceId, "Empty sequence not created");
    await page.goto(`/sequences/${emptySequenceId}`);
    await page.getByTestId("sequence-builder-add-first-pose").click();
    await expect(page.getByTestId("sequence-pose-picker-search")).toBeVisible();
  });

  test("empty sequence: can add a pose via picker", async ({ page }) => {
    const poseA = getCorePoseIdA();
    test.skip(
      !emptySequenceId || !poseA,
      "Empty sequence or pose not available",
    );

    await page.goto(`/sequences/${emptySequenceId}`);
    await page.getByTestId("sequence-builder-add-first-pose").click();
    await expect(
      page.getByTestId(`sequence-pose-picker-option-${poseA}`),
    ).toBeVisible();
    await page.getByTestId(`sequence-pose-picker-option-${poseA}`).click();

    await expect(
      page.locator('[data-testid^="sequence-builder-item-"]'),
    ).toHaveCount(1);
  });

  test("filled sequence shows draggable items", async ({ page }) => {
    test.skip(!filledSequenceId, "Filled sequence not created");
    await page.goto(`/sequences/${filledSequenceId}`);
    await expect(page.getByTestId("sequence-builder")).toBeVisible();
    await expect(
      page.locator('[data-testid^="sequence-builder-item-"]'),
    ).toHaveCount(2);
  });

  test("filled sequence: can edit duration and save changes", async ({
    page,
  }) => {
    test.skip(!filledSequenceId, "Filled sequence not created");
    await page.goto(`/sequences/${filledSequenceId}`);

    const firstItem = page
      .locator('[data-testid^="sequence-builder-item-"]')
      .first();
    const firstTestId = await firstItem.getAttribute("data-testid");
    expect(firstTestId).not.toBeNull();

    const seqPoseId = parseNumericSuffix(
      firstTestId!,
      "sequence-builder-item-",
    );
    await page.getByTestId(`sequence-builder-edit-${seqPoseId}`).click();
    await page.getByTestId(`sequence-builder-duration-${seqPoseId}`).fill("55");
    await page.getByTestId(`sequence-builder-edit-save-${seqPoseId}`).click();

    await expect(
      page.getByTestId("sequence-builder-save-changes"),
    ).toBeVisible();
    await page.getByTestId("sequence-builder-save-changes").click();
    await expect(page.getByTestId("sequence-builder-save-changes")).toHaveCount(
      0,
    );
  });

  test("filled sequence: can add an extra pose", async ({ page }) => {
    const signedPoseId = getCreatedPoseId();
    test.skip(
      !filledSequenceId || !signedPoseId,
      "Filled sequence or signed pose not available",
    );

    await page.goto(`/sequences/${filledSequenceId}`);
    await expect(
      page.locator('[data-testid^="sequence-builder-item-"]'),
    ).toHaveCount(2);

    await page.getByTestId("sequence-builder-add-pose").click();
    await expect(page.getByTestId("sequence-pose-picker-search")).toBeVisible();
    await page
      .getByTestId("sequence-pose-picker-search")
      .fill("E2E Signed Image Pose");
    await expect(
      page.getByTestId(`sequence-pose-picker-option-${signedPoseId}`),
    ).toBeVisible();
    await page
      .getByTestId(`sequence-pose-picker-option-${signedPoseId}`)
      .click();

    await expect(
      page.locator('[data-testid^="sequence-builder-item-"]'),
    ).toHaveCount(3);
  });

  test("filled sequence: can remove a pose", async ({ page }) => {
    test.skip(!filledSequenceId, "Filled sequence not created");
    await page.goto(`/sequences/${filledSequenceId}`);

    const items = page.locator('[data-testid^="sequence-builder-item-"]');
    const initialCount = await items.count();
    test.skip(initialCount < 2, "Not enough poses to remove");

    const lastItem = items.nth(initialCount - 1);
    const lastTestId = await lastItem.getAttribute("data-testid");
    expect(lastTestId).not.toBeNull();
    const seqPoseId = parseNumericSuffix(lastTestId!, "sequence-builder-item-");

    await page.getByTestId(`sequence-builder-remove-${seqPoseId}`).click();
    await expect(
      page.locator('[data-testid^="sequence-builder-item-"]'),
    ).toHaveCount(initialCount - 1);
  });

  test("sequence detail: can enter edit mode", async ({ page }) => {
    test.skip(!filledSequenceId, "Filled sequence not created");
    await page.goto(`/sequences/${filledSequenceId}`);
    await expect(page.getByTestId("sequence-edit")).toBeVisible({
      timeout: 30_000,
    });
    await page.getByTestId("sequence-edit").click();
    await expect(page.getByTestId("sequence-edit-name")).toBeVisible();
  });

  test("sequence detail: can edit name and save", async ({ page }) => {
    test.skip(!filledSequenceId, "Filled sequence not created");
    const newName = `E2E Renamed ${Date.now()}`;

    await page.goto(`/sequences/${filledSequenceId}`);
    await page.getByTestId("sequence-edit").click();
    await page.getByTestId("sequence-edit-name").fill(newName);
    await page.getByTestId("sequence-save").click();

    await expect(
      page.getByRole("heading", { name: newName, exact: true }),
    ).toBeVisible();
  });
});
