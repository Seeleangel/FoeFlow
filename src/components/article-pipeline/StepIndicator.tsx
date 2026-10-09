interface StepIndicatorProps {
  currentStep: number; // 1, 2, or 3
}

const STEPS = [
  { label: '分析', key: 1 },
  { label: '方向', key: 2 },
  { label: '生成', key: 3 },
];

export default function StepIndicator({ currentStep }: StepIndicatorProps) {
  const clampedStep = Math.max(1, Math.min(3, currentStep));

  return (
    <div className="flex items-center gap-2 mb-6 px-1">
      {STEPS.map((step, idx) => {
        const isActive = step.key === clampedStep;
        const isPast = step.key < clampedStep;
        const isLast = idx === STEPS.length - 1;

        return (
          <div key={step.key} className="flex items-center gap-1.5 flex-1">
            <div
              className="flex items-center gap-1.5"
              aria-current={isActive ? 'step' : undefined}
            >
              <div
                className={`w-6 h-6 rounded-full flex items-center justify-center text-[11px] font-semibold transition-colors duration-500 ${
                  isActive || isPast
                    ? 'bg-red-600 text-white'
                    : 'bg-stone-200 text-stone-400'
                }`}
              >
                {step.key}
              </div>
              <span
                className={`text-xs font-medium whitespace-nowrap transition-colors duration-500 ${
                  isActive ? 'text-red-600' : isPast ? 'text-stone-600' : 'text-stone-400'
                }`}
              >
                {step.label}
              </span>
            </div>
            {!isLast && (
              <div
                data-testid="step-connector"
                className={`flex-1 h-0.5 rounded transition-colors duration-500 ${
                  isPast ? 'bg-red-600' : 'bg-stone-200'
                }`}
              />
            )}
          </div>
        );
      })}
    </div>
  );
}
