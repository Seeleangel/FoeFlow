import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import ProgressPanel from '../../../src/components/article-pipeline/ProgressPanel';

describe('ProgressPanel', () => {
  it('shows generating stage with timeline', () => {
    render(<ProgressPanel stage="generating" fixRounds={0} />);
    expect(screen.getByText('文章流水线运行中')).toBeInTheDocument();
    expect(screen.getByText('创作中')).toBeInTheDocument();
  });

  it('shows reviewing stage with timeline', () => {
    render(<ProgressPanel stage="reviewing" fixRounds={0} />);
    expect(screen.getByText('文章流水线运行中')).toBeInTheDocument();
    expect(screen.getByText('评审中')).toBeInTheDocument();
  });

  it('shows fixing stage with fix rounds in status text', () => {
    render(<ProgressPanel stage="fixing" fixRounds={2} />);
    expect(screen.getByText('文章流水线运行中')).toBeInTheDocument();
    expect(screen.getByText('优化中')).toBeInTheDocument();
  });

  it('renders all 3 timeline step labels', () => {
    render(<ProgressPanel stage="generating" fixRounds={0} />);
    expect(screen.getByText('生成文章')).toBeInTheDocument();
    expect(screen.getByText('质量评审')).toBeInTheDocument();
    expect(screen.getByText('自动优化')).toBeInTheDocument();
  });

  it('shows complete stage with header and fix rounds', () => {
    render(<ProgressPanel stage="complete" fixRounds={2} />);
    expect(screen.getByText('文章生成完成')).toBeInTheDocument();
    expect(screen.getByText(/共自动优化 2 处问题/)).toBeInTheDocument();
  });
});
