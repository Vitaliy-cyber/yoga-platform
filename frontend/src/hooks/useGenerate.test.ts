import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useGenerate } from './useGenerate'
import { generateApi } from '../services/api'

// Mock the API module
vi.mock('../services/api', () => ({
  generateApi: {
    generate: vi.fn(),
    generateFromPose: vi.fn(),
    generateFromText: vi.fn(),
    getWebSocketUrl: vi.fn(() => 'ws://localhost:8000/ws/generate/test-task'),
  },
}))

// Mock useAppStore
vi.mock('../store/useAppStore', () => ({
  useAppStore: () => ({
    addToast: vi.fn(),
  }),
}))

// Mock useI18n
vi.mock('../i18n', () => ({
  useI18n: () => ({
    t: (key: string) => key,
    locale: 'uk',
    setLocale: vi.fn(),
  }),
}))

// Mock WebSocket
class MockWebSocket {
  onopen: (() => void) | null = null
  onmessage: ((event: { data: string }) => void) | null = null
  onerror: ((event: Event) => void) | null = null
  onclose: ((event: { code: number }) => void) | null = null
  readyState = WebSocket.OPEN

  close = vi.fn()
  send = vi.fn()
}

describe('useGenerate', () => {
  const mockGenerateApi = generateApi as unknown as {
    generate: ReturnType<typeof vi.fn>
    generateFromPose: ReturnType<typeof vi.fn>
    generateFromText: ReturnType<typeof vi.fn>
    getWebSocketUrl: ReturnType<typeof vi.fn>
  }

  beforeEach(() => {
    vi.useFakeTimers()
    vi.clearAllMocks()

    // Setup default mock responses
    mockGenerateApi.generate.mockResolvedValue({ task_id: 'test-task-123' })
    mockGenerateApi.generateFromPose.mockResolvedValue({ task_id: 'test-task-456' })
    mockGenerateApi.generateFromText.mockResolvedValue({ task_id: 'test-task-789' })

    // Mock WebSocket globally
    vi.stubGlobal('WebSocket', MockWebSocket)
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
  })

  it('initializes with default state', () => {
    const { result } = renderHook(() => useGenerate())

    expect(result.current.isGenerating).toBe(false)
    expect(result.current.progress).toBe(0)
    expect(result.current.status).toBeNull()
    expect(result.current.photoUrl).toBeNull()
    expect(result.current.musclesUrl).toBeNull()
    expect(result.current.error).toBeNull()
  })

  it('has generate function', () => {
    const { result } = renderHook(() => useGenerate())
    expect(typeof result.current.generate).toBe('function')
  })

  it('has generateFromPose function', () => {
    const { result } = renderHook(() => useGenerate())
    expect(typeof result.current.generateFromPose).toBe('function')
  })

  it('has generateFromText function', () => {
    const { result } = renderHook(() => useGenerate())
    expect(typeof result.current.generateFromText).toBe('function')
  })

  it('has reset function', () => {
    const { result } = renderHook(() => useGenerate())
    expect(typeof result.current.reset).toBe('function')
  })

  it('reset clears state', async () => {
    const { result } = renderHook(() => useGenerate())

    act(() => {
      result.current.reset()
    })

    expect(result.current.isGenerating).toBe(false)
    expect(result.current.progress).toBe(0)
    expect(result.current.status).toBeNull()
    expect(result.current.photoUrl).toBeNull()
    expect(result.current.musclesUrl).toBeNull()
    expect(result.current.error).toBeNull()
  })

  describe('generate with additionalNotes', () => {
    it('calls API with file only when no additionalNotes provided', async () => {
      const { result } = renderHook(() => useGenerate())
      const mockFile = new File(['test'], 'test.png', { type: 'image/png' })

      await act(async () => {
        await result.current.generate(mockFile)
      })

      expect(mockGenerateApi.generate).toHaveBeenCalledTimes(1)
      expect(mockGenerateApi.generate).toHaveBeenCalledWith(mockFile, undefined)
    })

    it('calls API with file and additionalNotes when provided', async () => {
      const { result } = renderHook(() => useGenerate())
      const mockFile = new File(['test'], 'test.png', { type: 'image/png' })
      const additionalNotes = 'Focus on back muscles'

      await act(async () => {
        await result.current.generate(mockFile, additionalNotes)
      })

      expect(mockGenerateApi.generate).toHaveBeenCalledTimes(1)
      expect(mockGenerateApi.generate).toHaveBeenCalledWith(mockFile, additionalNotes)
    })

    it('calls API with empty string additionalNotes when provided as empty', async () => {
      const { result } = renderHook(() => useGenerate())
      const mockFile = new File(['test'], 'test.png', { type: 'image/png' })

      await act(async () => {
        await result.current.generate(mockFile, '')
      })

      expect(mockGenerateApi.generate).toHaveBeenCalledWith(mockFile, '')
    })

    it('sets isGenerating to true when generation starts', async () => {
      const { result } = renderHook(() => useGenerate())
      const mockFile = new File(['test'], 'test.png', { type: 'image/png' })

      // Don't await - check state during generation
      act(() => {
        result.current.generate(mockFile, 'Test notes')
      })

      expect(result.current.isGenerating).toBe(true)
      expect(result.current.status).toBe('pending')
    })
  })

  describe('generateFromPose with additionalNotes', () => {
    it('calls API with poseId only when no additionalNotes provided', async () => {
      const { result } = renderHook(() => useGenerate())

      await act(async () => {
        await result.current.generateFromPose(42)
      })

      expect(mockGenerateApi.generateFromPose).toHaveBeenCalledTimes(1)
      expect(mockGenerateApi.generateFromPose).toHaveBeenCalledWith(42, undefined)
    })

    it('calls API with poseId and additionalNotes when provided', async () => {
      const { result } = renderHook(() => useGenerate())
      const additionalNotes = 'Emphasize stretching position'

      await act(async () => {
        await result.current.generateFromPose(42, additionalNotes)
      })

      expect(mockGenerateApi.generateFromPose).toHaveBeenCalledTimes(1)
      expect(mockGenerateApi.generateFromPose).toHaveBeenCalledWith(42, additionalNotes)
    })
  })

  describe('generateFromText with additionalNotes', () => {
    it('calls API with description only when no additionalNotes provided', async () => {
      const { result } = renderHook(() => useGenerate())
      const description = 'A warrior pose with arms raised'

      await act(async () => {
        await result.current.generateFromText(description)
      })

      expect(mockGenerateApi.generateFromText).toHaveBeenCalledTimes(1)
      expect(mockGenerateApi.generateFromText).toHaveBeenCalledWith(description, undefined)
    })

    it('calls API with description and additionalNotes when provided', async () => {
      const { result } = renderHook(() => useGenerate())
      const description = 'A warrior pose with arms raised'
      const additionalNotes = 'Show muscle engagement in legs'

      await act(async () => {
        await result.current.generateFromText(description, additionalNotes)
      })

      expect(mockGenerateApi.generateFromText).toHaveBeenCalledTimes(1)
      expect(mockGenerateApi.generateFromText).toHaveBeenCalledWith(description, additionalNotes)
    })
  })

  describe('error handling', () => {
    it('sets error state when API call fails', async () => {
      mockGenerateApi.generate.mockRejectedValueOnce(new Error('Network error'))
      const { result } = renderHook(() => useGenerate())
      const mockFile = new File(['test'], 'test.png', { type: 'image/png' })

      await act(async () => {
        await result.current.generate(mockFile)
      })

      expect(result.current.isGenerating).toBe(false)
      expect(result.current.error).toBe('Network error')
    })

    it('clears error on reset', async () => {
      mockGenerateApi.generate.mockRejectedValueOnce(new Error('Network error'))
      const { result } = renderHook(() => useGenerate())
      const mockFile = new File(['test'], 'test.png', { type: 'image/png' })

      await act(async () => {
        await result.current.generate(mockFile)
      })

      expect(result.current.error).toBe('Network error')

      act(() => {
        result.current.reset()
      })

      expect(result.current.error).toBeNull()
    })
  })

  describe('task ID handling', () => {
    it('stores task ID from API response', async () => {
      const { result } = renderHook(() => useGenerate())
      const mockFile = new File(['test'], 'test.png', { type: 'image/png' })

      await act(async () => {
        await result.current.generate(mockFile, 'Test notes')
      })

      expect(result.current.taskId).toBe('test-task-123')
    })

    it('clears task ID on reset', async () => {
      const { result } = renderHook(() => useGenerate())
      const mockFile = new File(['test'], 'test.png', { type: 'image/png' })

      await act(async () => {
        await result.current.generate(mockFile)
      })

      expect(result.current.taskId).toBe('test-task-123')

      act(() => {
        result.current.reset()
      })

      expect(result.current.taskId).toBeNull()
    })
  })
})
