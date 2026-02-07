/**
 * Playwright Global Teardown
 *
 * This file runs ONCE after all tests to:
 * 1. Clean up signed image test data
 * 2. Preserve test data file for debugging
 */

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import {
  deleteCategory,
  deletePose,
  deleteSequence,
  login,
} from "./test-api.js";

// ES module __dirname equivalent
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Path to test data file
const TEST_DATA_FILE = path.join(__dirname, ".test-data.json");

async function globalTeardown(): Promise<void> {
  console.log("\n========================================");
  console.log("E2E Test Global Teardown");
  console.log("========================================\n");

  try {
    if (
      process.env.PLAYWRIGHT_CLEANUP === "1" &&
      fs.existsSync(TEST_DATA_FILE)
    ) {
      const raw = fs.readFileSync(TEST_DATA_FILE, "utf-8");
      const data = JSON.parse(raw) as {
        created?: {
          // Legacy
          poseId?: number;
          categoryId?: number;
          // Core suite
          coreCategoryId?: number;
          corePoseIds?: number[];
          coreSequenceId?: number;
        };
      };

      if (data.created) {
        await login();

        // Core cleanup (sequence first -> poses -> category)
        if (data.created.coreSequenceId) {
          await deleteSequence(data.created.coreSequenceId).catch(() => {});
        }
        if (data.created.corePoseIds?.length) {
          for (const poseId of data.created.corePoseIds) {
            await deletePose(poseId).catch(() => {});
          }
        }
        if (data.created.coreCategoryId) {
          await deleteCategory(data.created.coreCategoryId).catch(() => {});
        }

        // Legacy/signed-image cleanup
        if (data.created.poseId) {
          await deletePose(data.created.poseId).catch(() => {});
        }
        if (data.created.categoryId) {
          await deleteCategory(data.created.categoryId).catch(() => {});
        }
      }
    } else {
      console.log(
        "[global-teardown] Preserving core/signed E2E seed data (set PLAYWRIGHT_CLEANUP=1 to delete).",
      );
    }

    // Preserve test data cache file for debugging
    if (fs.existsSync(TEST_DATA_FILE)) {
      console.log("Test data file preserved for debugging:", TEST_DATA_FILE);
    }

    console.log("\n========================================");
    console.log("Global Teardown Complete!");
    console.log("========================================\n");
  } catch (error) {
    console.warn("Teardown warning:", (error as Error).message);
    // Don't throw - teardown should never fail the test run
  }
}

export default globalTeardown;
