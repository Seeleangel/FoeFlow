import { CheckCircle2, Loader2, Sparkles, Search, Wrench } from 'lucide-react';
import { useRotatingMessage } from '@/hooks/useRotatingMessage';

interface ProgressPanelProps {
  stage: 'generating' | 'reviewing' | 'fixing' | 'complete';
  fixRounds: number;
}

const GENERATING_MESSAGES = [
  '正在将零散素材编织成完整文章...',
  '调整段落结构，让逻辑层层递进...',
  '为读者规划最佳阅读节奏...',
  '打磨语言，让表达更接地气...',
  '组织信息层级，让重点一目了然...',
  '搭好文章的骨架，再填上血肉...',
  '在正式与亲切之间寻找最佳语气...',
];

const REVIEWING_MESSAGES = [
  '逐段检查信息是否完整准确...',
  '模拟读者视角，审视阅读流畅度...',
  '检查语气是否符合公众号调性...',
  '审视标题是否能吸引又不失格调...',
  '验证每个关键信息是否被遗漏...',
  '以"未来教育引领者"的标准衡量每一句...',
  '换位思考：读者看到这里会怎么想？',
];

const FIXING_MESSAGES = [
  '根据评审意见精修细节...',
  '精简冗余内容，让节奏更紧凑...',
  '调整措辞，让表达更加生动有力...',
  '替换平淡用词，增强语言感染力...',
  '优化段落长度，适配手机屏幕阅读...',
  '润色衔接过渡，让行云流水...',
  '打磨收尾段落，留下回味的空间...',
];

const STEPS = [
  { key: 'generating' as const, label: '生成文章', icon: Sparkles },
  { key: 'reviewing' as const, label: '质量评审', icon: Search },
  { key: 'fixing' as const, label: '自动优化', icon: Wrench },
];

function getActiveIndex(stage: ProgressPanelProps['stage']): number {
  switch (stage) {
    case 'generating': return 0;
    case 'reviewing': return 1;
    case 'fixing': return 2;
    case 'complete': return 3; // all done
  }
}

export default function ProgressPanel({ stage, fixRounds }: ProgressPanelProps) {
  const activeIdx = getActiveIndex(stage);
  const isComplete = stage === 'complete';

  const [generatingMsg, genIdx] = useRotatingMessage(GENERATING_MESSAGES, stage);
  const [reviewingMsg, revIdx] = useRotatingMessage(REVIEWING_MESSAGES, stage);
  const [fixingMsg, fixIdx] = useRotatingMessage(FIXING_MESSAGES, stage);

  return (
    <div className="animate-fade-in-up">
      {/* Header */}
      <div className="flex items-center gap-3 mb-5">
        <div className="w-8 h-8 rounded-lg bg-red-50 flex items-center justify-center">
          <Sparkles className="w-4 h-4 text-red-500" />
        </div>
        <div>
          <p className="text-sm font-semibold text-stone-800">
            {isComplete ? '文章生成完成' : '文章流水线运行中'}
          </p>
          <p className="text-[11px] text-stone-400 mt-0.5">
            {stage === 'generating' && '创作中'}
            {stage === 'reviewing' && '评审中'}
            {stage === 'fixing' && '优化中'}
            {isComplete && `共自动优化 ${fixRounds} 处问题，质量已达标`}
          </p>
        </div>
      </div>

      {/* Timeline steps */}
      <div className="space-y-0">
        {STEPS.map((step, idx) => {
          const done = isComplete || idx < activeIdx;
          const active = !isComplete && idx === activeIdx;
          const dimmed = !isComplete && idx > activeIdx;
          const isLast = idx === STEPS.length - 1;

          return (
            <div
              key={step.key}
              className={`flex items-stretch text-sm ${dimmed ? 'opacity-30' : ''} animate-fade-in-up`}
              style={{ animationDelay: `${idx * 80}ms`, animationFillMode: 'both' }}
            >
              {/* Timeline column */}
              <div className="flex flex-col items-center mr-3 relative" style={{ width: 24 }}>
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
                    <div className="w-2 h-2 rounded-full transition-colors duration-500" style={{ backgroundColor: '#d6d3d1' }} />
                  )}
                </div>
                {!isLast && (
                  <div
                    className="flex-1 w-px transition-colors duration-700"
                    style={{ backgroundColor: done ? '#d1d5db' : '#f5f5f4', minHeight: 20 }}
                  />
                )}
              </div>

              {/* Label */}
              <div className="py-0.5">
                <span className={`transition-all duration-500 ${done ? 'text-stone-500' : active ? 'text-stone-800 font-medium' : 'text-stone-400'}`}>
                  {step.label}
                </span>
                {active && (
                  <span className="inline-block ml-1.5 w-1 h-1 rounded-full bg-red-400 animate-pulse align-middle" />
                )}
              </div>
            </div>
          );
        })}
      </div>

      {/* Progress bar */}
      {!isComplete && (
        <div className="mt-5">
          <div className="h-1 bg-stone-100 rounded-full overflow-hidden">
            <div
              className="h-full bg-gradient-to-r from-red-400 to-red-500 rounded-full transition-all duration-700 ease-out"
              style={{ width: stage === 'generating' ? '33%' : stage === 'reviewing' ? '66%' : '85%' }}
            />
          </div>
        </div>
      )}
      {isComplete && (
        <div className="mt-5">
          <div className="h-1 bg-stone-100 rounded-full overflow-hidden">
            <div className="h-full bg-green-500 rounded-full w-full" />
          </div>
        </div>
      )}

      {/* Status text — rotates through interesting messages */}
      {!isComplete && (
        <p
          className="text-xs text-stone-400 mt-3 leading-relaxed animate-fade-in"
          key={`${stage}-${stage === 'generating' ? genIdx : stage === 'reviewing' ? revIdx : fixIdx}`}
        >
          {stage === 'generating' && generatingMsg}
          {stage === 'reviewing' && reviewingMsg}
          {stage === 'fixing' && `${fixingMsg}（已修复 ${fixRounds} 处）`}
        </p>
      )}
    </div>
  );
}
