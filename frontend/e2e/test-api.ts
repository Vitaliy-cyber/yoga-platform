/**
 * E2E Test API Client
 *
 * Direct HTTP client for fetching existing data.
 * Uses fetch() instead of the frontend's axios to avoid browser dependencies.
 *
 * This client is used by global-setup.ts to fetch existing data before tests run.
 * NO FAKE DATA IS CREATED - tests work with real existing data!
 */

// Read API URL from environment or default to localhost
const API_BASE_URL = process.env.PLAYWRIGHT_API_URL || 'http://localhost:8000';
const API_V1_PREFIX = '/api/v1';

// Test token - same as in fixtures.ts
const TEST_TOKEN = process.env.E2E_TEST_TOKEN || 'e2e-test-token-playwright-2024';

// Store access token after login
let accessToken: string | null = null;

/**
 * Interface definitions for API responses
 */
interface LoginResponse {
  access_token: string;
  refresh_token?: string;
  expires_in: number;
  user: {
    id: number;
    token: string;
    display_name?: string;
  };
}

interface Category {
  id: number;
  name: string;
  description?: string;
  pose_count?: number;
}

interface Muscle {
  id: number;
  name: string;
  name_ua?: string;
  body_part?: string;
}

interface Pose {
  id: number;
  code: string;
  name: string;
  name_en?: string;
  category_id?: number;
  category_name?: string;
  description?: string;
  schema_path?: string;
  photo_path?: string;
}

interface Sequence {
  id: number;
  name: string;
  description?: string;
  difficulty: 'beginner' | 'intermediate' | 'advanced';
  duration_seconds: number;
  pose_count?: number;
}

/**
 * Test data store - holds IDs of existing data
 */
export interface TestDataStore {
  categories: Category[];
  poses: Pose[];
  sequences: Sequence[];
  muscles: Muscle[];
}

/**
 * Sleep helper for retry delays
 */
function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Helper function for API requests with auth and retry logic for rate limiting
 */
async function apiRequest<T>(
  method: string,
  path: string,
  body?: unknown,
  retries: number = 3
): Promise<T> {
  const url = `${API_BASE_URL}${path}`;
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'Accept-Language': 'uk',
  };

  if (accessToken) {
    headers['Authorization'] = `Bearer ${accessToken}`;
  }

  for (let attempt = 1; attempt <= retries; attempt++) {
    const response = await fetch(url, {
      method,
      headers,
      body: body ? JSON.stringify(body) : undefined,
    });

    // Handle rate limiting with retry
    if (response.status === 429) {
      const retryAfter = parseInt(response.headers.get('Retry-After') || '15', 10);
      const waitTime = Math.min(retryAfter * 1000, 30000); // Max 30 seconds
      console.log(`[test-api] Rate limited, waiting ${waitTime/1000}s before retry ${attempt}/${retries}...`);

      if (attempt < retries) {
        await sleep(waitTime);
        continue;
      }
      // On last attempt, throw the error
      const errorText = await response.text();
      throw new Error(`API error ${response.status}: ${errorText}`);
    }

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`API error ${response.status}: ${errorText}`);
    }

    // Handle 204 No Content
    if (response.status === 204) {
      return undefined as T;
    }

    return response.json() as Promise<T>;
  }

  throw new Error('Max retries exceeded');
}

/**
 * Authenticate with the test token
 */
export async function login(): Promise<LoginResponse> {
  console.log('[test-api] Logging in with test token...');

  const response = await apiRequest<LoginResponse>(
    'POST',
    `${API_V1_PREFIX}/auth/login`,
    { token: TEST_TOKEN }
  );

  accessToken = response.access_token;
  console.log(`[test-api] Logged in as user ${response.user.id}`);

  return response;
}

/**
 * Get current access token (for use in tests)
 */
export function getAccessToken(): string | null {
  return accessToken;
}

// ============ Fetch Existing Data ============

/**
 * Get all categories
 */
export async function getCategories(): Promise<Category[]> {
  return apiRequest<Category[]>('GET', `${API_V1_PREFIX}/categories`);
}

/**
 * Get all poses (paginated)
 */
export async function getPoses(skip = 0, limit = 100): Promise<{ items: Pose[]; total: number }> {
  return apiRequest<{ items: Pose[]; total: number }>('GET', `${API_V1_PREFIX}/poses?skip=${skip}&limit=${limit}`);
}

/**
 * Get all sequences (paginated)
 */
export async function getSequences(skip = 0, limit = 100): Promise<{ items: Sequence[]; total: number }> {
  return apiRequest<{ items: Sequence[]; total: number }>('GET', `/api/sequences?skip=${skip}&limit=${limit}`);
}

/**
 * Get all muscles
 */
export async function getMuscles(): Promise<Muscle[]> {
  return apiRequest<Muscle[]>('GET', `${API_V1_PREFIX}/muscles`);
}

/**
 * Fetch all existing data from the database
 * NO DATA IS CREATED - only fetches what already exists!
 */
export async function fetchExistingData(): Promise<TestDataStore> {
  console.log('[test-api] Fetching existing data (no creation)...');

  const store: TestDataStore = {
    categories: [],
    poses: [],
    sequences: [],
    muscles: [],
  };

  // 1. Fetch categories
  try {
    store.categories = await getCategories();
    console.log(`[test-api] Found ${store.categories.length} categories`);
  } catch (error) {
    console.log('[test-api] Error fetching categories:', error);
  }

  // 2. Fetch poses
  try {
    const posesResponse = await getPoses(0, 500);
    store.poses = posesResponse.items;
    console.log(`[test-api] Found ${store.poses.length} poses (total: ${posesResponse.total})`);
  } catch (error) {
    console.log('[test-api] Error fetching poses:', error);
  }

  // 3. Fetch sequences
  try {
    const sequencesResponse = await getSequences(0, 100);
    store.sequences = sequencesResponse.items;
    console.log(`[test-api] Found ${store.sequences.length} sequences (total: ${sequencesResponse.total})`);
  } catch (error) {
    console.log('[test-api] Error fetching sequences:', error);
  }

  // 4. Fetch muscles
  try {
    store.muscles = await getMuscles();
    console.log(`[test-api] Found ${store.muscles.length} muscles`);
  } catch (error) {
    console.log('[test-api] Error fetching muscles:', error);
  }

  return store;
}

/**
 * Check if any data exists
 */
export async function hasTestData(): Promise<boolean> {
  try {
    const poses = await getPoses(0, 1);
    return poses.total > 0;
  } catch {
    return false;
  }
}
