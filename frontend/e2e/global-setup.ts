/**
 * Playwright Global Setup
 *
 * This file runs ONCE before all tests to:
 * 1. Authenticate with the test token
 * 2. Create data for signed image tests
 * 3. Fetch existing data (categories, poses, sequences)
 * 4. Save data IDs for use in tests
 */

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import {
  login,
  getAccessToken,
  fetchExistingData,
  seedMuscles,
  createCategory,
  createPose,
  createSequence,
  generateFromSchema,
  waitForGenerateCompleted,
  applyGenerationToPose,
  uploadPoseSchema,
  getCategories,
  getPoseByCode,
  getPose,
  getSequencesV1,
  deleteSequence,
  type TestDataStore,
} from "./test-api.js";

// ES module __dirname equivalent
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Path to store test data info for use in tests
const TEST_DATA_FILE = path.join(__dirname, ".test-data.json");

const API_BASE_URL = process.env.PLAYWRIGHT_API_URL || "http://localhost:8000";

const CORE_CATEGORY_NAME = "E2E Core";
const CORE_POSE_CODE_A = "E2E_CORE_A";
const CORE_POSE_CODE_B = "E2E_CORE_B";
const CORE_SEQUENCE_NAME = "E2E Core Sequence";
const SIGNED_CATEGORY_NAME = "E2E Signed Images";
const SIGNED_POSE_CODE = "E2E_SIGNED_IMG";

async function urlExists(urlPath: string): Promise<boolean> {
  const url = urlPath.startsWith("http")
    ? urlPath
    : `${API_BASE_URL}${urlPath}`;
  try {
    const res = await fetch(url, { method: "GET" });
    return res.ok;
  } catch {
    return false;
  }
}

function isValidPng(bytes: Uint8Array): boolean {
  // PNG signature: 89 50 4E 47 0D 0A 1A 0A
  const sig = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  if (bytes.length < sig.length) return false;
  for (let i = 0; i < sig.length; i += 1) {
    if (bytes[i] !== sig[i]) return false;
  }

  let off = 8;
  let sawIend = false;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);

  while (off + 8 <= bytes.length) {
    const len = view.getUint32(off, false);
    const type =
      String.fromCharCode(bytes[off + 4] || 0) +
      String.fromCharCode(bytes[off + 5] || 0) +
      String.fromCharCode(bytes[off + 6] || 0) +
      String.fromCharCode(bytes[off + 7] || 0);
    const chunkTotal = 12 + len;
    if (off + chunkTotal > bytes.length) return false;

    if (type === "IEND") {
      if (len !== 0) return false;
      sawIend = true;
      off += chunkTotal;
      break;
    }

    off += chunkTotal;
  }

  return sawIend && off === bytes.length;
}

async function urlIsValidPng(urlPath: string): Promise<boolean> {
  const url = urlPath.startsWith("http")
    ? urlPath
    : `${API_BASE_URL}${urlPath}`;
  const ctrl = new AbortController();
  const to = setTimeout(() => ctrl.abort(), 10_000);
  try {
    const res = await fetch(url, { method: "GET", signal: ctrl.signal });
    if (!res.ok) return false;
    const buf = new Uint8Array(await res.arrayBuffer());
    return isValidPng(buf);
  } catch {
    return false;
  } finally {
    clearTimeout(to);
  }
}

async function getOrCreateCategoryByName(
  name: string,
  description: string,
): Promise<{ id: number; name: string }> {
  const categories = await getCategories().catch(() => []);
  const existing = categories.find((c) => c.name === name);
  if (existing) return existing;
  return createCategory({ name, description });
}

async function getOrCreatePoseByCode(params: {
  code: string;
  name: string;
  category_id: number;
}): Promise<{ id: number; code: string }> {
  try {
    const existing = await getPoseByCode(params.code);
    return existing;
  } catch {
    return createPose(params);
  }
}

async function ensureSchema(poseId: number, pngBytes: Buffer): Promise<void> {
  const pose = await getPose(poseId);
  if (pose.schema_path && (await urlIsValidPng(pose.schema_path))) {
    console.log(`[global-setup] schema cache hit for pose ${poseId}`);
    return;
  }
  console.log(
    `[global-setup] schema cache miss for pose ${poseId}; uploading...`,
  );
  await uploadPoseSchema(poseId, pngBytes, "schema.png", "image/png");
}

