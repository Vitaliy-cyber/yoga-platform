import { describe, it, expect, vi, beforeEach } from 'vitest'
import { screen, fireEvent } from '@testing-library/react'
import { render } from '../../test/utils'
import { Dropzone } from './Dropzone'

describe('Dropzone', () => {
  const mockOnFileSelect = vi.fn()
  const mockOnClear = vi.fn()

  beforeEach(() => {
    mockOnFileSelect.mockClear()
    mockOnClear.mockClear()
  })

  it('renders empty state correctly', () => {
    render(
      <Dropzone
        onFileSelect={mockOnFileSelect}
        selectedFile={null}
        onClear={mockOnClear}
      />
    )
    expect(screen.getByText('Click or drag file')).toBeInTheDocument()
    expect(screen.getByText(/Supports SVG/)).toBeInTheDocument()
  })

  it('shows file format info', () => {
    render(
      <Dropzone
        onFileSelect={mockOnFileSelect}
        selectedFile={null}
        onClear={mockOnClear}
      />
    )
    expect(screen.getByText(/max 10MB/)).toBeInTheDocument()
  })

  it('renders selected file preview', () => {
    const mockFile = new File(['test'], 'test.png', { type: 'image/png' })

    render(
      <Dropzone
        onFileSelect={mockOnFileSelect}
        selectedFile={mockFile}
        onClear={mockOnClear}
      />
    )

    expect(screen.getByText('test.png')).toBeInTheDocument()
  })

  it('shows file size when file is selected', () => {
    const mockFile = new File(['test content'], 'test.png', { type: 'image/png' })

    render(
      <Dropzone
        onFileSelect={mockOnFileSelect}
        selectedFile={mockFile}
        onClear={mockOnClear}
      />
    )

    // File size should be displayed properly
    expect(screen.getByText(/MB/)).toBeInTheDocument()
  })

  it('renders clear button when file is selected', () => {
    const mockFile = new File(['test'], 'test.png', { type: 'image/png' })

    render(
      <Dropzone
        onFileSelect={mockOnFileSelect}
        selectedFile={mockFile}
        onClear={mockOnClear}
      />
    )

    const clearButton = screen.getByRole('button')
    expect(clearButton).toBeInTheDocument()
  })

  it('calls onClear when clear button is clicked', () => {
    const mockFile = new File(['test'], 'test.png', { type: 'image/png' })

    render(
      <Dropzone
        onFileSelect={mockOnFileSelect}
        selectedFile={mockFile}
        onClear={mockOnClear}
      />
    )

    const clearButton = screen.getByRole('button')
    fireEvent.click(clearButton)
    expect(mockOnClear).toHaveBeenCalled()
  })

  it('has file input element', () => {
    render(
      <Dropzone
        onFileSelect={mockOnFileSelect}
        selectedFile={null}
        onClear={mockOnClear}
      />
    )

    const input = document.querySelector('input[type="file"]')
    expect(input).toBeInTheDocument()
  })

  it('renders image preview for selected file', () => {
    const mockFile = new File(['test'], 'test.png', { type: 'image/png' })

    render(
      <Dropzone
        onFileSelect={mockOnFileSelect}
        selectedFile={mockFile}
        onClear={mockOnClear}
      />
    )

    const img = screen.getByAltText('Preview')
    expect(img).toBeInTheDocument()
  })


})
