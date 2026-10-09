import { describe, it, expect, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import { invoke } from '@tauri-apps/api/core'
import LicenseGate from './LicenseGate'

describe('LicenseGate', () => {
  it('renders payment view with correct elements', async () => {
    vi.mocked(invoke).mockResolvedValue({ token: 'test-device', status: 'pending', code: null })
    render(<LicenseGate onActivated={() => {}} />)

    expect(screen.getByText('扫码支付获取校验码')).toBeInTheDocument()
    expect(screen.getByText('79')).toBeInTheDocument()
    expect(screen.getByText(/请使用微信扫码支付/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '我已完成支付' })).toBeInTheDocument()
    expect(screen.getByText('已有校验码？直接输入')).toBeInTheDocument()
    await waitFor(() => expect(screen.getByText('test-device')).toBeInTheDocument())
  })
})
