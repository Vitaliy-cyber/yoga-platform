import { describe, it, expect } from 'vitest'
import { categoriesApi, musclesApi, posesApi, generateApi } from './api'

describe('API Services', () => {
  describe('categoriesApi', () => {
    it('getAll returns list of categories', async () => {
      const categories = await categoriesApi.getAll()
      expect(Array.isArray(categories)).toBe(true)
      expect(categories.length).toBeGreaterThan(0)
      expect(categories[0]).toHaveProperty('id')
      expect(categories[0]).toHaveProperty('name')
    })

    it('getById returns a specific category', async () => {
      const category = await categoriesApi.getById(1)
      expect(category).toHaveProperty('id', 1)
      expect(category).toHaveProperty('name')
    })

    it('create creates a new category', async () => {
      const newCategory = await categoriesApi.create({
        name: 'Test Category',
        description: 'Test Description',
      })
      expect(newCategory).toHaveProperty('id')
      expect(newCategory.name).toBe('Test Category')
    })
  })

  describe('musclesApi', () => {
    it('getAll returns list of muscles', async () => {
      const muscles = await musclesApi.getAll()
      expect(Array.isArray(muscles)).toBe(true)
      expect(muscles.length).toBeGreaterThan(0)
      expect(muscles[0]).toHaveProperty('id')
      expect(muscles[0]).toHaveProperty('name')
    })

    it('getAll with body_part filter returns filtered muscles', async () => {
      const muscles = await musclesApi.getAll('legs')
      expect(Array.isArray(muscles)).toBe(true)
      muscles.forEach((m) => {
        expect(m.body_part).toBe('legs')
      })
    })

    it('getById returns a specific muscle', async () => {
      const muscle = await musclesApi.getById(1)
      expect(muscle).toHaveProperty('id', 1)
      expect(muscle).toHaveProperty('name')
      expect(muscle).toHaveProperty('body_part')
    })
  })

  describe('posesApi', () => {
    it('getAll returns list of poses', async () => {
      const poses = await posesApi.getAll()
      expect(Array.isArray(poses)).toBe(true)
    })

    it('search returns matching poses', async () => {
      const poses = await posesApi.search('Mountain')
      expect(Array.isArray(poses)).toBe(true)
      poses.forEach((p) => {
        const hasMatch =
          p.name.toLowerCase().includes('mountain') ||
          (p.name_en?.toLowerCase().includes('mountain') ?? false) ||
          p.code.toLowerCase().includes('mountain')
        expect(hasMatch).toBe(true)
      })
    })

    it('getById returns a specific pose', async () => {
      const pose = await posesApi.getById(1)
      expect(pose).toHaveProperty('id', 1)
      expect(pose).toHaveProperty('name')
      expect(pose).toHaveProperty('code')
    })

    it('getByCategory returns poses for a category', async () => {
      const poses = await posesApi.getByCategory(1)
      expect(Array.isArray(poses)).toBe(true)
      poses.forEach((p) => {
        expect(p.category_id).toBe(1)
      })
    })
  })

  describe('generateApi', () => {
    it('getStatus returns generation status', async () => {
      const status = await generateApi.getStatus('test-task-123')
      expect(status).toHaveProperty('task_id')
      expect(status).toHaveProperty('status')
      expect(status).toHaveProperty('progress')
    })
  })
})