async function ensureGeneratedLayers(
  poseId: number,
  pngBytes: Buffer,
): Promise<void> {
  const pose = await getPose(poseId);

  const photoOk = pose.photo_path ? await urlIsValidPng(pose.photo_path) : false;
  const musclesOk = pose.muscle_layer_path
    ? await urlIsValidPng(pose.muscle_layer_path)
    : false;

  if (photoOk && musclesOk) {
    console.log(`[global-setup] image cache hit for pose ${poseId}`);
    return;
  }
  console.log(
    `[global-setup] image cache miss for pose ${poseId}; generating layers...`,
  );

  const gen = await generateFromSchema(pngBytes, "schema.png", "image/png");
  await waitForGenerateCompleted(gen.task_id, 60_000);
  await applyGenerationToPose(poseId, gen.task_id);
}

async function ensureCoreSeedData(pngBytes: Buffer): Promise<{
  coreCategoryId: number;
  corePoseIds: number[];
  coreSequenceId: number;
  signedCategoryId: number;
  signedPoseId: number;
}> {
  // Core category + poses
  const coreCategory = await getOrCreateCategoryByName(
    CORE_CATEGORY_NAME,
    "Persistent deterministic seed data for core E2E suite",
  );

  const poseA = await getOrCreatePoseByCode({
    code: CORE_POSE_CODE_A,
    name: "E2E Core Pose A",
    category_id: coreCategory.id,
  });
  const poseB = await getOrCreatePoseByCode({
    code: CORE_POSE_CODE_B,
    name: "E2E Core Pose B",
    category_id: coreCategory.id,
  });

  await ensureSchema(poseA.id, pngBytes);
  await ensureSchema(poseB.id, pngBytes);

  // If local storage has no layers yet, generate once and keep forever.
  await ensureGeneratedLayers(poseA.id, pngBytes);
  await ensureGeneratedLayers(poseB.id, pngBytes);

  // Core sequence (best-effort idempotent)
  // Note: backend validates `limit <= 100`.
  const sequences = (
    await getSequencesV1(0, 100).catch(() => ({ items: [], total: 0 }))
  ).items;
  const matching = sequences.filter((s) => s.name === CORE_SEQUENCE_NAME);
  let coreSequence = matching[0];
  if (matching.length > 1) {
    // Keep the first (most recent) and delete duplicates.
    for (const extra of matching.slice(1)) {
      // eslint-disable-next-line no-await-in-loop
      await deleteSequence(extra.id).catch(() => undefined);
    }
  }
  if (!coreSequence) {
    coreSequence = await createSequence({
      name: CORE_SEQUENCE_NAME,
      description: "Persistent core seeded sequence with 2 poses",
      difficulty: "beginner",
      poses: [
        { pose_id: poseA.id, order_index: 0, duration_seconds: 30 },
        { pose_id: poseB.id, order_index: 1, duration_seconds: 45 },
      ],
    });
  } else {
    // Ensure it has the expected two poses; if not, recreate.
    try {
      const accessToken = getAccessToken();
      const detailsRes = await fetch(
        `${API_BASE_URL}/api/v1/sequences/${coreSequence.id}`,
        {
          method: "GET",
          headers: accessToken
            ? { Authorization: `Bearer ${accessToken}`, Accept: "application/json" }
            : { Accept: "application/json" },
        },
      );
      if (detailsRes.ok) {
        const details = (await detailsRes.json()) as {
          poses?: Array<{ pose_id: number }>;
        };
        const ids = new Set((details.poses || []).map((p) => p.pose_id));
        if (!(ids.has(poseA.id) && ids.has(poseB.id))) {
          await deleteSequence(coreSequence.id).catch(() => undefined);
          coreSequence = await createSequence({
            name: CORE_SEQUENCE_NAME,
            description: "Persistent core seeded sequence with 2 poses",
            difficulty: "beginner",
            poses: [
              { pose_id: poseA.id, order_index: 0, duration_seconds: 30 },
              { pose_id: poseB.id, order_index: 1, duration_seconds: 45 },
            ],
          });
        }
      }
    } catch {
      // ignore
    }
  }

  // Signed image data (schema only)
  const signedCategory = await getOrCreateCategoryByName(
    SIGNED_CATEGORY_NAME,
    "Persistent E2E signed image tests",
  );
  const signedPose = await getOrCreatePoseByCode({
    code: SIGNED_POSE_CODE,
    name: "E2E Signed Image Pose",
    category_id: signedCategory.id,
  });
  await ensureSchema(signedPose.id, pngBytes);

  return {
    coreCategoryId: coreCategory.id,
    corePoseIds: [poseA.id, poseB.id],
    coreSequenceId: coreSequence.id,
    signedCategoryId: signedCategory.id,
    signedPoseId: signedPose.id,
  };
}

