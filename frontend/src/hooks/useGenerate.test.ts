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
    getStatus: vi.fn(),
    getWebSocketUrl: vi.fn(() => 'ws://localhost:8000/ws/generate/test-task'),
  },
  tokenManager: {
    silentRefresh: vi.fn(async () => true),
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
    getStatus: ReturnType<typeof vi.fn>
    getWebSocketUrl: ReturnType<typeof vi.fn>
  }

  beforeEach(() => {
    vi.useFakeTimers()
    vi.clearAllMocks()

    // Setup default mock responses
    mockGenerateApi.generate.mockResolvedValue({ task_id: 'test-task-123' })
    mockGenerateApi.generateFromPose.mockResolvedValue({ task_id: 'test-task-456' })
    mockGenerateApi.generateFromText.mockResolvedValue({ task_id: 'test-task-789' })
    mockGenerateApi.getStatus.mockResolvedValue({ task_id: 'test-task-123', status: 'processing', progress: 0 })

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
      expect(mockGenerateApi.generate).toHaveBeenCalledWith(
        mockFile,
        undefined,
        true,
      )
    })

    it('calls API with file and additionalNotes when provided', async () => {
      const { result } = renderHook(() => useGenerate())
      const mockFile = new File(['test'], 'test.png', { type: 'image/png' })
      const additionalNotes = 'Focus on back muscles'

      await act(async () => {
        await result.current.generate(mockFile, additionalNotes)
      })

      expect(mockGenerateApi.generate).toHaveBeenCalledTimes(1)
      expect(mockGenerateApi.generate).toHaveBeenCalledWith(
        mockFile,
        additionalNotes,
        true,
      )
    })

    it('calls API with empty string additionalNotes when provided as empty', async () => {
      const { result } = renderHook(() => useGenerate())
      const mockFile = new File(['test'], 'test.png', { type: 'image/png' })

      await act(async () => {
        await result.current.generate(mockFile, '')
      })

      expect(mockGenerateApi.generate).toHaveBeenCalledWith(mockFile, '', true)
    })

    it('forwards generateMuscles=false to API', async () => {
      const { result } = renderHook(() => useGenerate())
      const mockFile = new File(['test'], 'test.png', { type: 'image/png' })

      await act(async () => {
        await result.current.generate(mockFile, undefined, false)
      })

      expect(mockGenerateApi.generate).toHaveBeenCalledWith(
        mockFile,
        undefined,
        false,
      )
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
      expect(mockGenerateApi.generateFromPose).toHaveBeenCalledWith(
        42,
        undefined,
        true,
      )
    })

    it('calls API with poseId and additionalNotes when provided', async () => {
      const { result } = renderHook(() => useGenerate())
      const additionalNotes = 'Emphasize stretching position'

      await act(async () => {
        await result.current.generateFromPose(42, additionalNotes)
      })

      expect(mockGenerateApi.generateFromPose).toHaveBeenCalledTimes(1)
      expect(mockGenerateApi.generateFromPose).toHaveBeenCalledWith(
        42,
        additionalNotes,
        true,
      )
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
      expect(mockGenerateApi.generateFromText).toHaveBeenCalledWith(
        description,
        undefined,
        true,
      )
    })

    it('calls API with description and additionalNotes when provided', async () => {
      const { result } = renderHook(() => useGenerate())
      const description = 'A warrior pose with arms raised'
      const additionalNotes = 'Show muscle engagement in legs'

      await act(async () => {
        await result.current.generateFromText(description, additionalNotes)
      })

      expect(mockGenerateApi.generateFromText).toHaveBeenCalledTimes(1)
      expect(mockGenerateApi.generateFromText).toHaveBeenCalledWith(
        description,
        additionalNotes,
        true,
      )
    })
  })

  describe('error handling', () => {
    it('sets error state when API call fails', async () => {
      mockGenerateApi.generate.mockRejectedValueOnce(new Error('Network error'))
      const { result } = renderHook(() => useGenerate())
      const mockFile = new File(['test'], 'test.png', { type: 'image/png' })

      await act(async () => {
        await expect(result.current.generate(mockFile)).rejects.toThrow('Network error')
      })

      expect(result.current.isGenerating).toBe(false)
      expect(result.current.error).toBe('Network error')
    })

    it('clears error on reset', async () => {
      mockGenerateApi.generate.mockRejectedValueOnce(new Error('Network error'))
      const { result } = renderHook(() => useGenerate())
      const mockFile = new File(['test'], 'test.png', { type: 'image/png' })

      await act(async () => {
        await expect(result.current.generate(mockFile)).rejects.toThrow('Network error')
      })

      expect(result.current.error).toBe('Network error')

      act(() => {
        result.current.reset()
      })

      expect(result.current.error).toBeNull()
    })
  })

  it('falls back to polling when WebSocket does not open', async () => {
    const { result } = renderHook(() => useGenerate())
    const mockFile = new File(['test'], 'test.png', { type: 'image/png' })

    // WebSocket will be created but never opened (onopen never called in this mock).
    mockGenerateApi.getStatus.mockResolvedValueOnce({
      task_id: 'test-task-123',
      status: 'completed',
      progress: 100,
      status_message: 'Completed!',
      error_message: null,
      photo_url: '/storage/generated/photo.png',
      muscles_url: '/storage/generated/muscles.png',
      quota_warning: false,
      analyzed_muscles: [{ name: 'quadriceps', activation_level: 80 }],
    })

    await act(async () => {
      await result.current.generate(mockFile)
    })

    // Advance timers past WS fallback delay so polling starts.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2600)
    })

    expect(mockGenerateApi.getStatus).toHaveBeenCalled()
    expect(result.current.status).toBe('completed')
    expect(result.current.isGenerating).toBe(false)
    expect(result.current.photoUrl).toBe('/storage/generated/photo.png')
    expect(result.current.musclesUrl).toBe('/storage/generated/muscles.png')
    expect(result.current.analyzedMuscles?.[0]?.name).toBe('quadriceps')
  })

  it('falls back to polling when WebSocket opens but stays silent', async () => {
    const sockets: MockWebSocket[] = []
    class AutoOpenSilentWebSocket extends MockWebSocket {
      constructor() {
        super()
        sockets.push(this)
        // Trigger onopen asynchronously after handlers are assigned.
        setTimeout(() => this.onopen?.(), 0)
      }
    }

    vi.stubGlobal('WebSocket', AutoOpenSilentWebSocket)

    const { result } = renderHook(() => useGenerate())
    const mockFile = new File(['test'], 'test.png', { type: 'image/png' })

    // Polling should eventually complete even if WS never delivers progress_update.
    mockGenerateApi.getStatus.mockResolvedValueOnce({
      task_id: 'test-task-123',
      status: 'completed',
      progress: 100,
      status_message: 'Completed!',
      error_message: null,
      photo_url: '/storage/generated/photo.png',
      muscles_url: '/storage/generated/muscles.png',
      quota_warning: false,
      analyzed_muscles: null,
    })

    await act(async () => {
      await result.current.generate(mockFile)
    })

    // Allow onopen to run.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1)
    })
    expect(sockets.length).toBeGreaterThan(0)

    // Advance past silent fallback delay so polling starts.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(4000)
    })

    expect(mockGenerateApi.getStatus).toHaveBeenCalled()
    expect(result.current.status).toBe('completed')
    expect(result.current.isGenerating).toBe(false)
    expect(result.current.photoUrl).toBe('/storage/generated/photo.png')
  })

  it('falls back to polling when WebSocket closes with code 1000', async () => {
    const sockets: MockWebSocket[] = []
    class OpenThenCloseWebSocket extends MockWebSocket {
      constructor() {
        super()
        sockets.push(this)
        setTimeout(() => this.onopen?.(), 0)
        setTimeout(() => this.onclose?.({ code: 1000 }), 10)
      }
    }

    vi.stubGlobal('WebSocket', OpenThenCloseWebSocket)

    const { result } = renderHook(() => useGenerate())
    const mockFile = new File(['test'], 'test.png', { type: 'image/png' })

    mockGenerateApi.getStatus.mockResolvedValueOnce({
      task_id: 'test-task-123',
      status: 'completed',
      progress: 100,
      status_message: 'Completed!',
      error_message: null,
      photo_url: '/storage/generated/photo.png',
      muscles_url: '/storage/generated/muscles.png',
      quota_warning: false,
      analyzed_muscles: null,
    })

    await act(async () => {
      await result.current.generate(mockFile)
    })

    await act(async () => {
      await vi.advanceTimersByTimeAsync(2600)
    })

    expect(mockGenerateApi.getStatus).toHaveBeenCalled()
    expect(result.current.status).toBe('completed')
    expect(result.current.isGenerating).toBe(false)
  })

  it('falls back to polling when WebSocket sends only initial status update', async () => {
    const sockets: MockWebSocket[] = []
    class AutoOpenWithInitialStatusWebSocket extends MockWebSocket {
      constructor() {
        super()
        sockets.push(this)
        setTimeout(() => {
          this.onopen?.()
          setTimeout(() => {
            this.onmessage?.({
              data: JSON.stringify({
                type: 'progress_update',
                task_id: 'test-task-123',
                status: 'processing',
                progress: 0,
                status_message: 'Initializing...',
              }),
            })
          }, 1)
        }, 0)
      }
    }

    vi.stubGlobal('WebSocket', AutoOpenWithInitialStatusWebSocket)

    const { result } = renderHook(() => useGenerate())
    const mockFile = new File(['test'], 'test.png', { type: 'image/png' })

    mockGenerateApi.getStatus.mockResolvedValueOnce({
      task_id: 'test-task-123',
      status: 'completed',
      progress: 100,
      status_message: 'Completed!',
      error_message: null,
      photo_url: '/storage/generated/photo.png',
      muscles_url: '/storage/generated/muscles.png',
      quota_warning: false,
      analyzed_muscles: null,
    })

    await act(async () => {
      await result.current.generate(mockFile)
    })

    await act(async () => {
      await vi.advanceTimersByTimeAsync(10)
    })
    expect(sockets.length).toBeGreaterThan(0)

    await act(async () => {
      await vi.advanceTimersByTimeAsync(4000)
    })

    expect(mockGenerateApi.getStatus).toHaveBeenCalled()
    expect(result.current.status).toBe('completed')
    expect(result.current.progress).toBe(100)
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
