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

// =============================================================================
// Pagination
// =============================================================================

/**
 * Maximum number of poses to fetch in a single request.
 */
export const MAX_POSES_PER_REQUEST = 200;

// =============================================================================
// Comparison
// =============================================================================

/**
 * Maximum number of poses allowed in comparison.
 */
export const MAX_POSES_FOR_COMPARISON = 4;

// =============================================================================
// File Upload
// =============================================================================

/**
 * Maximum allowed upload size (10MB).
 */
export const MAX_UPLOAD_SIZE_BYTES = 10 * 1024 * 1024;

// =============================================================================
// Opacity
// =============================================================================

/**
 * Default opacity for muscle overlay layer.
 * 70% opacity provides good visibility while showing underlying image.
 */
export const DEFAULT_OVERLAY_OPACITY = 0.7;
