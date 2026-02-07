import React from 'react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, waitFor } from '@testing-library/react'
import { useSearchPoses } from './usePoses'
import { I18nProvider } from '../i18n'

const { mockSearch } = vi.hoisted(() => ({
  mockSearch: vi.fn(),
}))

vi.mock('../services/api', () => ({
  posesApi: {
    search: mockSearch,
  },
}))

const wrapper: React.FC<{ children: React.ReactNode }> = ({ children }) =>
  React.createElement(I18nProvider, null, children)

describe('usePoses hooks', () => {
  beforeEach(() => {
    mockSearch.mockReset()
  })

  describe('useSearchPoses', () => {
    it('returns initial empty state', () => {
      const { result } = renderHook(() => useSearchPoses(), { wrapper })

      expect(result.current.results).toEqual([])
      expect(result.current.isSearching).toBe(false)
      expect(typeof result.current.search).toBe('function')
    })

    it('returns empty results for empty query', async () => {
      const { result } = renderHook(() => useSearchPoses(), { wrapper })

      await result.current.search('')

      expect(result.current.results).toEqual([])
      expect(mockSearch).not.toHaveBeenCalled()
    })

    it('sets isSearching during search', async () => {
      let resolveSearch: ((value: unknown[]) => void) | undefined
      const searchPromise = new Promise<unknown[]>((resolve) => {
        resolveSearch = resolve
      })
      mockSearch.mockReturnValueOnce(searchPromise)

      const { result } = renderHook(() => useSearchPoses(), { wrapper })

      void result.current.search('Mountain')

      await waitFor(() => {
        expect(result.current.isSearching).toBe(true)
      })

      await waitFor(() => {
        expect(resolveSearch).toBeDefined()
      })
      resolveSearch?.([])

      await waitFor(() => {
        expect(result.current.isSearching).toBe(false)
      })
    })

    it('returns matching results', async () => {
      mockSearch.mockResolvedValueOnce([
        {
          id: 1,
          name: 'Mountain Pose',
          name_en: 'Mountain Pose',
          code: 'TADASANA',
          category_id: 1,
          category_name: 'Standing',
          description: '',
          photo_path: null,
          schema_path: null,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        },
      ])

      const { result } = renderHook(() => useSearchPoses(), { wrapper })

      await result.current.search('Mountain')

      await waitFor(() => {
        expect(result.current.isSearching).toBe(false)
      })

      const hasMatch = result.current.results.some(
        (p) =>
          p.name.toLowerCase().includes('mountain') ||
          (p.name_en?.toLowerCase().includes('mountain') ?? false)
      )
      expect(hasMatch).toBe(true)
      expect(mockSearch).toHaveBeenCalledWith('Mountain')
    })
  })
})
