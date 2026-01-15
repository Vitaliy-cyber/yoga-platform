import axios, { AxiosError, InternalAxiosRequestConfig } from 'axios';
import type {
  Category,
  CategoryCreate,
  Muscle,
  Pose,
  PoseListItem,
  PoseCreate,
  PoseUpdate,
  GenerateResponse,
  ApiError,
  LoginRequest,
  TokenResponse,
  User,
  UserUpdate,
} from '../types';
import { getAuthToken } from '../store/useAuthStore';

// Get API URL from env or use relative path (for same-origin requests)
const API_BASE_URL = import.meta.env.VITE_API_URL || window.location.origin;

// Debug log
console.log('API_BASE_URL:', API_BASE_URL);

/**
 * Get proxy URL for pose images to bypass S3 CORS restrictions.
 * @param poseId - The pose ID
 * @param imageType - Type of image: 'schema' | 'photo' | 'muscle_layer' | 'skeleton_layer'
 * @returns Proxy URL for the image
 */
export const getImageProxyUrl = (poseId: number, imageType: 'schema' | 'photo' | 'muscle_layer' | 'skeleton_layer'): string => {
  return `${API_BASE_URL}/api/poses/${poseId}/image/${imageType}`;
};

const api = axios.create({
  baseURL: API_BASE_URL,
  // Don't set Content-Type here - axios will set it automatically
  // For JSON requests it will be application/json
  // For FormData it will be multipart/form-data with boundary
});

// Add auth token to all requests
api.interceptors.request.use(
  (config: InternalAxiosRequestConfig) => {
    const token = getAuthToken();
    if (token) {
      config.headers.Authorization = `Bearer ${token}`;
    }
    return config;
  },
  (error) => Promise.reject(error)
);

// Обробка помилок
const handleError = (error: AxiosError<ApiError>): never => {
  const detail = error.response?.data?.detail;
  let message: string;

  if (Array.isArray(detail)) {
    // FastAPI validation errors come as array
    message = detail.map(err => {
      if (typeof err === 'string') return err;
      // Pydantic v2 uses 'msg', older versions might use 'message'
      return err.msg || err.message || JSON.stringify(err);
    }).join(', ');
  } else if (typeof detail === 'object' && detail !== null) {
    message = JSON.stringify(detail);
  } else if (typeof detail === 'string') {
    message = detail;
  } else {
    message = error.message || 'Unknown error';
  }

  throw new Error(message);
};

// === Categories API ===

export const categoriesApi = {
  getAll: async (): Promise<Category[]> => {
    try {
      const response = await api.get<Category[]>('/api/categories');
      return response.data;
    } catch (error) {
      throw handleError(error as AxiosError<ApiError>);
    }
  },

  getById: async (id: number): Promise<Category> => {
    try {
      const response = await api.get<Category>(`/api/categories/${id}`);
      return response.data;
    } catch (error) {
      throw handleError(error as AxiosError<ApiError>);
    }
  },

  create: async (data: CategoryCreate): Promise<Category> => {
    try {
      const response = await api.post<Category>('/api/categories', data);
      return response.data;
    } catch (error) {
      throw handleError(error as AxiosError<ApiError>);
    }
  },

  update: async (id: number, data: Partial<CategoryCreate>): Promise<Category> => {
    try {
      const response = await api.put<Category>(`/api/categories/${id}`, data);
      return response.data;
    } catch (error) {
      throw handleError(error as AxiosError<ApiError>);
    }
  },

  delete: async (id: number): Promise<void> => {
    try {
      await api.delete(`/api/categories/${id}`);
    } catch (error) {
      throw handleError(error as AxiosError<ApiError>);
    }
  },
};

// === Muscles API ===

export const musclesApi = {
  getAll: async (bodyPart?: string): Promise<Muscle[]> => {
    try {
      const params = bodyPart ? { body_part: bodyPart } : {};
      const response = await api.get<Muscle[]>('/api/muscles', { params });
      return response.data;
    } catch (error) {
      throw handleError(error as AxiosError<ApiError>);
    }
  },

  getById: async (id: number): Promise<Muscle> => {
    try {
      const response = await api.get<Muscle>(`/api/muscles/${id}`);
      return response.data;
    } catch (error) {
      throw handleError(error as AxiosError<ApiError>);
    }
  },

  seed: async (): Promise<Muscle[]> => {
    try {
      const response = await api.post<Muscle[]>('/api/muscles/seed');
      return response.data;
    } catch (error) {
      throw handleError(error as AxiosError<ApiError>);
    }
  },
};

