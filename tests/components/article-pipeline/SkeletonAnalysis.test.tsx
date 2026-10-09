import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import SkeletonAnalysis from '../../../src/components/article-pipeline/SkeletonAnalysis';

describe('SkeletonAnalysis', () => {
  it('renders loading text', () => {
    render(<SkeletonAnalysis />);
    expect(screen.getByText('正在分析文章风格…')).toBeInTheDocument();
  });

  it('renders skeleton placeholder blocks', () => {
    render(<SkeletonAnalysis />);
    // The skeleton card should have multiple animate-pulse elements
    const pulses = document.querySelectorAll('.animate-pulse');
    expect(pulses.length).toBeGreaterThan(0);
  });
});
