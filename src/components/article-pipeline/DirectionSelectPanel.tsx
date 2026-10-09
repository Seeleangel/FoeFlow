import { ChevronRight, Loader2 } from 'lucide-react';
import type { WritingDirection } from '@/types/article';

interface DirectionSelectPanelProps {
  directions: WritingDirection[];
  onSelect: (direction: WritingDirection) => void;
  onBack: () => void;
}

export default function DirectionSelectPanel({ directions, onSelect, onBack }: DirectionSelectPanelProps) {
  if (directions.length === 0) {
    return (
      <div className="text-center py-8">
        <Loader2 className="w-5 h-5 animate-spin mx-auto text-red-600" />
        <p className="text-xs text-stone-500 mt-2">正在推荐写作方向…</p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <p className="text-sm font-medium text-stone-700 mb-3">请选择写作方向：</p>
      {directions.map((dir, idx) => (
        <button
          key={dir.id}
          onClick={() => onSelect(dir)}
          className="w-full text-left bg-white rounded-xl border border-stone-200 p-5 hover:border-red-300 hover:bg-red-50/50 hover:shadow-md hover:-translate-y-0.5 transition-all duration-200 flex items-center gap-4"
        >
          <div className="w-7 h-7 rounded-full bg-red-600 text-white flex items-center justify-center text-xs font-semibold flex-shrink-0">
            {idx + 1}
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-semibold text-stone-800">{dir.name}</p>
            <p className="text-xs text-stone-500 mt-1 line-clamp-4">
              切入角度：{dir.angle} · 结构：{dir.structure}
            </p>
          </div>
          <ChevronRight className="w-4 h-4 text-stone-300 flex-shrink-0" />
        </button>
      ))}
      <button
        onClick={onBack}
        className="w-full text-stone-500 hover:text-stone-700 text-sm py-2 transition-colors text-center"
      >
        返回风格确认
      </button>
    </div>
  );
}