// === Poses API ===

export const posesApi = {
  getAll: async (categoryId?: number, skip = 0, limit = 100): Promise<PoseListItem[]> => {
    try {
      const params: Record<string, number | undefined> = { skip, limit };
      if (categoryId) params.category_id = categoryId;
      const response = await api.get<PoseListItem[]>('/api/poses', { params });
      return response.data;
    } catch (error) {
      throw handleError(error as AxiosError<ApiError>);
    }
  },

  search: async (query: string): Promise<PoseListItem[]> => {
    try {
      const response = await api.get<PoseListItem[]>('/api/poses/search', {
        params: { q: query },
      });
      return response.data;
    } catch (error) {
      throw handleError(error as AxiosError<ApiError>);
    }
  },

  getByCategory: async (categoryId: number): Promise<PoseListItem[]> => {
    try {
      const response = await api.get<PoseListItem[]>(`/api/poses/category/${categoryId}`);
      return response.data;
    } catch (error) {
      throw handleError(error as AxiosError<ApiError>);
    }
  },

  getById: async (id: number): Promise<Pose> => {
    try {
      const response = await api.get<Pose>(`/api/poses/${id}`);
      return response.data;
    } catch (error) {
      throw handleError(error as AxiosError<ApiError>);
    }
  },

  getByCode: async (code: string): Promise<Pose> => {
    try {
      const response = await api.get<Pose>(`/api/poses/code/${code}`);
      return response.data;
    } catch (error) {
      throw handleError(error as AxiosError<ApiError>);
    }
  },

  create: async (data: PoseCreate): Promise<Pose> => {
    try {
      const response = await api.post<Pose>('/api/poses', data);
      return response.data;
    } catch (error) {
      throw handleError(error as AxiosError<ApiError>);
    }
  },

  update: async (id: number, data: PoseUpdate): Promise<Pose> => {
    try {
      const response = await api.put<Pose>(`/api/poses/${id}`, data);
      return response.data;
    } catch (error) {
      throw handleError(error as AxiosError<ApiError>);
    }
  },

  delete: async (id: number): Promise<void> => {
    try {
      await api.delete(`/api/poses/${id}`);
    } catch (error) {
      throw handleError(error as AxiosError<ApiError>);
    }
  },

  uploadSchema: async (id: number, file: File): Promise<Pose> => {
    try {
      const formData = new FormData();
      formData.append('file', file);
      // Don't set Content-Type manually - axios will set it with correct boundary for FormData
      const response = await api.post<Pose>(`/api/poses/${id}/schema`, formData);
      return response.data;
    } catch (error) {
      throw handleError(error as AxiosError<ApiError>);
    }
  },
};

// === Generate API ===

export const generateApi = {
  /**
   * Генерація зображень з схеми пози
   * Пайплайн: Схема → Фото → М'язи
   */
  generate: async (file: File): Promise<GenerateResponse> => {
    try {
      const formData = new FormData();
      formData.append('schema_file', file);

      const response = await api.post<GenerateResponse>('/api/generate', formData);
      return response.data;
    } catch (error) {
      throw handleError(error as AxiosError<ApiError>);
    }
  },

  getStatus: async (taskId: string): Promise<GenerateResponse> => {
    try {
      const response = await api.get<GenerateResponse>(`/api/generate/status/${taskId}`);
      return response.data;
    } catch (error) {
      throw handleError(error as AxiosError<ApiError>);
    }
  },
};

// === Auth API ===

export const authApi = {
  login: async (data: LoginRequest): Promise<TokenResponse> => {
    try {
      const response = await api.post<TokenResponse>('/api/auth/login', data);
      return response.data;
    } catch (error) {
      throw handleError(error as AxiosError<ApiError>);
    }
  },

  getMe: async (): Promise<User> => {
    try {
      const response = await api.get<User>('/api/auth/me');
      return response.data;
    } catch (error) {
      throw handleError(error as AxiosError<ApiError>);
    }
  },

  updateMe: async (data: UserUpdate): Promise<User> => {
    try {
      const response = await api.put<User>('/api/auth/me', data);
      return response.data;
    } catch (error) {
      throw handleError(error as AxiosError<ApiError>);
    }
  },
};

export default api;
