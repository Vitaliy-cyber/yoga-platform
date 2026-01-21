/**
 * Playwright Global Setup
 *
 * This file runs ONCE before all tests to:
 * 1. Authenticate with the test token
 * 2. Fetch EXISTING data (categories, poses, sequences)
 * 3. Save data IDs for use in tests
 *
 * NO FAKE DATA IS CREATED - tests work with real existing data!
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import {
  login,
  fetchExistingData,
  type TestDataStore,
} from './test-api.js';

// ES module __dirname equivalent
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Path to store test data info for use in tests
const TEST_DATA_FILE = path.join(__dirname, '.test-data.json');

async function globalSetup(): Promise<void> {
  console.log('\n========================================');
  console.log('E2E Test Global Setup');
  console.log('========================================\n');

  try {
    // 1. Authenticate
    console.log('Step 1: Authenticating...');
    await login();

    // 2. Fetch existing data (NO CREATION!)
    console.log('\nStep 2: Fetching existing data...');
    const testData = await fetchExistingData();

    // 3. Save test data to file for use in tests
    console.log('\nStep 3: Saving test data info...');
    saveTestData(testData);

    console.log('\n========================================');
    console.log('Global Setup Complete!');
    console.log('========================================\n');

    // Print summary
    console.log('Existing Data Found:');
    console.log(`  Categories: ${testData.categories.length}`);
    console.log(`  Poses: ${testData.poses.length}`);
    console.log(`  Sequences: ${testData.sequences.length}`);
    console.log(`  Muscles: ${testData.muscles.length}`);

    if (testData.poses.length === 0) {
      console.log('\n⚠️  WARNING: No poses found in database.');
      console.log('   Some tests may be skipped or fail.');
      console.log('   Please create some poses manually before running tests.\n');
    }

    if (testData.sequences.length === 0) {
      console.log('\n⚠️  WARNING: No sequences found in database.');
      console.log('   Some tests may be skipped or fail.');
      console.log('   Please create some sequences manually before running tests.\n');
    }

  } catch (error) {
    console.error('\n========================================');
    console.error('Global Setup FAILED!');
    console.error('========================================\n');
    console.error('Error:', error);

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
