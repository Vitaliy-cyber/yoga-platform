/**
 * Playwright Global Teardown
 *
 * This file runs ONCE after all tests to:
 * 1. Clean up temporary test data file
 *
 * NO DATA IS DELETED FROM DATABASE - tests use real existing data!
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

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
    // Remove test data cache file (optional - can keep for debugging)
    if (fs.existsSync(TEST_DATA_FILE)) {
      // Keep the file for debugging - comment out if you want to delete
      // fs.unlinkSync(TEST_DATA_FILE);
      console.log('Test data file preserved for debugging:', TEST_DATA_FILE);
    }

    console.log('\n========================================');
    console.log('Global Teardown Complete!');
    console.log('No data deleted from database.');
    console.log('========================================\n');

  } catch (error) {
    console.warn('Teardown warning:', (error as Error).message);
    // Don't throw - teardown should never fail the test run
  }
}

export default globalTeardown;
