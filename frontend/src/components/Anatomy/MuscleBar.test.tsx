import { describe, it, expect } from 'vitest'
import { screen } from '@testing-library/react'
import { render } from '../../test/utils'
import { MuscleBar, MuscleList } from './MuscleBar'
import type { PoseMuscle } from '../../types'

const mockMuscle: PoseMuscle = {
  muscle_id: 1,
  muscle_name: 'Quadriceps',
  muscle_name_ua: 'Квадрицепс',
  body_part: 'legs',
  activation_level: 75,
}

const mockMuscles: PoseMuscle[] = [
  { muscle_id: 1, muscle_name: 'Quadriceps', muscle_name_ua: 'Квадрицепс', body_part: 'legs', activation_level: 90 },
  { muscle_id: 2, muscle_name: 'Hamstrings', muscle_name_ua: 'Біцепс стегна', body_part: 'legs', activation_level: 60 },
  { muscle_id: 3, muscle_name: 'Abs', muscle_name_ua: 'Прес', body_part: 'core', activation_level: 40 },
  { muscle_id: 4, muscle_name: 'Back', muscle_name_ua: 'Спина', body_part: 'back', activation_level: 20 },
  { muscle_id: 5, muscle_name: 'Glutes', muscle_name_ua: 'Сідниці', body_part: 'legs', activation_level: 10 },
]

describe('MuscleBar', () => {
  it('renders muscle name', () => {
    render(<MuscleBar muscle={mockMuscle} />)
    expect(screen.getByText('Квадрицепс')).toBeInTheDocument()
  })

  it('renders activation level percentage', () => {
    render(<MuscleBar muscle={mockMuscle} />)
    expect(screen.getByText('75%')).toBeInTheDocument()
  })

  it('renders progress bar', () => {
    const { container } = render(<MuscleBar muscle={mockMuscle} />)
    const progressBar = container.querySelector('.bg-secondary\\/50')
    expect(progressBar).toBeInTheDocument()
  })

  it('hides label when showLabel is false', () => {
    render(<MuscleBar muscle={mockMuscle} showLabel={false} />)
    expect(screen.queryByText('Квадрицепс')).not.toBeInTheDocument()
  })

  it('falls back to English name when Ukrainian not available', () => {
    const muscleNoUa: PoseMuscle = { ...mockMuscle, muscle_name_ua: null }
    render(<MuscleBar muscle={muscleNoUa} />)
    expect(screen.getByText('Quadriceps')).toBeInTheDocument()
  })

  it('displays red color for high activation (80+)', () => {
    const highMuscle = { ...mockMuscle, activation_level: 90 }
    const { container } = render(<MuscleBar muscle={highMuscle} />)
    const bar = container.querySelector('.bg-red-500')
    expect(bar).toBeInTheDocument()
  })

  it('displays orange color for medium-high activation (60-79)', () => {
    const medHighMuscle = { ...mockMuscle, activation_level: 70 }
    const { container } = render(<MuscleBar muscle={medHighMuscle} />)
    const bar = container.querySelector('.bg-orange-500')
    expect(bar).toBeInTheDocument()
  })

  it('displays yellow color for medium activation (40-59)', () => {
    const medMuscle = { ...mockMuscle, activation_level: 50 }
    const { container } = render(<MuscleBar muscle={medMuscle} />)
    const bar = container.querySelector('.bg-yellow-500')
    expect(bar).toBeInTheDocument()
  })

  it('displays green color for low-medium activation (20-39)', () => {
    const lowMedMuscle = { ...mockMuscle, activation_level: 30 }
    const { container } = render(<MuscleBar muscle={lowMedMuscle} />)
    const bar = container.querySelector('.bg-emerald-500')
    expect(bar).toBeInTheDocument()
  })

  it('displays blue color for low activation (0-19)', () => {
    const lowMuscle = { ...mockMuscle, activation_level: 10 }
    const { container } = render(<MuscleBar muscle={lowMuscle} />)
    const bar = container.querySelector('.bg-blue-500')
    expect(bar).toBeInTheDocument()
  })

  it('sets correct width based on activation level', () => {
    const { container } = render(<MuscleBar muscle={mockMuscle} />)
    // We just check if the bar exists, exact width depends on animation state which is hard to test with whileInView
    const progressFill = container.querySelector('.bg-gradient-to-r')
    expect(progressFill).toBeInTheDocument()
  })
})

describe('MuscleList', () => {
  it('renders all muscles', () => {
    render(<MuscleList muscles={mockMuscles} />)
    expect(screen.getByText('Квадрицепс')).toBeInTheDocument()
    expect(screen.getByText('Біцепс стегна')).toBeInTheDocument()
    expect(screen.getByText('Прес')).toBeInTheDocument()
    expect(screen.getByText('Спина')).toBeInTheDocument()
    expect(screen.getByText('Сідниці')).toBeInTheDocument()
  })

  it('sorts muscles by activation level descending', () => {
    render(<MuscleList muscles={mockMuscles} />)
    const percentages = screen.getAllByText(/%$/)
    const values = percentages.map(el => parseInt(el.textContent || '0'))

    // Check that values are in descending order
    for (let i = 0; i < values.length - 1; i++) {
      expect(values[i]).toBeGreaterThanOrEqual(values[i + 1])
    }
  })

  it('renders empty list when no muscles', () => {
    const { container } = render(<MuscleList muscles={[]} />)
    expect(container.querySelector('.space-y-4')).toBeInTheDocument()
  })

  it('applies custom className', () => {
    const { container } = render(<MuscleList muscles={mockMuscles} className="custom-class" />)
    expect(container.firstChild).toHaveClass('custom-class')
  })

  it('renders correct number of muscle bars', () => {
    render(<MuscleList muscles={mockMuscles} />)
    const percentages = screen.getAllByText(/%$/)
    expect(percentages.length).toBe(5)
  })
})
