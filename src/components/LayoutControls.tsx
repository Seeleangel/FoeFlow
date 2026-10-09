/**
 * Layout Controls Component
 *
 * UI component for AI-powered layout generation.
 */
import { Button } from '@/components/ui/button';
import { Loader2 } from 'lucide-react';

interface LayoutControlsProps {
  onAnalyze: () => Promise<void>;
  onRequestRefine?: () => void;
  loading: boolean;
  error: string | null;
  strategy: unknown | null;
  hasOriginalContent: boolean;
  stage?: string | null;
  feedbackActive?: boolean;
}

export function LayoutControls({
  onAnalyze,
  onRequestRefine,
  loading,
  error,
  strategy,
  hasOriginalContent,
  stage,
  feedbackActive = false,
}: LayoutControlsProps) {
  const handleAnalyze = async () => {
    try {
      await onAnalyze();
    } catch (err) {
      // Error handled by parent
    }
  };

  const isGenerating = stage === 'generating' || stage === 'reviewing' || stage === 'fixing';

  if (isGenerating) return null;

  return (
    <div className="flex items-center gap-2">
      {!strategy ? (
        <Button
          onClick={handleAnalyze}
          disabled={loading || !hasOriginalContent}
          className="w-full sm:w-auto"
        >
          {loading && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
          {loading ? '分析中...' : '智能排版'}
        </Button>
      ) : (
        <Button
          onClick={onRequestRefine}
          disabled={loading || feedbackActive}
          className="w-full sm:w-auto"
          variant="default"
        >
          {loading && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
          {loading ? '处理中...' : '换个排版'}
        </Button>
      )}

      {error && (
        <p className="text-sm text-destructive">{error}</p>
      )}
    </div>
  );
}
