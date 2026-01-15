import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useGenerate } from './useGenerate'

describe('useGenerate', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('initializes with default state', () => {
    const { result } = renderHook(() => useGenerate())

    expect(result.current.isGenerating).toBe(false)
    expect(result.current.progress).toBe(0)
    expect(result.current.status).toBeNull()
    expect(result.current.photoUrl).toBeNull()
    expect(result.current.musclesUrl).toBeNull()
    expect(result.current.photoUrl).toBeNull()
    expect(result.current.error).toBeNull()
  })

  it('has generate function', () => {
    const { result } = renderHook(() => useGenerate())
    expect(typeof result.current.generate).toBe('function')
  })

  it('has reset function', () => {
    const { result } = renderHook(() => useGenerate())
    expect(typeof result.current.reset).toBe('function')
  })

  it('reset clears state', async () => {
    const { result } = renderHook(() => useGenerate())

    // Call reset
    act(() => {
      result.current.reset()
    })

    expect(result.current.isGenerating).toBe(false)
    expect(result.current.progress).toBe(0)
    expect(result.current.status).toBeNull()
    expect(result.current.photoUrl).toBeNull()
    expect(result.current.musclesUrl).toBeNull()
    expect(result.current.photoUrl).toBeNull()
    expect(result.current.error).toBeNull()
  })
})
