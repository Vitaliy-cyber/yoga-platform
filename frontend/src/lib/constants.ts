/**
 * Application-wide constants for the yoga platform.
 *
 * Centralizes magic numbers and configuration values to:
 * - Improve code readability
 * - Make values easy to update
 * - Document the purpose of each value
 */

// =============================================================================
// API Configuration
// =============================================================================

/**
 * Default timeout for API requests in milliseconds.
 * 30 seconds allows for image generation and processing operations.
 */
export const API_TIMEOUT_MS = 30_000;

/**
 * Polling interval for generation status checks in milliseconds.
 * 3 seconds balances responsive updates with rate limit of 5 req/min.
 * With 5 requests allowed, this gives ~15 seconds before hitting limit.
 */
export const GENERATION_POLL_INTERVAL_MS = 3_000;

/**
 * Jitter added to token refresh threshold to prevent thundering herd.
 * Randomizes refresh timing across clients.
 */
export const TOKEN_REFRESH_JITTER_MS = 5_000;

/**
 * Time before token expiry to trigger refresh in milliseconds.
 * Refresh 60 seconds before expiry to ensure uninterrupted service.
 */
export const TOKEN_REFRESH_THRESHOLD_MS = 60_000;

/**
 * Background refresh interval in milliseconds.
 * Proactively refresh every 5 minutes when tab is active.
 */
export const TOKEN_BACKGROUND_REFRESH_MS = 5 * 60_000;

/**
 * Debounce delay for visibility change events in milliseconds.
 * Prevents rapid refresh attempts when quickly switching tabs.
 */
export const TOKEN_VISIBILITY_DEBOUNCE_MS = 1_000;

/**
 * Base delay for exponential backoff retry in milliseconds.
 */
export const TOKEN_RETRY_BASE_MS = 1_000;

/**
 * Maximum delay for exponential backoff retry in milliseconds.
 */
export const TOKEN_RETRY_MAX_MS = 30_000;

/**
 * Maximum number of retry attempts for token refresh.
 */
export const TOKEN_MAX_RETRIES = 3;

/**
 * Heartbeat interval for session keepalive in milliseconds.
 * Sends a lightweight request to prevent session timeout.
 */
export const TOKEN_HEARTBEAT_INTERVAL_MS = 60_000;

// =============================================================================
// Pagination
// =============================================================================

/**
 * Default number of items per page for paginated lists.
 */
export const DEFAULT_PAGE_SIZE = 20;

/**
 * Maximum number of poses to fetch in a single request.
 */
export const MAX_POSES_PER_REQUEST = 200;

/**
 * Maximum number of poses to load in pose picker modal.
 */
export const POSE_PICKER_LIMIT = 200;

/**
 * Default limit for version history requests.
 */
export const VERSION_HISTORY_LIMIT = 50;

/**
 * Default limit for recent activity feed.
 */
export const RECENT_ACTIVITY_LIMIT = 10;

// =============================================================================
// UI Timing
// =============================================================================

/**
 * Default duration for toast notifications in milliseconds.
 */
export const TOAST_DURATION_MS = 5_000;

/**
 * Cache duration for images in seconds.
 * 1 day = 86400 seconds.
 */
export const IMAGE_CACHE_SECONDS = 86_400;

/**
 * Animation delay between staggered elements in milliseconds.
 */
export const STAGGER_DELAY_MS = 50;

// =============================================================================
// Sequence Configuration
// =============================================================================

/**
 * Default duration for a pose in a sequence (in seconds).
 */
export const DEFAULT_POSE_DURATION_SECONDS = 30;

/**
 * Minimum duration for a pose in a sequence (in seconds).
 */
export const MIN_POSE_DURATION_SECONDS = 5;

/**
 * Maximum duration for a pose in a sequence (in seconds).
 * 10 minutes maximum per pose.
 */
export const MAX_POSE_DURATION_SECONDS = 600;

// =============================================================================
// Progress Thresholds
// =============================================================================

/**
 * Progress thresholds for generation steps.
 * Used to determine which step is currently active.
 */
export const GENERATION_PROGRESS = {
  /** Analyzing/preparing phase: 0-30% */
  ANALYZING_END: 30,
  /** Photo generation phase: 30-60% */
  PHOTO_END: 60,
  /** Muscle generation phase: 60-100% */
  MUSCLES_END: 100,
} as const;

// =============================================================================
// Comparison
// =============================================================================

/**
 * Minimum number of poses required for comparison.
 */
export const MIN_POSES_FOR_COMPARISON = 2;

/**
 * Maximum number of poses allowed in comparison.
 */
export const MAX_POSES_FOR_COMPARISON = 4;

// =============================================================================
// File Upload
// =============================================================================

/**
 * Maximum file upload size in bytes.
 * 10 MB limit for image uploads.
 */
export const MAX_UPLOAD_SIZE_BYTES = 10 * 1024 * 1024;

/**
 * Allowed image MIME types for upload.
 */
export const ALLOWED_IMAGE_TYPES = [
  'image/png',
  'image/jpeg',
  'image/jpg',
  'image/webp',
] as const;

// =============================================================================
// Opacity
// =============================================================================

/**
 * Default opacity for muscle overlay layer.
 * 70% opacity provides good visibility while showing underlying image.
 */
export const DEFAULT_OVERLAY_OPACITY = 0.7;

// =============================================================================
// Search
// =============================================================================

/**
 * Maximum number of search results to return.
 */
export const SEARCH_RESULTS_LIMIT = 50;

/**
 * Debounce delay for search input in milliseconds.
 * 300ms provides responsive feel while avoiding excessive filtering.
 */
export const SEARCH_DEBOUNCE_MS = 300;

// =============================================================================
// Type exports for better TypeScript support
// =============================================================================

export type AllowedImageType = typeof ALLOWED_IMAGE_TYPES[number];