async function waitForBackendReady(timeoutMs = 60_000): Promise<void> {
  const startedAt = Date.now();
  const healthUrl = `${API_BASE_URL}/health`;

  // eslint-disable-next-line no-constant-condition
  while (true) {
    try {
      const res = await fetch(healthUrl, { method: "GET" });
      if (res.ok) return;
    } catch {
      // ignore and retry
    }

    if (Date.now() - startedAt > timeoutMs) {
      throw new Error(
        `[global-setup] Backend not ready at ${healthUrl} after ${timeoutMs}ms`,
      );
    }
    await new Promise((r) => setTimeout(r, 1000));
  }
}

async function globalSetup(): Promise<void> {
  // Playwright's default outputDir is `test-results/` (for traces/videos/screenshots).
  // Under some parallel runs it may be missing when workers start; ensure it exists
  // to avoid ENOENT when creating `.playwright-artifacts-*` directories.
  try {
    fs.mkdirSync(path.join(__dirname, "..", "test-results"), { recursive: true });
  } catch {
    // best-effort
  }

  console.log("\n========================================");
  console.log("E2E Test Global Setup");
  console.log("========================================\n");

  try {
    console.log("Step 0: Waiting for backend...");
    await waitForBackendReady();

    // 1. Authenticate
    console.log("Step 1: Authenticating...");
    await login();

    // 2. Seed muscles (idempotent) - helps PoseDetail / muscle UI be usable in fresh DBs
    console.log("\nStep 2: Seeding muscles...");
    await seedMuscles().catch((err) => {
      console.warn(
        "[global-setup] seedMuscles warning:",
        (err as Error).message,
      );
    });

    // 3. Create deterministic core E2E data (category + 2 poses + sequence)
    console.log("\nStep 3: Creating core E2E seed data...");
    // Keep schema seed image at 64x64 to satisfy backend minimum upload constraints.
    const pngBase64 =
      "iVBORw0KGgoAAAANSUhEUgAAAEAAAABACAYAAACqaXHeAAAAJ0lEQVR42u3BAQ0AAADCoPdPbQ43oAAAAAAAAAAAAAAAAAAAAIB3A0BAAAGveg7oAAAAAElFTkSuQmCC";
    const pngBytes = Buffer.from(pngBase64, "base64");
    console.log(
      "\nStep 3b: Ensuring cached images exist (generate only if missing; never delete)...",
    );
    const seeded = await ensureCoreSeedData(pngBytes);

    // 5. Fetch existing data (includes what we just created)
    console.log("\nStep 5: Fetching existing data...");
    const testData = await fetchExistingData();
    testData.created = {
      // Legacy compatibility
      categoryId: seeded.signedCategoryId,
      poseId: seeded.signedPoseId,
      // Core suite
      coreCategoryId: seeded.coreCategoryId,
      corePoseIds: seeded.corePoseIds,
      coreSequenceId: seeded.coreSequenceId,
    };

    // 6. Save test data to file for use in tests
    console.log("\nStep 6: Saving test data info...");
    saveTestData(testData);

    console.log("\n========================================");
    console.log("Global Setup Complete!");
    console.log("========================================\n");

    // Print summary
    console.log("Existing Data Found:");
    console.log(`  Categories: ${testData.categories.length}`);
    console.log(`  Poses: ${testData.poses.length}`);
    console.log(`  Sequences: ${testData.sequences.length}`);
    console.log(`  Muscles: ${testData.muscles.length}`);

    if (testData.poses.length === 0) {
      console.log("\n⚠️  WARNING: No poses found in database.");
      console.log("   Some tests may be skipped or fail.");
      console.log(
        "   Please create some poses manually before running tests.\n",
      );
    }

    if (testData.sequences.length === 0) {
      console.log("\n⚠️  WARNING: No sequences found in database.");
      console.log("   Some tests may be skipped or fail.");
      console.log(
        "   Please create some sequences manually before running tests.\n",
      );
    }
  } catch (error) {
    console.error("\n========================================");
    console.error("Global Setup FAILED!");
    console.error("========================================\n");
    console.error("Error:", error);

    // Save empty data to prevent tests from crashing
    saveTestData({
      categories: [],
      poses: [],
      sequences: [],
      muscles: [],
    });

    throw error;
  }
}

function saveTestData(data: TestDataStore): void {
  // Ensure directory exists
  const dir = path.dirname(TEST_DATA_FILE);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  // Save to file
  fs.writeFileSync(TEST_DATA_FILE, JSON.stringify(data, null, 2));
  console.log(`Test data saved to: ${TEST_DATA_FILE}`);
}

export default globalSetup;
