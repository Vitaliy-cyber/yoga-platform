// Типи для категорій
export interface Category {
  id: number;
  name: string;
  description: string | null;
  created_at: string;
  pose_count?: number;
}

export interface CategoryCreate {
  name: string;
  description?: string;
}

// Типи для м'язів
export interface Muscle {
  id: number;
  name: string;
  name_ua: string | null;
  body_part: string | null;
}

export interface PoseMuscle {
  muscle_id: number;
  muscle_name: string;
  muscle_name_ua: string | null;
  body_part: string | null;
  activation_level: number;
}

// Типи для поз
export interface Pose {
  id: number;
  code: string;
  name: string;
  name_en: string | null;
  category_id: number | null;
  category_name: string | null;
  description: string | null;
  effect: string | null;
  breathing: string | null;
  schema_path: string | null;
  photo_path: string | null;
  muscle_layer_path: string | null;
  skeleton_layer_path: string | null;
  created_at: string;
  updated_at: string;
  muscles: PoseMuscle[];
}

export interface PoseListItem {
  id: number;
  code: string;
  name: string;
  name_en: string | null;
  category_id: number | null;
  category_name: string | null;
  schema_path: string | null;
  photo_path: string | null;
}

export interface PoseCreate {
  code: string;
  name: string;
  name_en?: string;
  category_id?: number;
  description?: string;
  effect?: string;
  breathing?: string;
  muscles?: {
    muscle_id: number;
    activation_level: number;
  }[];
}

export interface PoseUpdate extends Partial<PoseCreate> {
  photo_path?: string;
  muscle_layer_path?: string;
  // For AI-analyzed muscles (by name)
  analyzed_muscles?: AnalyzedMuscle[];
  // Versioning: optional note describing what changed
  change_note?: string;
}

// Типи для генерації
export type LayerType = 'photo' | 'muscles';

export type GenerateStatus = 'pending' | 'processing' | 'completed' | 'failed';

export interface AnalyzedMuscle {
  name: string;
  activation_level: number;
}

export interface GenerateResponse {
  task_id: string;
  status: GenerateStatus;
  progress: number;
  status_message: string | null;
  error_message: string | null;
  // URLs - фото та м'язи
  photo_url: string | null;
  muscles_url: string | null;
  // Warning when placeholders are used due to API quota
  quota_warning: boolean;
  // Analyzed muscles from AI
  analyzed_muscles: AnalyzedMuscle[] | null;
}

// API Response типи
export interface ApiError {
  detail: string | Array<{msg?: string; message?: string; loc?: string[]; type?: string}> | Record<string, unknown>;
}

// Auth типи
export interface User {
  id: number;
  // token is not returned from backend - user already knows their token
  name: string | null;
  created_at: string;
  last_login: string | null;
}

export interface LoginRequest {
  token: string;
}

export interface TokenResponse {
  access_token: string;
  token_type: string;
  user: User;
}

// Extended token response with refresh token
export interface TokenPairResponse {
  access_token: string;
  refresh_token: string;
  token_type: string;
  expires_in: number;  // Access token expiration in seconds
  user: User;
}

// Session types for session management
export interface Session {
  id: number;
  device_info: string | null;
  ip_address: string | null;
  created_at: string;
  last_used_at: string | null;
  is_current: boolean;
}

export interface SessionListResponse {
  sessions: Session[];
  total: number;
}

// Rate limit error response
export interface RateLimitError {
  detail: string;
  retry_after: number;
}

export interface UserUpdate {
  name?: string;
}

// UI типи
export interface Toast {
  id: string;
  type: 'success' | 'error' | 'info' | 'warning';
  message: string;
  duration?: number;
}

// Comparison types
export interface PoseComparisonItem {
  id: number;
  name: string;
  name_en: string | null;
  category_name: string | null;
  photo_path: string | null;
  muscle_layer_path: string | null;
  muscles: PoseMuscle[];
}

export interface MuscleComparison {
  muscle_id: number;
  muscle_name: string;
  muscle_name_ua: string | null;
  body_part: string | null;
  // Note: JSON serialization converts numeric keys to strings.
  // Use string keys for type safety. Access with pose.id (number) works due to JS coercion.
  activations: Record<string, number>; // pose_id (as string) -> activation_level (0-100)
}

export interface ComparisonResult {
  poses: PoseComparisonItem[];
  muscle_comparison: MuscleComparison[];
  common_muscles: string[];
  // Note: JSON serialization converts numeric keys to strings
  unique_muscles: Record<string, string[]>; // pose_id (as string) -> list of unique muscle names
}

// Analytics types
export interface OverviewStats {
  total_poses: number;
  total_categories: number;
  poses_with_photos: number;
  poses_with_muscles: number;
  total_muscles: number;
  completion_rate: number;
}

export interface MuscleStats {
  muscle_id: number;
  name: string;
  name_ua: string | null;
  body_part: string | null;
  total_activations: number;
  avg_activation_level: number;
  pose_count: number;
}

export interface MuscleHeatmapData {
  muscles: MuscleStats[];
  muscle_groups: Record<string, MuscleStats[]>;
  most_trained: MuscleStats[];
  least_trained: MuscleStats[];
  balance_score: number;
}

export interface CategoryStats {
  id: number;
  name: string;
  description: string | null;
  pose_count: number;
  percentage: number;
  poses_with_photos: number;
}

export type ActivityAction = 'created' | 'updated' | 'photo_generated';

export interface RecentActivity {
  id: number;
  pose_code: string;
  pose_name: string;
  category_name: string | null;
  action: ActivityAction;
  timestamp: string;
  has_photo: boolean;
}

