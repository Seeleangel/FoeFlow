import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import ArticlePipeline from '../../../src/components/article-pipeline/ArticlePipeline';
import type { ArticleStyleSpec, WritingDirection, ArticlePipelineStage } from '../../../src/types/article';

const mockSpec: ArticleStyleSpec = {
  articleType: '活动通知',
  tone: '激情号召',
  structure: '总分总',
  presentation: '混合节奏',
  keywords: ['青春热血'],
  reasoning: '五四主题团日活动需要激发青年热情。',
};

const mockDirections: WritingDirection[] = [
  {
    id: 'dir-1',
    name: '稳妥保守型',
    angle: '平铺直叙',
    structure: '总分总',
    tone: '正式庄重',
    features: [],
    whyFit: '适合正式通知',
  },
];

describe('ArticlePipeline', () => {
  const baseProps = {
    stage: 'styleConfirm' as ArticlePipelineStage,
    spec: mockSpec,
    directions: [] as WritingDirection[],
    review: null,
    fixRounds: 0,
    onConfirmStyle: vi.fn(),
    onSelectDirection: vi.fn(),
    onCancel: vi.fn(),
    onAdjustStyle: vi.fn(),
  };

  it('shows analyzing stage with skeleton', () => {
    render(<ArticlePipeline {...baseProps} stage="analyzing" />);
    expect(screen.getByText('正在分析文章风格…')).toBeInTheDocument();
  });

  it('shows styleConfirm stage with analysis panel', () => {
    render(<ArticlePipeline {...baseProps} stage="styleConfirm" />);
    expect(screen.getByText('确认风格，查看写作方向')).toBeInTheDocument();
  });

  it('shows directionSelect stage with direction list', () => {
    render(<ArticlePipeline {...baseProps} stage="directionSelect" directions={mockDirections} />);
    expect(screen.getByText('稳妥保守型')).toBeInTheDocument();
  });

  it('shows generating stage with progress panel', () => {
    render(<ArticlePipeline {...baseProps} stage="generating" />);
    expect(screen.getByText('文章流水线运行中')).toBeInTheDocument();
    expect(screen.getByText('创作中')).toBeInTheDocument();
  });

  it('shows reviewing stage with progress panel', () => {
    render(<ArticlePipeline {...baseProps} stage="reviewing" />);
    expect(screen.getByText('文章流水线运行中')).toBeInTheDocument();
    expect(screen.getByText('评审中')).toBeInTheDocument();
  });

  it('shows fixing stage with progress panel', () => {
    render(<ArticlePipeline {...baseProps} stage="fixing" fixRounds={1} />);
    expect(screen.getByText('文章流水线运行中')).toBeInTheDocument();
    expect(screen.getByText('优化中')).toBeInTheDocument();
  });

  it('shows complete stage with progress panel', () => {
    render(<ArticlePipeline {...baseProps} stage="complete" />);
    expect(screen.getByText('文章生成完成')).toBeInTheDocument();
  });

  it('renders cancel button', () => {
    render(<ArticlePipeline {...baseProps} />);
    expect(screen.getByText('取消')).toBeInTheDocument();
  });
});
