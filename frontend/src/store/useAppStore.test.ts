import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { act } from '@testing-library/react'
import { useAppStore } from './useAppStore'
import type { Category, PoseListItem } from '../types'

describe('useAppStore', () => {
  beforeEach(() => {
    // Reset store state before each test
    useAppStore.setState({
      categories: [],
      poses: [],
      selectedCategoryId: null,
      searchQuery: '',
      isLoading: false,
      toasts: [],
      isSidebarOpen: true,
    })
  })

  describe('Categories', () => {
    it('initializes with empty categories', () => {
      const { categories } = useAppStore.getState()
      expect(categories).toEqual([])
    })

    it('sets categories', () => {
      const mockCategories: Category[] = [
        { id: 1, name: 'Cat 1', description: null, created_at: '2024-01-01T00:00:00Z', pose_count: 0 },
        { id: 2, name: 'Cat 2', description: null, created_at: '2024-01-01T00:00:00Z', pose_count: 0 },
      ]

      act(() => {
        useAppStore.getState().setCategories(mockCategories)
      })

      expect(useAppStore.getState().categories).toEqual(mockCategories)
    })

    it('replaces existing categories', () => {
      const initial: Category[] = [
        { id: 1, name: 'Initial', description: null, created_at: '2024-01-01T00:00:00Z', pose_count: 0 },
      ]
      const updated: Category[] = [
        { id: 2, name: 'Updated', description: null, created_at: '2024-01-01T00:00:00Z', pose_count: 0 },
      ]

      act(() => {
        useAppStore.getState().setCategories(initial)
      })

      act(() => {
        useAppStore.getState().setCategories(updated)
      })

      expect(useAppStore.getState().categories).toEqual(updated)
    })
  })

  describe('Poses', () => {
    it('initializes with empty poses', () => {
      const { poses } = useAppStore.getState()
      expect(poses).toEqual([])
    })

    it('sets poses', () => {
      const mockPoses: PoseListItem[] = [
        { id: 1, code: 'POSE1', name: 'Pose 1', name_en: 'Pose 1', category_id: 1, category_name: 'Cat', schema_path: null, photo_path: null },
      ]

      act(() => {
        useAppStore.getState().setPoses(mockPoses)
      })

      expect(useAppStore.getState().poses).toEqual(mockPoses)
    })

    it('updates poses array', () => {
      const initial: PoseListItem[] = [
        { id: 1, code: 'P1', name: 'Pose 1', name_en: 'P1', category_id: 1, category_name: 'C', schema_path: null, photo_path: null },
      ]
      const additional: PoseListItem[] = [
        { id: 2, code: 'P2', name: 'Pose 2', name_en: 'P2', category_id: 1, category_name: 'C', schema_path: null, photo_path: null },
      ]

      act(() => {
        useAppStore.getState().setPoses(initial)
      })

      act(() => {
        useAppStore.getState().setPoses(additional)
      })

      expect(useAppStore.getState().poses).toEqual(additional)
    })
  })

  describe('Selected Category', () => {
    it('initializes with null selected category', () => {
      const { selectedCategoryId } = useAppStore.getState()
      expect(selectedCategoryId).toBeNull()
    })

    it('sets selected category id', () => {
      act(() => {
        useAppStore.getState().setSelectedCategoryId(5)
      })

      expect(useAppStore.getState().selectedCategoryId).toBe(5)
    })

    it('clears selected category', () => {
      act(() => {
        useAppStore.getState().setSelectedCategoryId(5)
      })

      act(() => {
        useAppStore.getState().setSelectedCategoryId(null)
      })

      expect(useAppStore.getState().selectedCategoryId).toBeNull()
    })
  })

  describe('Search Query', () => {
    it('initializes with empty search query', () => {
      const { searchQuery } = useAppStore.getState()
      expect(searchQuery).toBe('')
    })

    it('sets search query', () => {
      act(() => {
        useAppStore.getState().setSearchQuery('yoga')
      })

      expect(useAppStore.getState().searchQuery).toBe('yoga')
    })

    it('clears search query', () => {
      act(() => {
        useAppStore.getState().setSearchQuery('test')
      })

      act(() => {
        useAppStore.getState().setSearchQuery('')
      })

      expect(useAppStore.getState().searchQuery).toBe('')
    })
  })

  describe('Loading State', () => {
    it('initializes with loading false', () => {
      const { isLoading } = useAppStore.getState()
      expect(isLoading).toBe(false)
    })

    it('sets loading to true', () => {
      act(() => {
        useAppStore.getState().setIsLoading(true)
      })

      expect(useAppStore.getState().isLoading).toBe(true)
    })

    it('sets loading to false', () => {
      act(() => {
        useAppStore.getState().setIsLoading(true)
      })

      act(() => {
        useAppStore.getState().setIsLoading(false)
      })

      expect(useAppStore.getState().isLoading).toBe(false)
    })
  })

  describe('Toasts', () => {
    beforeEach(() => {
      vi.useFakeTimers()
    })

    afterEach(() => {
      vi.useRealTimers()
    })

    it('initializes with empty toasts', () => {
      const { toasts } = useAppStore.getState()
      expect(toasts).toEqual([])
    })

    it('adds a toast', () => {
      act(() => {
        useAppStore.getState().addToast({ type: 'success', message: 'Success!' })
      })

      const { toasts } = useAppStore.getState()
      expect(toasts.length).toBe(1)
      expect(toasts[0].message).toBe('Success!')
      expect(toasts[0].type).toBe('success')
    })

    it('generates unique toast id', () => {
      act(() => {
        useAppStore.getState().addToast({ type: 'info', message: 'Info 1' })
        useAppStore.getState().addToast({ type: 'info', message: 'Info 2' })
      })

      const { toasts } = useAppStore.getState()
      expect(toasts[0].id).not.toBe(toasts[1].id)
    })

    it('removes toast by id', () => {
      act(() => {
        useAppStore.getState().addToast({ type: 'error', message: 'Error!' })
      })

      const toastId = useAppStore.getState().toasts[0].id

      act(() => {
        useAppStore.getState().removeToast(toastId)
      })

      expect(useAppStore.getState().toasts.length).toBe(0)
    })

    it('auto-removes toast after duration', () => {
      act(() => {
        useAppStore.getState().addToast({ type: 'success', message: 'Auto remove', duration: 1000 })
      })

      expect(useAppStore.getState().toasts.length).toBe(1)

      act(() => {
        vi.advanceTimersByTime(1500)
      })

      expect(useAppStore.getState().toasts.length).toBe(0)
    })

    it('uses default duration if not specified', () => {
      act(() => {
        useAppStore.getState().addToast({ type: 'info', message: 'Default duration' })
      })

      expect(useAppStore.getState().toasts.length).toBe(1)

      act(() => {
        vi.advanceTimersByTime(4000)
      })

      expect(useAppStore.getState().toasts.length).toBe(1)

      act(() => {
        vi.advanceTimersByTime(2000)
      })

      expect(useAppStore.getState().toasts.length).toBe(0)
    })

    it('supports different toast types', () => {
      const types = ['success', 'error', 'warning', 'info'] as const

      types.forEach(type => {
        act(() => {
          useAppStore.getState().addToast({ type, message: `${type} message` })
        })
      })

      const { toasts } = useAppStore.getState()
      expect(toasts.length).toBe(4)
    })
  })

  describe('Sidebar', () => {
    it('initializes with sidebar open', () => {
      const { isSidebarOpen } = useAppStore.getState()
      expect(isSidebarOpen).toBe(true)
    })

    it('toggles sidebar from open to closed', () => {
      act(() => {
        useAppStore.getState().toggleSidebar()
      })

      expect(useAppStore.getState().isSidebarOpen).toBe(false)
    })

    it('toggles sidebar from closed to open', () => {
      act(() => {
        useAppStore.getState().setSidebarOpen(false)
      })

      act(() => {
        useAppStore.getState().toggleSidebar()
      })

      expect(useAppStore.getState().isSidebarOpen).toBe(true)
    })

    it('sets sidebar open explicitly', () => {
      act(() => {
        useAppStore.getState().setSidebarOpen(false)
      })

      expect(useAppStore.getState().isSidebarOpen).toBe(false)

      act(() => {
        useAppStore.getState().setSidebarOpen(true)
      })

      expect(useAppStore.getState().isSidebarOpen).toBe(true)
    })

    it('toggles multiple times correctly', () => {
      act(() => {
        useAppStore.getState().toggleSidebar() // false
        useAppStore.getState().toggleSidebar() // true
        useAppStore.getState().toggleSidebar() // false
      })

      expect(useAppStore.getState().isSidebarOpen).toBe(false)
    })
  })
})
