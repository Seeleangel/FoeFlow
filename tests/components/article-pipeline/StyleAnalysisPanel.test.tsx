import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import StyleAnalysisPanel from '../../../src/components/article-pipeline/StyleAnalysisPanel';
import type { ArticleStyleSpec } from '../../../src/types/article';

const mockSpec: ArticleStyleSpec = {
  articleType: '活动通知',
  tone: '激情号召',
  structure: '总分总',
  presentation: '混合节奏',
  keywords: ['青春热血', '使命担当'],
  reasoning: '五四主题团日活动需要激发青年热情。',
};

describe('StyleAnalysisPanel', () => {
  it('renders all spec fields with icons', () => {
    render(<StyleAnalysisPanel spec={mockSpec} onConfirm={vi.fn()} onAdjust={vi.fn()} onSkip={vi.fn()} />);
    expect(screen.getByText('活动通知')).toBeInTheDocument();
    expect(screen.getByText('激情号召')).toBeInTheDocument();
    expect(screen.getByText('总分总')).toBeInTheDocument();
    expect(screen.getByText('混合节奏')).toBeInTheDocument();
  });

  it('renders reasoning with left border', () => {
    render(<StyleAnalysisPanel spec={mockSpec} onConfirm={vi.fn()} onAdjust={vi.fn()} onSkip={vi.fn()} />);
    expect(screen.getByText(/五四主题团日活动/)).toBeInTheDocument();
  });

  it('calls onConfirm when primary button clicked', () => {
    const onConfirm = vi.fn();
    render(<StyleAnalysisPanel spec={mockSpec} onConfirm={onConfirm} onAdjust={vi.fn()} onSkip={vi.fn()} />);
    fireEvent.click(screen.getByText('确认风格，查看写作方向'));
    expect(onConfirm).toHaveBeenCalled();
  });

  it('calls onAdjust when secondary button clicked', () => {
    const onAdjust = vi.fn();
    render(<StyleAnalysisPanel spec={mockSpec} onConfirm={vi.fn()} onAdjust={onAdjust} onSkip={vi.fn()} />);
    fireEvent.click(screen.getByText('调整要求'));
    expect(onAdjust).toHaveBeenCalled();
  });

  it('calls onSkip when tertiary button clicked', () => {
    const onSkip = vi.fn();
    render(<StyleAnalysisPanel spec={mockSpec} onConfirm={vi.fn()} onAdjust={vi.fn()} onSkip={onSkip} />);
    fireEvent.click(screen.getByText('跳过优化，保留当前版本'));
    expect(onSkip).toHaveBeenCalled();
  });
});
