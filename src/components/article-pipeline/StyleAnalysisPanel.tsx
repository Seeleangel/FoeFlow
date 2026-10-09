import { FileText, Megaphone, LayoutGrid, Type } from 'lucide-react';
import type { ArticleStyleSpec } from '@/types/article';

interface StyleAnalysisPanelProps {
  spec: ArticleStyleSpec;
  onConfirm: () => void;
  onAdjust: () => void;
  onSkip: () => void;
}

const FIELDS = [
  { key: 'articleType' as const, label: '类型', icon: FileText },
  { key: 'tone' as const, label: '语气', icon: Megaphone },
  { key: 'structure' as const, label: '结构', icon: LayoutGrid },
  { key: 'presentation' as const, label: '呈现', icon: Type },
];

export default function StyleAnalysisPanel({ spec, onConfirm, onAdjust, onSkip }: StyleAnalysisPanelProps) {
  return (
    <div className="space-y-5">
      <div className="bg-white rounded-2xl p-6 shadow-sm">
        <p className="text-xs uppercase tracking-widest text-stone-400 font-medium mb-4">
          文章风格分析
        </p>

        <div className="grid grid-cols-2 gap-4 mb-5">
          {FIELDS.map(({ key, label, icon: Icon }) => (
            <div key={key} className="flex items-start gap-2.5">
              <div className="w-8 h-8 rounded-lg bg-red-50 flex items-center justify-center flex-shrink-0">
                <Icon className="w-4 h-4 text-red-600" />
              </div>
              <div>
                <p className="text-xs text-stone-400">{label}</p>
                <p className="text-sm text-stone-800 font-medium mt-0.5">{spec[key]}</p>
              </div>
            </div>
          ))}
        </div>

        {spec.reasoning && (
          <div className="border-l-[3px] border-red-500 pl-3.5">
            <p className="text-sm text-stone-600 leading-relaxed">{spec.reasoning}</p>
          </div>
        )}
      </div>

      <button
        onClick={onConfirm}
        className="w-full bg-gradient-to-r from-red-600 to-red-700 hover:from-red-700 hover:to-red-800 text-white text-sm font-semibold py-3.5 rounded-xl shadow-lg shadow-red-200/40 hover:shadow-xl transition-all duration-200"
      >
        确认风格，查看写作方向
      </button>

      <button
        onClick={onAdjust}
        className="w-full text-stone-600 hover:text-stone-800 text-sm py-2.5 transition-colors"
      >
        调整要求
      </button>

      <button
        onClick={onSkip}
        className="w-full text-stone-400 hover:text-stone-600 text-sm py-2 transition-colors"
      >
        跳过优化，保留当前版本
      </button>
    </div>
  );
}
