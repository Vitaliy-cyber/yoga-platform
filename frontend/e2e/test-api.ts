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
const API_BASE_URL = process.env.PLAYWRIGHT_API_URL || "http://localhost:8000";
const API_V1_PREFIX = "/api/v1";

// Test token - same as in fixtures.ts
const TEST_TOKEN =
  process.env.E2E_TEST_TOKEN || "e2e-test-token-playwright-2024";

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
  muscle_layer_path?: string;
  skeleton_layer_path?: string;
  version?: number;
}

interface Sequence {
  id: number;
  name: string;
  description?: string;
  difficulty: "beginner" | "intermediate" | "advanced";
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
  created?: {
    // Legacy fields (used by older specs)
    categoryId?: number;
    poseId?: number;
    // Core deterministic suite fields
    coreCategoryId?: number;
    corePoseIds?: number[];
    coreSequenceId?: number;
  };
}

/**
 * Sleep helper for retry delays
 */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Helper function for API requests with auth and retry logic for rate limiting
 */
async function apiRequest<T>(
  method: string,
  path: string,
  body?: unknown,
  retries: number = 3,
): Promise<T> {
  const url = `${API_BASE_URL}${path}`;
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    "Accept-Language": "uk",
  };

  if (accessToken) {
    headers["Authorization"] = `Bearer ${accessToken}`;
  }

  for (let attempt = 1; attempt <= retries; attempt++) {
    let response: Response | null = null;
    try {
      response = await fetch(url, {
        method,
        headers,
        body: body ? JSON.stringify(body) : undefined,
      });
    } catch (err) {
      // Backend can restart between Playwright projects (setup -> chromium) or during heavy atomic runs.
      // Treat transient connection errors as retryable so atomic suites remain focused on real 5xx/regressions.
      if (attempt < retries) {
        const waitTime = 250 + attempt * 250;
        console.log(
          `[test-api] Network error (${String((err as Error)?.message || err)}), waiting ${waitTime}ms before retry ${attempt}/${retries}...`,
        );
        // eslint-disable-next-line no-await-in-loop
        await sleep(waitTime);
        continue;
      }
      throw err;
    }

    // Handle rate limiting with retry
    if (response.status === 429) {
      const retryAfter = parseInt(
        response.headers.get("Retry-After") || "15",
        10,
      );
      const waitTime = Math.min(retryAfter * 1000, 30000); // Max 30 seconds
      console.log(
        `[test-api] Rate limited, waiting ${waitTime / 1000}s before retry ${attempt}/${retries}...`,
      );

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

  throw new Error("Max retries exceeded");
}

/**
 * Authenticate with the test token
 */
export async function login(): Promise<LoginResponse> {
  console.log("[test-api] Logging in with test token...");

  const response = await apiRequest<LoginResponse>(
    "POST",
    `${API_V1_PREFIX}/auth/login`,
    { token: TEST_TOKEN },
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
  return apiRequest<Category[]>("GET", `${API_V1_PREFIX}/categories`);
}

/**
 * Get all poses (paginated)
 */
export async function getPoses(
  skip = 0,
  limit = 100,
): Promise<{ items: Pose[]; total: number }> {
  return apiRequest<{ items: Pose[]; total: number }>(
    "GET",
    `${API_V1_PREFIX}/poses?skip=${skip}&limit=${limit}`,
  );
}

export async function getPose(poseId: number): Promise<Pose> {
  return apiRequest<Pose>("GET", `${API_V1_PREFIX}/poses/${poseId}`);
}

export async function getPoseByCode(code: string): Promise<Pose> {
  return apiRequest<Pose>(
    "GET",
    `${API_V1_PREFIX}/poses/code/${encodeURIComponent(code)}`,
  );
}

/**
 * Get all sequences (paginated)
 */
export async function getSequences(
  skip = 0,
  limit = 100,
): Promise<{ items: Sequence[]; total: number }> {
  return apiRequest<{ items: Sequence[]; total: number }>(
    "GET",
    `/api/sequences?skip=${skip}&limit=${limit}`,
  );
}

export async function getSequencesV1(
  skip = 0,
  limit = 100,
): Promise<{ items: Sequence[]; total: number }> {
  return apiRequest<{ items: Sequence[]; total: number }>(
    "GET",
    `${API_V1_PREFIX}/sequences?skip=${skip}&limit=${limit}`,
  );
}

/**
 * Get all muscles
 */
export async function getMuscles(): Promise<Muscle[]> {
  return apiRequest<Muscle[]>("GET", `${API_V1_PREFIX}/muscles`);
}

export async function createCategory(data: {
  name: string;
  description?: string;
}): Promise<Category> {
  return apiRequest<Category>("POST", `${API_V1_PREFIX}/categories`, data);
}

export async function createPose(data: {
  code: string;
  name: string;
  category_id?: number;
  name_en?: string;
  description?: string;
}): Promise<Pose> {
  return apiRequest<Pose>("POST", `${API_V1_PREFIX}/poses`, data);
}

export async function createSequence(data: {
  name: string;
  description?: string;
  difficulty?: "beginner" | "intermediate" | "advanced";
  poses?: Array<{
    pose_id: number;
    order_index: number;
    duration_seconds: number;
    transition_note?: string;
  }>;
}): Promise<Sequence> {
  return apiRequest<Sequence>("POST", `${API_V1_PREFIX}/sequences`, data);
}

export async function deleteSequence(sequenceId: number): Promise<void> {
  await apiRequest<void>("DELETE", `${API_V1_PREFIX}/sequences/${sequenceId}`);
}

export async function deletePose(poseId: number): Promise<void> {
  await apiRequest<void>("DELETE", `${API_V1_PREFIX}/poses/${poseId}`);
}

export async function deleteCategory(categoryId: number): Promise<void> {
  await apiRequest<void>("DELETE", `${API_V1_PREFIX}/categories/${categoryId}`);
}

export async function seedMuscles(): Promise<Muscle[]> {
  return apiRequest<Muscle[]>("POST", `${API_V1_PREFIX}/muscles/seed`);
}

export async function uploadPoseSchema(
  poseId: number,
  buffer: Uint8Array,
  filename: string,
  mimeType: string,
): Promise<Pose> {
  const url = `${API_BASE_URL}${API_V1_PREFIX}/poses/${poseId}/schema`;
  const form = new FormData();
  const blob = new Blob([buffer], { type: mimeType });
  form.append("file", blob, filename);

  const headers: Record<string, string> = {
    "Accept-Language": "uk",
  };
  if (accessToken) {
    headers["Authorization"] = `Bearer ${accessToken}`;
  }

  const response = await fetch(url, {
    method: "POST",
    headers,
    body: form,
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`API error ${response.status}: ${errorText}`);
  }

  return response.json() as Promise<Pose>;
}

export async function generateFromSchema(
  buffer: Uint8Array,
  filename: string,
  mimeType: string,
  additionalNotes?: string,
): Promise<{
  task_id: string;
  status: string;
  progress: number;
  status_message: string;
}> {
  const url = `${API_BASE_URL}${API_V1_PREFIX}/generate`;
  const form = new FormData();
  const blob = new Blob([buffer], { type: mimeType });
  form.append("schema_file", blob, filename);
  if (additionalNotes && additionalNotes.trim()) {
    form.append("additional_notes", additionalNotes);
  }

  const headers: Record<string, string> = {
    "Accept-Language": "uk",
  };
  if (accessToken) {
    headers["Authorization"] = `Bearer ${accessToken}`;
  }

  const response = await fetch(url, {
    method: "POST",
    headers,
    body: form,
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`API error ${response.status}: ${errorText}`);
  }

  return response.json() as Promise<{
    task_id: string;
    status: string;
    progress: number;
    status_message: string;
  }>;
}

export async function generateFromPose(
  poseId: number,
  additionalNotes?: string,
): Promise<{
  task_id: string;
  status: string;
  progress: number;
  status_message: string;
}> {
  const url = `${API_BASE_URL}${API_V1_PREFIX}/generate/from-pose/${poseId}`;

  const headers: Record<string, string> = {
    "Accept-Language": "uk",
    "Content-Type": "application/json",
  };
  if (accessToken) {
    headers["Authorization"] = `Bearer ${accessToken}`;
  }

  const body = additionalNotes?.trim()
    ? { additional_notes: additionalNotes }
    : {};

  const response = await fetch(url, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`API error ${response.status}: ${errorText}`);
  }

  return response.json() as Promise<{
    task_id: string;
    status: string;
    progress: number;
    status_message: string;
  }>;
}

export async function getGenerateStatus(taskId: string): Promise<{
  task_id: string;
  status: string;
  progress: number;
  status_message: string;
  error_message?: string | null;
  photo_url?: string | null;
  muscles_url?: string | null;
  quota_warning?: boolean;
}> {
  return apiRequest("GET", `${API_V1_PREFIX}/generate/status/${taskId}`);
}

export async function waitForGenerateCompleted(
  taskId: string,
  timeoutMs: number = 60_000,
): Promise<{
  task_id: string;
  status: string;
  progress: number;
  status_message: string;
  error_message?: string | null;
  photo_url?: string | null;
  muscles_url?: string | null;
  quota_warning?: boolean;
}> {
  const startedAt = Date.now();

  // eslint-disable-next-line no-constant-condition
  while (true) {
    const status = await getGenerateStatus(taskId);
    if (status.status === "completed") return status;
    if (status.status === "failed") {
      throw new Error(
        `[test-api] generation failed: ${status.error_message || "unknown error"}`,
      );
    }

    if (Date.now() - startedAt > timeoutMs) {
      throw new Error(`[test-api] generation timed out after ${timeoutMs}ms`);
    }
    await sleep(500);
  }
}

export async function applyGenerationToPose(
  poseId: number,
  taskId: string,
): Promise<Pose> {
  return apiRequest<Pose>(
    "POST",
    `${API_V1_PREFIX}/poses/${poseId}/apply-generation/${taskId}`,
  );
}

export async function getPoseImageSignedUrl(
  poseId: number,
  imageType: "schema" | "photo" | "muscle_layer" | "skeleton_layer",
): Promise<{ signed_url: string; expires_at: number }> {
  return apiRequest<{ signed_url: string; expires_at: number }>(
    "GET",
    `${API_V1_PREFIX}/poses/${poseId}/image/${imageType}/signed-url`,
  );
}

/**
 * Fetch all existing data from the database
 * NO DATA IS CREATED - only fetches what already exists!
 */
export async function fetchExistingData(): Promise<TestDataStore> {
  console.log("[test-api] Fetching existing data (no creation)...");

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
    console.log("[test-api] Error fetching categories:", error);
  }

  // 2. Fetch poses
  try {
    const posesResponse = await getPoses(0, 500);
    store.poses = posesResponse.items;
    console.log(
      `[test-api] Found ${store.poses.length} poses (total: ${posesResponse.total})`,
    );
  } catch (error) {
    console.log("[test-api] Error fetching poses:", error);
  }

  // 3. Fetch sequences
  try {
    const sequencesResponse = await getSequences(0, 100);
    store.sequences = sequencesResponse.items;
    console.log(
      `[test-api] Found ${store.sequences.length} sequences (total: ${sequencesResponse.total})`,
    );
  } catch (error) {
    console.log("[test-api] Error fetching sequences:", error);
  }

  // 4. Fetch muscles
  try {
    store.muscles = await getMuscles();
    console.log(`[test-api] Found ${store.muscles.length} muscles`);
  } catch (error) {
    console.log("[test-api] Error fetching muscles:", error);
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
