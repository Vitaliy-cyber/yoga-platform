/**
 * Test Data Helper
 *
 * Provides access to EXISTING data fetched by global-setup.ts.
 * Tests use this to get IDs of existing entities instead of hardcoding.
 *
 * NO FAKE DATA IS CREATED - tests work with real existing data!
 */

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import type { TestDataStore } from "./test-api.js";

// ES module __dirname equivalent
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Path to test data file
const TEST_DATA_FILE = path.join(__dirname, ".test-data.json");

// Cached test data
let cachedData: TestDataStore | null = null;

/**
 * Load test data from file
 */
export function loadTestData(): TestDataStore {
  if (cachedData) {
    return cachedData;
  }

  if (!fs.existsSync(TEST_DATA_FILE)) {
    console.warn(
      "[test-data] Test data file not found. Tests may skip data-dependent assertions.",
    );
    return {
      categories: [],
      poses: [],
      sequences: [],
      muscles: [],
    };
  }

  try {
    const data = JSON.parse(fs.readFileSync(TEST_DATA_FILE, "utf-8"));
    cachedData = data;
    return data;
  } catch (error) {
    console.error("[test-data] Failed to load test data:", error);
    return {
      categories: [],
      poses: [],
      sequences: [],
      muscles: [],
    };
  }
}

/**
 * Get a pose by ID
 */
export function getPoseById(
  id: number,
): { id: number; name: string; code: string } | undefined {
  const data = loadTestData();
  return data.poses.find((p) => p.id === id);
}

/**
 * Get a category by ID
 */
export function getCategoryById(
  id: number,
): { id: number; name: string } | undefined {
  const data = loadTestData();
  return data.categories.find((c) => c.id === id);
}

/**
 * Get a sequence by ID
 */
export function getSequenceById(
  id: number,
): { id: number; name: string } | undefined {
  const data = loadTestData();
  return data.sequences.find((s) => s.id === id);
}

/**
 * Get all poses
 */
export function getAllPoses(): Array<{
  id: number;
  name: string;
  code: string;
}> {
  return loadTestData().poses;
}

export function getCreatedPoseId(): number | null {
  const data = loadTestData();
  return data.created?.poseId ?? null;
}

export function getCreatedCategoryId(): number | null {
  const data = loadTestData();
  return data.created?.categoryId ?? null;
}

export function getCoreCategoryId(): number | null {
  const data = loadTestData();
  return data.created?.coreCategoryId ?? null;
}

export function getCorePoseIds(): number[] {
  const data = loadTestData();
  return data.created?.corePoseIds ?? [];
}

export function getCorePoseIdA(): number | null {
  const ids = getCorePoseIds();
  return ids[0] ?? null;
}

export function getCorePoseIdB(): number | null {
  const ids = getCorePoseIds();
  return ids[1] ?? null;
}

export function getCoreSequenceId(): number | null {
  const data = loadTestData();
  return data.created?.coreSequenceId ?? null;
}

/**
 * Get all categories
 */
export function getAllCategories(): Array<{ id: number; name: string }> {
  return loadTestData().categories;
}

/**
 * Get all sequences
 */
export function getAllSequences(): Array<{ id: number; name: string }> {
  return loadTestData().sequences;
}

/**
 * Get first pose ID (for tests that need "any pose")
 * Returns 1 as fallback if no poses exist
 */
export function getFirstPoseId(): number {
  const data = loadTestData();
  if (data.poses.length === 0) {
    console.warn("[test-data] No poses available, using ID 1 as fallback");
    return 1;
  }
  return data.poses[0].id;
}

/**
 * Get first two pose IDs (for comparison tests)
 */
export function getTwoPoseIds(): [number, number] {
  const data = loadTestData();
  if (data.poses.length < 2) {
    console.warn(
      "[test-data] Need at least 2 poses for comparison, using IDs 1, 2 as fallback",
    );
    return [1, 2];
  }
  return [data.poses[0].id, data.poses[1].id];
}

/**
 * Get first sequence ID
 * Returns 1 as fallback if no sequences exist
 */
export function getFirstSequenceId(): number {
  const data = loadTestData();
  if (data.sequences.length === 0) {
    console.warn("[test-data] No sequences available, using ID 1 as fallback");
    return 1;
  }
  return data.sequences[0].id;
}

/**
 * Get first category ID
 * Returns 1 as fallback if no categories exist
 */
export function getFirstCategoryId(): number {
  const data = loadTestData();
  if (data.categories.length === 0) {
    console.warn("[test-data] No categories available, using ID 1 as fallback");
    return 1;
  }
  return data.categories[0].id;
}

/**
 * Check if test data is available (any poses or sequences exist)
 */
export function hasTestData(): boolean {
  const data = loadTestData();
  return data.poses.length > 0 || data.sequences.length > 0;
}

/**
 * Check if we have poses
 */
export function hasPoses(): boolean {
  return loadTestData().poses.length > 0;
}

/**
 * Check if we have sequences
 */
export function hasSequences(): boolean {
  return loadTestData().sequences.length > 0;
}

/**
 * Check if we have categories
 */
export function hasCategories(): boolean {
  return loadTestData().categories.length > 0;
}

/**
 * Get pose count
 */
export function getPoseCount(): number {
  return loadTestData().poses.length;
}

/**
 * Get sequence count
 */
export function getSequenceCount(): number {
  return loadTestData().sequences.length;
}

/**
 * Get a random pose (useful for varied testing)
 */
export function getRandomPose():
  | { id: number; name: string; code: string }
  | undefined {
  const data = loadTestData();
  if (data.poses.length === 0) return undefined;
  const randomIndex = Math.floor(Math.random() * data.poses.length);
  return data.poses[randomIndex];
}

/**
 * Get a random sequence
 */
export function getRandomSequence(): { id: number; name: string } | undefined {
  const data = loadTestData();
  if (data.sequences.length === 0) return undefined;
  const randomIndex = Math.floor(Math.random() * data.sequences.length);
  return data.sequences[randomIndex];
}
