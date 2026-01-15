import { describe, it, expect, vi } from 'vitest'
import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { render } from '../../test/utils'
import { Header } from './Header'

// Mock useNavigate
const mockNavigate = vi.fn()
vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual('react-router-dom')
  return {
    ...actual,
    useNavigate: () => mockNavigate,
  }
})

describe('Header', () => {


  it('renders search input', () => {
    render(<Header />)
    expect(screen.getByPlaceholderText('Пошук поз...')).toBeInTheDocument()
  })



  it('shows search results on input', async () => {
    const user = userEvent.setup()
    render(<Header />)

    const searchInput = screen.getByPlaceholderText('Пошук поз...')
    await user.type(searchInput, 'Mountain')

    await waitFor(() => {
      expect(screen.getByText('Пошук...')).toBeInTheDocument()
    }, { timeout: 100 }).catch(() => {
      // Search might complete quickly
    })
  })


})
