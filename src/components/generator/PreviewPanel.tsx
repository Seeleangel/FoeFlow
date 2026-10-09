import { FileText, Copy, Download, Loader2, CheckCircle2, Sparkles, Search } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { LayoutControls } from '@/components/LayoutControls';
import ArticlePipeline from '@/components/article-pipeline/ArticlePipeline';
import { useRotatingMessage } from '@/hooks/useRotatingMessage';
import type { LayoutStrategy, StyleSpec, LayoutDirection } from '@/types/layout';
import type { WritingDirection } from '@/types/article';
import type { ArticlePipelineStage, ArticleStyleSpec, ArticleReview } from '@/types/article';

const LAYOUT_ANALYZING_MESSAGES = [
  '品味文章的独特气质...',
  '捕捉字里行间的情感基调...',
  '权衡配色的情绪表达能力...',
  '为你的文章量身定制视觉风格...',
  '在专业与温度之间寻找平衡点...',
  '思考什么样的视觉节奏最契合内容...',
  '解读文章基因，匹配视觉表达...',
];

const LAYOUT_GENERATING_MESSAGES = [
  '用排版语言诠释文章内涵...',
  '构建层次分明的视觉叙事...',
  '在卡片间营造恰到好处的呼吸感...',
  '让每一处留白都有它的意义...',
  '为内容穿上得体又出彩的外衣...',
  '把阅读变成一场愉悦的视觉旅程...',
  '打造让人眼前一亮的微信排版...',
];


interface PreviewPanelProps {
  // Article pipeline
  articleStage: ArticlePipelineStage | null;
  articleSpec: ArticleStyleSpec | null;
  articleDirections: WritingDirection[];
  articleReview: ArticleReview | null;
  articleFixRounds: number;
  onArticleSpecConfirm?: () => void;
  onArticleDirectionSelect: (direction: WritingDirection) => void;
  onArticleCancel: () => void;
  onArticleAdjustStyle: () => void;
  onArticleBackToStyle: () => void;

  // Layout pipeline
  layoutStage: string | null;
  styleSpec: StyleSpec | null;
  layoutDirections: LayoutDirection[];
  selectedDirection: LayoutDirection | null;
  specLoading: boolean;
  layoutError: string | null;
  layoutStrategy: LayoutStrategy | null;
  layoutLoading?: boolean;
  layoutHtml: string;
  layoutFeedbackState?: string;
  onLayoutRefineRequest?: () => void;
  onLayoutTagAction?: (tag: string) => void;
  pipelineSnapshot?: { html: string; stage: string } | null;
  onLayoutAnalyze: () => Promise<void>;
  onLayoutDirectionSelect: (direction: LayoutDirection) => void;
  onLayoutGenerate?: (strategy: LayoutStrategy) => Promise<void>;
  onStyleSpecChange: React.Dispatch<React.SetStateAction<StyleSpec | null>>;

  // Content
  generatedHtml: string;
  generatedText: string;
  generatedTitle: string;

  // Template
  selectedTemplateName: string;
  selectedTemplateId: string;

  // Actions
  onCopyHtml: () => void;
  onSaveDraft: () => void;
  onExportWord: () => void;
}

