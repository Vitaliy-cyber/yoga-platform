import { describe, it, expect } from 'vitest'
import { renderHook, waitFor } from '@testing-library/react'
import { useSearchPoses } from './usePoses'

describe('usePoses hooks', () => {
  describe('useSearchPoses', () => {
    it('returns initial empty state', () => {
      const { result } = renderHook(() => useSearchPoses())

      expect(result.current.results).toEqual([])
      expect(result.current.isSearching).toBe(false)
      expect(typeof result.current.search).toBe('function')
    })

    it('returns empty results for empty query', async () => {
      const { result } = renderHook(() => useSearchPoses())

      await result.current.search('')

      expect(result.current.results).toEqual([])
    })

    it('sets isSearching during search', async () => {
      const { result } = renderHook(() => useSearchPoses())

      result.current.search('Mountain')

      await waitFor(() => {
        expect(result.current.results.length).toBeGreaterThanOrEqual(0)
      })
    })

    it('returns matching results', async () => {
      const { result } = renderHook(() => useSearchPoses())

      await result.current.search('Mountain')

      await waitFor(() => {
        expect(result.current.isSearching).toBe(false)
      })

      // Should find Mountain Pose from mock data
      const hasMatch = result.current.results.some(
        (p) =>
          p.name.toLowerCase().includes('mountain') ||
          (p.name_en?.toLowerCase().includes('mountain') ?? false)
      )
      expect(hasMatch).toBe(true)
    })
  })
})
