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

export interface PoseUpdate extends Partial<PoseCreate> {}

// Типи для генерації
export type LayerType = 'photo' | 'muscles';

export type GenerateStatus = 'pending' | 'processing' | 'completed' | 'failed';

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
}

// API Response типи
export interface ApiError {
  detail: string;
}

// Auth типи
export interface User {
  id: number;
  token: string;
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
