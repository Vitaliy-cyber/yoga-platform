/**
 * Playwright Global Teardown
 *
 * This file runs ONCE after all tests to:
 * 1. Clean up signed image test data
 * 2. Preserve test data file for debugging
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { deleteCategory, deletePose, login } from './test-api.js';

// ES module __dirname equivalent
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Path to test data file
const TEST_DATA_FILE = path.join(__dirname, '.test-data.json');

async function globalTeardown(): Promise<void> {
  console.log('\n========================================');
  console.log('E2E Test Global Teardown');
  console.log('========================================\n');

  try {
    if (fs.existsSync(TEST_DATA_FILE)) {
      const raw = fs.readFileSync(TEST_DATA_FILE, 'utf-8');
      const data = JSON.parse(raw) as { created?: { poseId?: number; categoryId?: number } };
      if (data.created?.poseId || data.created?.categoryId) {
        await login();
        if (data.created.poseId) {
          await deletePose(data.created.poseId);
        }
        if (data.created.categoryId) {
          await deleteCategory(data.created.categoryId);
        }
      }
    }

    // Preserve test data cache file for debugging
    if (fs.existsSync(TEST_DATA_FILE)) {
      console.log('Test data file preserved for debugging:', TEST_DATA_FILE);
    }

    console.log('\n========================================');
    console.log('Global Teardown Complete!');
    console.log('========================================\n');

  } catch (error) {
    console.warn('Teardown warning:', (error as Error).message);
    // Don't throw - teardown should never fail the test run
  }
}

export default globalTeardown;
