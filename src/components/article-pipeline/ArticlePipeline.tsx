import StepIndicator from './StepIndicator';
import SkeletonAnalysis from './SkeletonAnalysis';
import StyleAnalysisPanel from './StyleAnalysisPanel';
import DirectionSelectPanel from './DirectionSelectPanel';
import ProgressPanel from './ProgressPanel';
import type { ArticleStyleSpec, WritingDirection, ArticleReview, ArticlePipelineStage } from '@/types/article';

interface ArticlePipelineProps {
  stage: ArticlePipelineStage;
  spec: ArticleStyleSpec | null;
  directions: WritingDirection[];
  review: ArticleReview | null;
  fixRounds: number;
  onConfirmStyle: () => void;
  onSelectDirection: (direction: WritingDirection) => void;
  onCancel: () => void;
  onAdjustStyle: () => void;
  onBackToStyle: () => void;
}

function getCurrentStep(stage: ArticlePipelineStage): number {
  switch (stage) {
    case 'analyzing':
    case 'styleConfirm':
      return 1;
    case 'directionSelect':
      return 2;
    case 'generating':
    case 'reviewing':
    case 'fixing':
    case 'complete':
      return 3;
    default:
      return 1;
  }
}

export default function ArticlePipeline({
  stage,
  spec,
  directions,
  fixRounds,
  onConfirmStyle,
  onSelectDirection,
  onCancel,
  onAdjustStyle,
  onBackToStyle,
}: ArticlePipelineProps) {
  const currentStep = getCurrentStep(stage);

  return (
    <div className="bg-white rounded-2xl border border-stone-200/80 shadow-sm overflow-hidden animate-fade-in-up">
      {/* Top bar: step indicator + cancel */}
      <div className="flex items-center justify-between px-6 pt-5 pb-3">
        <StepIndicator currentStep={currentStep} />
        <button
          onClick={onCancel}
          className="text-xs text-stone-400 hover:text-stone-600 transition-colors flex-shrink-0 ml-4"
        >
          取消
        </button>
      </div>

      {/* Body */}
      <div className="px-6 pb-6">
        {stage === 'analyzing' && <SkeletonAnalysis />}

        {stage === 'styleConfirm' && spec && (
          <StyleAnalysisPanel
            spec={spec}
            onConfirm={onConfirmStyle}
            onAdjust={onAdjustStyle}
            onSkip={onCancel}
          />
        )}

        {stage === 'directionSelect' && (
          <DirectionSelectPanel
            directions={directions}
            onSelect={onSelectDirection}
            onBack={onBackToStyle}
          />
        )}

        {(stage === 'generating' || stage === 'reviewing' || stage === 'fixing' || stage === 'complete') && (
          <ProgressPanel stage={stage} fixRounds={fixRounds} />
        )}
      </div>
    </div>
  );
}
