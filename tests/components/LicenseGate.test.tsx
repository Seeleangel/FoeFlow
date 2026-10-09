import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import LicenseGate from '../../src/components/LicenseGate';
import { invoke } from '@tauri-apps/api/core';

const mockedInvoke = vi.mocked(invoke);

describe('LicenseGate', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Default mock: the eager useEffect calls claim_license_request on mount.
    mockedInvoke.mockImplementation(async (cmd: string) => {
      if (cmd === 'claim_license_request') {
        return { token: 'default-token', status: 'pending', code: null };
      }
      return {};
    });
  });

  it('renders payment guide view by default', async () => {
    render(<LicenseGate onActivated={() => {}} />);
    expect(screen.getByText('扫码支付获取校验码')).toBeInTheDocument();
    expect(screen.getByText('我已完成支付')).toBeInTheDocument();
    expect(screen.getByText('已有校验码？直接输入')).toBeInTheDocument();
    // Device identifier should be visible after eager fetch resolves
    await waitFor(() => {
      expect(screen.getByText('default-token')).toBeInTheDocument();
    });
  });

  it('switches to code input view when clicking "已有校验码"', () => {
    render(<LicenseGate onActivated={() => {}} />);
    fireEvent.click(screen.getByText('已有校验码？直接输入'));
    expect(screen.getByText('请输入校验码')).toBeInTheDocument();
    expect(screen.getByPlaceholderText('XXXX-XXXX-XXXX-XXXX')).toBeInTheDocument();
  });

  it('switches back to payment view from input view', () => {
    render(<LicenseGate onActivated={() => {}} />);
    fireEvent.click(screen.getByText('已有校验码？直接输入'));
    fireEvent.click(screen.getByText('没有校验码？扫码获取'));
    expect(screen.getByText('扫码支付获取校验码')).toBeInTheDocument();
  });

  it('starts polling and auto-activates when code is approved immediately', async () => {
    const onActivated = vi.fn();
    mockedInvoke.mockImplementation(async (cmd: string, args?: unknown) => {
      if (cmd === 'claim_license_request') {
        return { token: 'test-token-123', status: 'approved', code: 'ABCD-EFGH-IJKL-MNOP' };
      }
      if (cmd === 'verify_license') {
        return { code: 'ABCD-EFGH-IJKL-MNOP', fingerprint: 'fp', token: 'tk', expires_at: 9999999999 };
      }
      return {};
    });

    render(<LicenseGate onActivated={onActivated} />);
    fireEvent.click(screen.getByText('我已完成支付'));

    await waitFor(() => {
      expect(onActivated).toHaveBeenCalledWith(
        expect.objectContaining({ code: 'ABCD-EFGH-IJKL-MNOP' })
      );
    });
  });

  it('shows waiting view when claim is pending', async () => {
    mockedInvoke.mockImplementation(async (cmd: string) => {
      if (cmd === 'claim_license_request') {
        return { token: 'pending-token-456', status: 'pending', code: null };
      }
      return {};
    });

    render(<LicenseGate onActivated={() => {}} />);
    fireEvent.click(screen.getByText('我已完成支付'));

    await waitFor(() => {
      expect(screen.getByText('正在等待管理员审核')).toBeInTheDocument();
      expect(screen.getByText('pending-token-456')).toBeInTheDocument();
    });
  });

  it('activates with manually entered code', async () => {
    const onActivated = vi.fn();
    mockedInvoke.mockImplementation(async (cmd: string, args?: unknown) => {
      if (cmd === 'verify_license') {
        return { code: (args as { code: string }).code, fingerprint: 'fp', token: 'tk', expires_at: 9999999999 };
      }
      return {};
    });

    render(<LicenseGate onActivated={onActivated} />);
    fireEvent.click(screen.getByText('已有校验码？直接输入'));

    const input = screen.getByPlaceholderText('XXXX-XXXX-XXXX-XXXX');
    fireEvent.change(input, { target: { value: 'ABCD-EFGH-JKMN-PRST' } });

    fireEvent.click(screen.getByText('激活'));

    await waitFor(() => {
      expect(onActivated).toHaveBeenCalled();
    });
  });
});