export default function PreviewPanel({
  articleStage, articleSpec, articleDirections, articleReview, articleFixRounds,
  onArticleSpecConfirm, onArticleDirectionSelect, onArticleCancel, onArticleAdjustStyle, onArticleBackToStyle,
  layoutStage, styleSpec, layoutDirections, selectedDirection, specLoading, layoutError,
  layoutStrategy, layoutLoading = false, layoutHtml,
  layoutFeedbackState, onLayoutRefineRequest,
  onLayoutAnalyze, onLayoutDirectionSelect, onStyleSpecChange,
  generatedHtml, generatedText,
  onCopyHtml, onSaveDraft, onExportWord,
}: PreviewPanelProps) {
  const [analyzingMsg, analyzeIdx] = useRotatingMessage(LAYOUT_ANALYZING_MESSAGES, layoutStage ?? 'idle');
  const [generatingMsg, genIdx] = useRotatingMessage(LAYOUT_GENERATING_MESSAGES, layoutStage ?? 'idle');

  return (
    <div className="h-full overflow-y-auto">
      {/* Article Pipeline UI */}
      {articleStage && (
        <ArticlePipeline
          stage={articleStage}
          spec={articleSpec}
          directions={articleDirections}
          review={articleReview}
          fixRounds={articleFixRounds}
          onConfirmStyle={onArticleSpecConfirm ?? (() => {})}
          onSelectDirection={onArticleDirectionSelect}
          onCancel={onArticleCancel}
          onAdjustStyle={onArticleAdjustStyle}
          onBackToStyle={onArticleBackToStyle}
        />
      )}

      {/* Normal Preview (only when article pipeline is NOT active) */}
      {!articleStage && generatedHtml && (
        <div className="border border-stone-200 rounded-2xl bg-white shadow-lg shadow-stone-100/50 overflow-hidden">
          <div className="px-7 py-5 border-b border-stone-100 flex items-center justify-between bg-gradient-to-r from-stone-50/50 to-white">
            <div className="flex items-center gap-2.5 font-semibold text-stone-900">
              <FileText className="w-5 h-5 text-green-600 animate-pulse-slow" />
              <span className="text-lg">生成结果</span>
            </div>
            <div className="flex items-center gap-3">
              <LayoutControls
                onAnalyze={onLayoutAnalyze}
                onRequestRefine={onLayoutRefineRequest}
                loading={layoutLoading || specLoading || layoutFeedbackState === 'processing'}
                error={layoutError}
                strategy={layoutStrategy}
                hasOriginalContent={!!generatedText}
                stage={layoutStage}
                feedbackActive={layoutFeedbackState !== 'idle'}
              />
            </div>
          </div>
          <div className="p-7 space-y-6">
            <div>
              {/* Phase 1: Style Spec Review + Direction Selection */}
              {styleSpec && !selectedDirection && (
                <div className="space-y-4">
                  {/* Spec Card */}
                  <div className="bg-white rounded-xl border border-stone-200 p-5">
                    <div className="flex items-center justify-between mb-4">
                      <h3 className="text-sm font-semibold text-stone-800">风格分析</h3>
                      <span className="text-[10px] text-stone-400 uppercase tracking-wider">SPEC</span>
                    </div>

                    {/* Basic Info */}
                    <dl className="space-y-2.5 text-sm">
                      <div className="flex items-baseline gap-3">
                        <dt className="text-stone-400 w-14 shrink-0">类型</dt>
                        <dd className="text-stone-700">{styleSpec.articleType}</dd>
                      </div>
                      <div className="flex items-baseline gap-3">
                        <dt className="text-stone-400 w-14 shrink-0">情感</dt>
                        <dd className="text-stone-700">{styleSpec.emotionTone}</dd>
                      </div>
                    </dl>

                    {/* Colors */}
                    <div className="flex items-center gap-5 mt-3.5 pt-3.5 border-t border-stone-100 text-sm">
                      <label className="flex items-center gap-2 cursor-pointer group">
                        <span className="text-stone-400">主色</span>
                        <input
                          type="color"
                          value={styleSpec.primaryColor}
                          onChange={(e) => onStyleSpecChange((prev) => prev ? { ...prev, primaryColor: e.target.value } : null)}
                          className="sr-only"
                        />
                        <span
                          className="w-5 h-5 rounded-md border border-stone-200 shadow-sm transition-transform group-hover:scale-110"
                          style={{ backgroundColor: styleSpec.primaryColor }}
                        />
                        <span className="font-mono text-[11px] text-stone-500">{styleSpec.primaryColor}</span>
                      </label>
                      <label className="flex items-center gap-2 cursor-pointer group">
                        <span className="text-stone-400">辅色</span>
                        <input
                          type="color"
                          value={styleSpec.secondaryColor}
                          onChange={(e) => onStyleSpecChange((prev) => prev ? { ...prev, secondaryColor: e.target.value } : null)}
                          className="sr-only"
                        />
                        <span
                          className="w-5 h-5 rounded-md border border-stone-200 shadow-sm transition-transform group-hover:scale-110"
                          style={{ backgroundColor: styleSpec.secondaryColor }}
                        />
                        <span className="font-mono text-[11px] text-stone-500">{styleSpec.secondaryColor}</span>
                      </label>
                    </div>

                    {/* Density */}
                    <div className="mt-3.5">
                      <p className="text-xs text-stone-400 mb-2">装饰密度</p>
                      <div className="flex bg-stone-100 rounded-lg p-0.5 gap-0.5">
                        {(['sparse', 'normal', 'rich'] as const).map((d) => (
                          <button
                            key={d}
                            onClick={() =>
                              onStyleSpecChange((prev) => (prev ? { ...prev, density: d } : null))
                            }
                            className={`flex-1 text-xs py-1.5 rounded-md transition-all ${
                              styleSpec.density === d
                                ? 'bg-white text-stone-800 shadow-sm font-medium'
                                : 'text-stone-500 hover:text-stone-700'
                            }`}
                          >
                            {d === 'sparse' ? '简约' : d === 'normal' ? '适中' : '丰富'}
                          </button>
                        ))}
                      </div>
                    </div>

                    {/* Reasoning */}
                    {styleSpec.reasoning && (
                      <p className="text-xs text-stone-500 mt-3.5 leading-relaxed line-clamp-3">
                        {styleSpec.reasoning}
                      </p>
                    )}
                  </div>

                  {/* Direction Selection */}
                  {(layoutStage === 'analyzing' && specLoading) && (
                    <div className="text-center py-6">
                      <Loader2 className="w-5 h-5 animate-spin mx-auto text-red-600" />
                      <p className="text-xs text-stone-500 mt-2">正在分析文章风格并匹配排版方向...</p>
                    </div>
                  )}
                  {!specLoading && layoutDirections.length > 0 && (
                    <div className="space-y-3">
                      <p className="text-sm font-medium text-stone-700">请选择排版方向：</p>
                      {layoutDirections.map((dir, idx) => {
                        const cleanName = dir.name.split('（参考：')[0].split('（')[0];
                        return (
                          <button
                            key={dir.id}
                            onClick={() => onLayoutDirectionSelect(dir)}
                            className="group w-full text-left bg-white rounded-xl border border-stone-200 p-4 hover:border-red-300 hover:shadow-md transition-all"
                          >
                            <div className="flex items-start gap-3">
                              <span className="w-6 h-6 rounded-full bg-stone-100 group-hover:bg-red-100 text-stone-600 group-hover:text-red-700 flex items-center justify-center text-xs font-semibold transition-colors shrink-0 mt-0.5">
                                {idx + 1}
                              </span>
                              <div className="flex-1 min-w-0">
                                <p className="text-sm font-semibold text-stone-800 line-clamp-1">
                                  {dir.description || cleanName}
                                </p>
                                {dir.features && dir.features.length > 0 && (
                                  <div className="flex flex-wrap gap-1.5 mt-2.5">
                                    {dir.features.slice(0, 3).map((f, i) => (
                                      <span
                                        key={i}
                                        className="text-[11px] text-stone-500 bg-stone-50 px-2 py-0.5 rounded-md border border-stone-200/80"
                                      >
                                        {f}
                                      </span>
                                    ))}
                                  </div>
                                )}
                              </div>
                            </div>
                          </button>
                        );
                      })}
                    </div>
                  )}
                </div>
              )}

              {/* Pipeline Progress */}
              {(layoutStage === 'analyzing' || layoutStage === 'generating') && (
                <div className="animate-fade-in-up">
                  <div className="bg-white rounded-2xl border border-stone-200/80 shadow-sm p-6">
                    {/* Header */}
                    <div className="flex items-center gap-3 mb-5">
                      <div className="w-8 h-8 rounded-lg bg-red-50 flex items-center justify-center">
                        <Sparkles className="w-4 h-4 text-red-500" />
                      </div>
                      <div>
                        <p className="text-sm font-semibold text-stone-800">智能排版中</p>
                        <p className="text-[11px] text-stone-400 mt-0.5">
                          {layoutStage === 'analyzing' && '分析文章风格'}
                          {layoutStage === 'generating' && '生成排版效果'}
                        </p>
                      </div>
                    </div>

                    {/* Steps */}
                    <div className="space-y-0">
                      <StepRow
                        index={0}
                        icon={Search}
                        label="分析文章风格"
                        done={layoutStage !== 'analyzing'}
                        active={layoutStage === 'analyzing'}
                      />
                      <StepRow
                        index={1}
                        icon={Sparkles}
                        label="生成排版效果"
                        done={false}
                        active={layoutStage === 'generating'}
                        isLast={true}
                      />
                    </div>

                    {/* Progress bar */}
                    <div className="mt-5">
                      <div className="h-1 bg-stone-100 rounded-full overflow-hidden">
                        <div
                          className="h-full bg-gradient-to-r from-red-400 to-red-500 rounded-full transition-all duration-700 ease-out"
                          style={{
                            width: layoutStage === 'analyzing' ? '0%' : '50%',
                          }}
                        />
                      </div>
                    </div>

                    {/* Status text — rotates through interesting messages */}
                    <p
                      className="text-xs text-stone-400 mt-3 leading-relaxed animate-fade-in"
                      key={`${layoutStage}-${layoutStage === 'analyzing' ? analyzeIdx : genIdx}`}
                    >
                      {layoutStage === 'analyzing' && analyzingMsg}
                      {layoutStage === 'generating' && generatingMsg}
                    </p>
                  </div>
                </div>
              )}

              {/* Feedback processing banner */}
              {layoutFeedbackState === 'processing' && layoutHtml && (
                <div className="mb-3 animate-fade-in">
                  <div className="flex items-center gap-2.5 px-4 py-2.5 bg-amber-50/80 border border-amber-200/60 rounded-xl">
                    <Loader2 className="w-4 h-4 text-amber-500 animate-spin flex-shrink-0" />
                    <span className="text-xs font-medium text-amber-700">正在根据反馈调整排版，请稍候...</span>
                  </div>
                </div>
              )}

              {/* Normal Layout Preview */}
              {layoutHtml && (
                <div
                  className="border border-stone-200 rounded-xl overflow-hidden transition-all duration-300 hover:shadow-lg animate-fade-in"
                  key={layoutHtml.substring(0, 40)}
                  dangerouslySetInnerHTML={{ __html: layoutHtml }}
                />
              )}
              {!layoutHtml && !styleSpec && !layoutStage && (
                <div className="space-y-3">
                  <div className="flex items-center gap-2 px-1">
                    <span className="text-xs font-medium text-amber-600 bg-amber-50 px-2 py-0.5 rounded-full">
                      待排版文章
                    </span>
                    <span className="text-xs text-stone-400">点击「智能排版」生成排版效果</span>
                  </div>
                  <div
                    className="border border-stone-200 rounded-xl overflow-hidden transition-all duration-300 hover:shadow-lg"
                    dangerouslySetInnerHTML={{ __html: generatedHtml }}
                  />
                </div>
              )}
            </div>

            {/* Action buttons — only shown after layout is complete */}
            {layoutHtml && (
              <div className="flex flex-wrap gap-3 pt-4 border-t border-stone-100">
                <Button
                  variant="outline"
                  onClick={onCopyHtml}
                  className="flex-1 h-11 rounded-xl hover-lift press-scale transition-all duration-200 group"
                >
                  <Copy className="w-4 h-4 mr-2 transition-transform duration-200 group-hover:scale-110" />
                  复制 HTML
                </Button>
                <Button
                  variant="outline"
                  onClick={onSaveDraft}
                  className="flex-1 h-11 rounded-xl hover-lift press-scale transition-all duration-200 group"
                >
                  <FileText className="w-4 h-4 mr-2 transition-transform duration-200 group-hover:scale-110" />
                  保存草稿
                </Button>
                <Button
                  variant="outline"
                  onClick={onExportWord}
                  className="flex-1 h-11 rounded-xl hover-lift press-scale transition-all duration-200 group"
                >
                  <Download className="w-4 h-4 mr-2 transition-transform duration-200 group-hover:scale-110" />
                  导出 Word
                </Button>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Empty state */}
      {!articleStage && !generatedHtml && (
        <div className="bg-gradient-to-b from-stone-50/90 to-white rounded-2xl border border-stone-100 p-12 text-center transition-all duration-300">
          <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-green-100 to-green-50 flex items-center justify-center mx-auto mb-4 shadow-sm">
            <FileText className="w-8 h-8 text-green-600" />
          </div>
          <p className="text-stone-700 font-medium">暂无生成内容</p>
          <p className="text-sm text-stone-400 mt-1.5">在左侧与 AI 对话生成推文后，预览将显示在这里</p>
        </div>
      )}
    </div>
  );
}

function StepRow({
  icon: _Icon,
  label,
  done,
  active,
  dimmed,
  index = 0,
  isLast = false,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  done: boolean;
  active: boolean;
  dimmed?: boolean;
  index?: number;
  isLast?: boolean;
}) {
  return (
    <div
      className={`flex items-stretch text-sm ${dimmed ? 'opacity-30' : ''} animate-fade-in-up`}
      style={{ animationDelay: `${index * 80}ms`, animationFillMode: 'both' }}
    >
      {/* Timeline column */}
      <div className="flex flex-col items-center mr-3 relative" style={{ width: 24 }}>
        {/* Dot / Icon */}
        <div className="relative z-10 flex items-center justify-center" style={{ width: 24, height: 24 }}>
          {done ? (
            <div className="animate-scale-in">
              <CheckCircle2 className="w-5 h-5 text-green-500" />
            </div>
          ) : active ? (
            <div className="relative">
              <div className="absolute inset-0 rounded-full bg-red-100 animate-ping opacity-30" />
              <Loader2 className="w-5 h-5 animate-spin text-red-500 relative z-10" />
            </div>
          ) : (
            <div
              className="w-2 h-2 rounded-full transition-colors duration-500"
              style={{ backgroundColor: '#d6d3d1' }}
            />
          )}
        </div>
        {/* Connecting line */}
        {!isLast && (
          <div
            className="flex-1 w-px transition-colors duration-700"
            style={{
              backgroundColor: done ? '#d1d5db' : '#f5f5f4',
              minHeight: 20,
            }}
          />
        )}
      </div>

      {/* Label */}
      <div className="py-0.5">
        <span
          className={`transition-all duration-500 ${
            done
              ? 'text-stone-500'
              : active
                ? 'text-stone-800 font-medium'
                : 'text-stone-400'
          }`}
        >
          {label}
        </span>
        {active && (
          <span className="inline-block ml-1.5 w-1 h-1 rounded-full bg-red-400 animate-pulse align-middle" />
        )}
      </div>
    </div>
  );
}
