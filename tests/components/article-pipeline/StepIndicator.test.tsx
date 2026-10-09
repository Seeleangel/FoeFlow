import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import StepIndicator from '../../../src/components/article-pipeline/StepIndicator';

describe('StepIndicator', () => {
  it('renders 3 steps with labels', () => {
    render(<StepIndicator currentStep={1} />);
    expect(screen.getByText('分析')).toBeInTheDocument();
    expect(screen.getByText('方向')).toBeInTheDocument();
    expect(screen.getByText('生成')).toBeInTheDocument();
  });

  it('has transition classes on circles, labels, and lines', () => {
    render(<StepIndicator currentStep={1} />);
    const circle = screen.getByText('1');
    const label = screen.getByText('分析');
    expect(circle.className).toContain('transition-colors');
    expect(circle.className).toContain('duration-500');
    expect(label.className).toContain('transition-colors');
    expect(label.className).toContain('duration-500');
  });

  it('highlights current step circle and label in red', () => {
    render(<StepIndicator currentStep={2} />);
    const activeCircle = screen.getByText('2');
    const activeLabel = screen.getByText('方向');
    expect(activeCircle.className).toContain('bg-red-600');
    expect(activeLabel.className).toContain('text-red-600');
  });

  it('greys out future step labels with text-stone-400', () => {
    render(<StepIndicator currentStep={1} />);
    const futureLabel = screen.getByText('生成');
    expect(futureLabel.className).toContain('text-stone-400');
  });

  it('past step circles are bg-red-600', () => {
    render(<StepIndicator currentStep={2} />);
    const pastCircle = screen.getByText('1');
    expect(pastCircle.className).toContain('bg-red-600');
  });

  it('future step circles are bg-stone-200', () => {
    render(<StepIndicator currentStep={1} />);
    const futureCircle = screen.getByText('2');
    expect(futureCircle.className).toContain('bg-stone-200');
  });

  it('lines change color based on progress', () => {
    const { container: c1 } = render(<StepIndicator currentStep={1} />);
    const lines1 = c1.querySelectorAll('[data-testid="step-connector"]');
    expect(lines1[0].className).toContain('bg-stone-200');
    expect(lines1[1].className).toContain('bg-stone-200');

    const { container: c2 } = render(<StepIndicator currentStep={2} />);
    const lines2 = c2.querySelectorAll('[data-testid="step-connector"]');
    expect(lines2[0].className).toContain('bg-red-600');
    expect(lines2[1].className).toContain('bg-stone-200');

    const { container: c3 } = render(<StepIndicator currentStep={3} />);
    const lines3 = c3.querySelectorAll('[data-testid="step-connector"]');
    expect(lines3[0].className).toContain('bg-red-600');
    expect(lines3[1].className).toContain('bg-red-600');
  });

  it('active step has aria-current="step"', () => {
    render(<StepIndicator currentStep={2} />);
    const activeContainer = screen.getByText('方向').parentElement;
    expect(activeContainer).toHaveAttribute('aria-current', 'step');
  });

  it('clamps out-of-range currentStep values', () => {
    const { rerender } = render(<StepIndicator currentStep={0} />);
    let activeContainer = screen.getByText('分析').parentElement;
    expect(activeContainer).toHaveAttribute('aria-current', 'step');

    rerender(<StepIndicator currentStep={5} />);
    activeContainer = screen.getByText('生成').parentElement;
    expect(activeContainer).toHaveAttribute('aria-current', 'step');
  });
});
