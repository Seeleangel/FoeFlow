import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent, act } from '@testing-library/react'
import WelcomeModal from '../WelcomeModal'

describe('WelcomeModal', () => {
  it('renders step 1 with welcome text', () => {
    render(<WelcomeModal onClose={vi.fn()} />)
    expect(screen.getByText('FoeFlow')).toBeInTheDocument()
    expect(screen.getByText('公众号推文创作与审核助手')).toBeInTheDocument()
  })

  it('advances to step 2 when clicking next', () => {
    render(<WelcomeModal onClose={vi.fn()} />)
    fireEvent.click(screen.getByRole('button', { name: /下一步/i }))
    expect(screen.getByText('审核台')).toBeInTheDocument()
    expect(screen.getByText('生成器')).toBeInTheDocument()
  })

  it('does not show next button on step 4', () => {
    render(<WelcomeModal onClose={vi.fn()} />)
    const nextBtn = screen.getByRole('button', { name: /下一步/i })
    fireEvent.click(nextBtn)
    fireEvent.click(nextBtn)
    fireEvent.click(nextBtn)
    expect(screen.queryByRole('button', { name: /下一步/i })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: /前往设置页面配置/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /稍后再说/i })).toBeInTheDocument()
  })
})

describe('WelcomeModal keyboard navigation', () => {
  it('handles Enter to advance step', () => {
    render(<WelcomeModal onClose={vi.fn()} />)
    act(() => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' }))
    })
    expect(screen.getByText('审核台')).toBeInTheDocument()
  })

  it('handles ArrowRight to advance and ArrowLeft to go back', () => {
    render(<WelcomeModal onClose={vi.fn()} />)
    act(() => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight' }))
    })
    expect(screen.getByText('审核台')).toBeInTheDocument()

    act(() => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft' }))
    })
    expect(screen.getByText('FoeFlow')).toBeInTheDocument()
  })

  it('calls onClose with undefined when pressing Escape on step 4', () => {
    const onClose = vi.fn()
    render(<WelcomeModal onClose={onClose} />)
    // Navigate to step 4
    act(() => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' }))
    })
    act(() => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' }))
    })
    act(() => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' }))
    })
    expect(screen.getByText('使用前准备')).toBeInTheDocument()

    act(() => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))
    })
    expect(onClose).toHaveBeenCalledWith(undefined)
  })
})
