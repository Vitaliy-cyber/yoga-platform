import { describe, it, expect } from 'vitest'
import type {
  Category,
  CategoryCreate,
  Muscle,
  PoseMuscle,
  Pose,
  PoseListItem,
  PoseCreate,
  PoseUpdate,
  LayerType,
  GenerateStatus,
  GenerateResponse,
  ApiError,
  Toast,
} from './index'

describe('Type definitions', () => {
  describe('Category types', () => {
    it('Category type has required fields', () => {
      const category: Category = {
        id: 1,
        name: 'Test Category',
        description: null,
        created_at: '2024-01-01T00:00:00Z',
        pose_count: 5,
      }
      expect(category.id).toBe(1)
      expect(category.name).toBe('Test Category')
    })

    it('CategoryCreate type works without optional fields', () => {
      const create: CategoryCreate = {
        name: 'New Category',
      }
      expect(create.name).toBe('New Category')
    })

    it('CategoryCreate type works with description', () => {
      const create: CategoryCreate = {
        name: 'New Category',
        description: 'Description',
      }
      expect(create.description).toBe('Description')
    })
  })

  describe('Muscle types', () => {
    it('Muscle type has required fields', () => {
      const muscle: Muscle = {
        id: 1,
        name: 'Quadriceps',
        name_ua: 'Квадрицепс',
        body_part: 'legs',
      }
      expect(muscle.id).toBe(1)
      expect(muscle.body_part).toBe('legs')
    })

    it('PoseMuscle type has activation_level', () => {
      const poseMuscle: PoseMuscle = {
        muscle_id: 1,
        muscle_name: 'Quadriceps',
        muscle_name_ua: 'Квадрицепс',
        body_part: 'legs',
        activation_level: 75,
      }
      expect(poseMuscle.activation_level).toBe(75)
    })
  })

  describe('Pose types', () => {
    it('Pose type has all required fields', () => {
      const pose: Pose = {
        id: 1,
        code: 'TADA',
        name: 'Тадасана',
        name_en: 'Mountain Pose',
        category_id: 1,
        category_name: 'Standing',
        description: 'Basic pose',
        effect: 'Improves posture',
        breathing: 'Normal',
        schema_path: null,
        photo_path: null,
        muscle_layer_path: null,
        created_at: '2024-01-01T00:00:00Z',
        updated_at: '2024-01-01T00:00:00Z',
        muscles: [],
      }
      expect(pose.code).toBe('TADA')
    })

    it('PoseListItem type is a subset of Pose', () => {
      const item: PoseListItem = {
        id: 1,
        code: 'TADA',
        name: 'Тадасана',
        name_en: 'Mountain Pose',
        category_id: 1,
        category_name: 'Standing',
        schema_path: null,
        photo_path: null,
      }
      expect(item.id).toBe(1)
    })

    it('PoseCreate type works with required fields', () => {
      const create: PoseCreate = {
        code: 'NEW01',
        name: 'New Pose',
      }
      expect(create.code).toBe('NEW01')
    })

    it('PoseCreate type works with muscles', () => {
      const create: PoseCreate = {
        code: 'NEW01',
        name: 'New Pose',
        muscles: [
          { muscle_id: 1, activation_level: 80 },
          { muscle_id: 2, activation_level: 60 },
        ],
      }
      expect(create.muscles?.length).toBe(2)
    })

    it('PoseUpdate is partial of PoseCreate', () => {
      const update: PoseUpdate = {
        name: 'Updated Name',
      }
      expect(update.name).toBe('Updated Name')
    })
  })

  describe('LayerType', () => {
    it('accepts photo value', () => {
      const layer: LayerType = 'photo'
      expect(layer).toBe('photo')
    })

    it('accepts muscles value', () => {
      const layer: LayerType = 'muscles'
      expect(layer).toBe('muscles')
    })


  })

  describe('GenerateStatus', () => {
    it('accepts pending value', () => {
      const status: GenerateStatus = 'pending'
      expect(status).toBe('pending')
    })

    it('accepts processing value', () => {
      const status: GenerateStatus = 'processing'
      expect(status).toBe('processing')
    })

    it('accepts completed value', () => {
      const status: GenerateStatus = 'completed'
      expect(status).toBe('completed')
    })

    it('accepts failed value', () => {
      const status: GenerateStatus = 'failed'
      expect(status).toBe('failed')
    })
  })

  describe('GenerateResponse', () => {
    it('has required fields', () => {
      const response: GenerateResponse = {
        task_id: 'task-123',
        status: 'pending',
        progress: 0,
        status_message: null,
        error_message: null,
        photo_url: null,
        muscles_url: null,
        quota_warning: false,
      }
      expect(response.task_id).toBe('task-123')
    })

    it('can have all URLs when completed', () => {
      const response: GenerateResponse = {
        task_id: 'task-123',
        status: 'completed',
        progress: 100,
        status_message: 'Completed',
        error_message: null,
        photo_url: '/generated/photo.png',
        muscles_url: '/generated/muscles.png',
        quota_warning: false,
      }
      expect(response.photo_url).toBe('/generated/photo.png')
      expect(response.muscles_url).toBe('/generated/muscles.png')

    })

    it('can have error_message when failed', () => {
      const response: GenerateResponse = {
        task_id: 'task-123',
        status: 'failed',
        progress: 0,
        status_message: 'Error',
        error_message: 'Generation failed',
        photo_url: null,
        muscles_url: null,
        quota_warning: false
      }
      expect(response.error_message).toBe('Generation failed')
    })
  })

  describe('ApiError', () => {
    it('has detail field', () => {
      const error: ApiError = {
        detail: 'Not found',
      }
      expect(error.detail).toBe('Not found')
    })
  })

  describe('Toast', () => {
    it('has required fields', () => {
      const toast: Toast = {
        id: 'toast-1',
        type: 'success',
        message: 'Operation completed',
      }
      expect(toast.type).toBe('success')
    })

    it('accepts all toast types', () => {
      const types: Toast['type'][] = ['success', 'error', 'info', 'warning']
      types.forEach((type) => {
        const toast: Toast = {
          id: `toast-${type}`,
          type,
          message: `${type} message`,
        }
        expect(toast.type).toBe(type)
      })
    })

    it('can have optional duration', () => {
      const toast: Toast = {
        id: 'toast-1',
        type: 'info',
        message: 'Info message',
        duration: 3000,
      }
      expect(toast.duration).toBe(3000)
    })
  })
})
