import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import DirectionSelectPanel from '../../../src/components/article-pipeline/DirectionSelectPanel';
import type { WritingDirection } from '../../../src/types/article';

const mockDirections: WritingDirection[] = [
  {
    id: 'dir-1',
    name: '稳妥保守型',
    angle: '平铺直叙',
    structure: '总分总',
    tone: '正式庄重',
    features: ['结构清晰', '措辞规范'],
    whyFit: '适合正式通知场景',
  },
  {
    id: 'dir-2',
    name: '创意突破型',
    angle: '故事化引入',
    structure: '递进式',
    tone: '活泼亲切',
    features: ['引人入胜', '情感共鸣'],
    whyFit: '适合吸引年轻读者',
  },
];

describe('DirectionSelectPanel', () => {
  it('renders direction list', () => {
    render(<DirectionSelectPanel directions={mockDirections} onSelect={vi.fn()} onBack={vi.fn()} />);
    expect(screen.getByText('稳妥保守型')).toBeInTheDocument();
    expect(screen.getByText('创意突破型')).toBeInTheDocument();
  });

  it('shows angle and structure info', () => {
    render(<DirectionSelectPanel directions={mockDirections} onSelect={vi.fn()} onBack={vi.fn()} />);
    expect(screen.getByText(/平铺直叙/)).toBeInTheDocument();
    expect(screen.getByText(/故事化引入/)).toBeInTheDocument();
  });

  it('calls onSelect with direction when clicked', () => {
    const onSelect = vi.fn();
    render(<DirectionSelectPanel directions={mockDirections} onSelect={onSelect} onBack={vi.fn()} />);
    fireEvent.click(screen.getByText('稳妥保守型'));
    expect(onSelect).toHaveBeenCalledWith(mockDirections[0]);
  });

  it('calls onBack when back button clicked', () => {
    const onBack = vi.fn();
    render(<DirectionSelectPanel directions={mockDirections} onSelect={vi.fn()} onBack={onBack} />);
    fireEvent.click(screen.getByText('返回风格确认'));
    expect(onBack).toHaveBeenCalled();
  });

  it('shows loading state when no directions', () => {
    render(<DirectionSelectPanel directions={[]} onSelect={vi.fn()} onBack={vi.fn()} />);
    expect(screen.getByText('正在推荐写作方向…')).toBeInTheDocument();
  });
});