export interface BodyPartBalance {
  body_part: string;
  total_activations: number;
  muscle_count: number;
  avg_activation: number;
  percentage_of_total: number;
}

export interface AnalyticsSummary {
  overview: OverviewStats;
  muscle_heatmap: MuscleHeatmapData;
  categories: CategoryStats[];
  recent_activity: RecentActivity[];
  body_part_balance: BodyPartBalance[];
}

// Sequence types
export type DifficultyLevel = 'beginner' | 'intermediate' | 'advanced';

export interface SequencePose {
  id: number;
  pose_id: number;
  order_index: number;
  duration_seconds: number;
  transition_note: string | null;
  pose_name: string;
  pose_code: string;
  pose_photo_path: string | null;
  pose_schema_path: string | null;
}

export interface Sequence {
  id: number;
  user_id: number;
  name: string;
  description: string | null;
  difficulty: DifficultyLevel;
  duration_seconds: number | null;
  created_at: string;
  updated_at: string;
  poses: SequencePose[];
}

export interface SequenceListItem {
  id: number;
  name: string;
  description: string | null;
  difficulty: DifficultyLevel;
  duration_seconds: number | null;
  pose_count: number;
  created_at: string;
  updated_at: string;
}

export interface SequencePoseCreate {
  pose_id: number;
  order_index?: number;
  duration_seconds?: number;
  transition_note?: string;
}

export interface SequenceCreate {
  name: string;
  description?: string;
  difficulty?: DifficultyLevel;
  poses?: SequencePoseCreate[];
}

export interface SequenceUpdate {
  name?: string;
  description?: string;
  difficulty?: DifficultyLevel;
}

export interface SequencePoseUpdate {
  duration_seconds?: number;
  transition_note?: string;
}

export interface PaginatedSequenceResponse {
  items: SequenceListItem[];
  total: number;
  skip: number;
  limit: number;
}

export interface ReorderPosesRequest {
  /** Array of sequence_pose_ids (not pose_ids) in the new order */
  pose_ids: number[];
}

// Version History Types
export interface VersionMuscleSnapshot {
  muscle_id: number;
  muscle_name: string | null;
  muscle_name_ua: string | null;
  body_part: string | null;
  activation_level: number;
}

export interface PoseVersionListItem {
  id: number;
  version_number: number;
  name: string;
  change_note: string | null;
  changed_by_name: string | null;
  created_at: string;
}

export interface PoseVersionDetail extends PoseVersionListItem {
  name_en: string | null;
  code: string;
  category_id: number | null;
  description: string | null;
  effect: string | null;
  breathing: string | null;
  schema_path: string | null;
  photo_path: string | null;
  muscle_layer_path: string | null;
  skeleton_layer_path: string | null;
  muscles: VersionMuscleSnapshot[];
}

export interface VersionDiff {
  field: string;
  old_value: unknown;
  new_value: unknown;
  changes?: Array<{
    type: 'added' | 'removed' | 'changed';
    muscle_id: number;
    muscle_name: string | null;
    old_activation?: number;
    new_activation?: number;
  }>;
}

export interface VersionSummary {
  id: number;
  version_number: number;
  change_note: string | null;
  changed_by_name: string | null;
  created_at: string | null;
}

export interface VersionComparisonResult {
  version_1: VersionSummary;
  version_2: VersionSummary;
  differences: VersionDiff[];
}

export interface RestoreVersionRequest {
  change_note?: string;
}

export interface VersionCountResponse {
  pose_id: number;
  version_count: number;
}

// Export/Import Types
export type ExportFormat = 'json' | 'csv' | 'pdf';

export type DuplicateHandling = 'skip' | 'overwrite' | 'rename';

export interface MuscleExport {
  name: string;
  name_ua: string | null;
  body_part: string | null;
  activation_level: number;
}

export interface CategoryExport {
  name: string;
  description: string | null;
}

export interface PoseExport {
  code: string;
  name: string;
  name_en: string | null;
  category_name: string | null;
  description: string | null;
  effect: string | null;
  breathing: string | null;
  muscles: MuscleExport[];
  schema_path: string | null;
  photo_path: string | null;
  muscle_layer_path: string | null;
  skeleton_layer_path: string | null;
  created_at: string | null;
  updated_at: string | null;
}

export interface BackupMetadata {
  version: string;
  exported_at: string;
  user_id: number | null;
  total_poses: number;
  total_categories: number;
}

export interface BackupData {
  metadata: BackupMetadata;
  categories: CategoryExport[];
  poses: PoseExport[];
}

export interface ImportOptions {
  duplicate_handling: DuplicateHandling;
  import_categories: boolean;
  import_poses: boolean;
}

export interface ImportItemResult {
  code: string | null;
  name: string;
  status: 'created' | 'updated' | 'skipped' | 'error';
  message: string | null;
}

export interface ImportResult {
  success: boolean;
  total_items: number;
  created: number;
  updated: number;
  skipped: number;
  errors: number;
  items: ImportItemResult[];
  error_message: string | null;
}

export interface ImportPreviewItem {
  code: string | null;
  name: string;
  type: 'pose' | 'category';
  exists: boolean;
  will_be: 'created' | 'updated' | 'skipped';
}

export interface ImportPreviewResult {
  valid: boolean;
  total_items: number;
  poses_count: number;
  categories_count: number;
  will_create: number;
  will_update: number;
  will_skip: number;
  items: ImportPreviewItem[];
  validation_errors: string[];
}

export interface PDFExportOptions {
  include_photo: boolean;
  include_schema: boolean;
  include_muscle_layer: boolean;
  include_muscles_list: boolean;
  include_description: boolean;
  page_size: 'A4' | 'Letter';
}
