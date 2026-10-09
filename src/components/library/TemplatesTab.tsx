import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Bot, Save, RotateCcw } from 'lucide-react';
import { type PromptTemplates } from '@/lib/promptStorage';

interface TemplatesTabProps {
  prompts: PromptTemplates;
  promptsLoading: boolean;
  promptsSaved: boolean;
  onPromptsChange: React.Dispatch<React.SetStateAction<PromptTemplates>>;
  onSave: () => Promise<void>;
  onReset: () => Promise<void>;
}

export default function TemplatesTab({
  prompts,
  promptsLoading,
  promptsSaved,
  onPromptsChange,
  onSave,
  onReset,
}: TemplatesTabProps) {
  const EASE_OUT_QUART = 'cubic-bezier(0.25, 1, 0.5, 1)';

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <p className="text-sm text-stone-500">自定义各步骤 AI 智能体的系统提示词</p>
        </div>
        <div className="flex gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={onReset}
            className="text-stone-600"
          >
            <RotateCcw className="w-4 h-4 mr-1.5" />
            重置默认
          </Button>
          <Button
            size="sm"
            onClick={onSave}
            disabled={promptsLoading}
            className="bg-red-600 hover:bg-red-700 text-white transition-all duration-200"
          >
            <Save className="w-4 h-4 mr-1.5" />
            <span
              className="inline-block"
              style={{
                transition: `transform 0.25s ${EASE_OUT_QUART}`,
                transform: promptsSaved ? 'scale(1.08)' : 'scale(1)',
              }}
            >
              {promptsLoading ? '保存中...' : promptsSaved ? '已保存 ✓' : '保存修改'}
            </span>
          </Button>
        </div>
      </div>

      {/* 对话共创 */}
      <div className="border border-stone-200 rounded-xl bg-white overflow-hidden">
        <div className="px-5 py-3 bg-stone-50 border-b border-stone-100 flex items-center gap-2">
          <Bot className="w-4 h-4 text-blue-600" />
          <h3 className="font-semibold text-stone-800 text-sm">对话共创智能体</h3>
          <span className="text-xs text-stone-400 ml-2">{`{templateName}`} {`{structureJson}`} {`{styleSection}`}</span>
        </div>
        <div className="p-4">
          <Textarea
            value={prompts.coCreationPrompt}
            onChange={(e) => onPromptsChange({ ...prompts, coCreationPrompt: e.target.value })}
            rows={8}
            className="resize-y text-sm font-mono leading-relaxed"
          />
        </div>
      </div>

      {/* 文章审核 */}
      <div className="border border-stone-200 rounded-xl bg-white overflow-hidden">
        <div className="px-5 py-3 bg-stone-50 border-b border-stone-100 flex items-center gap-2">
          <Bot className="w-4 h-4 text-red-600" />
          <h3 className="font-semibold text-stone-800 text-sm">文章审核智能体</h3>
          <span className="text-xs text-stone-400 ml-2">{`{year}`} {`{enabledRules}`} {`{text}`}</span>
        </div>
        <div className="p-4">
          <Textarea
            value={prompts.auditPrompt}
            onChange={(e) => onPromptsChange({ ...prompts, auditPrompt: e.target.value })}
            rows={8}
            className="resize-y text-sm font-mono leading-relaxed"
          />
        </div>
      </div>

      {/* 图片描述 */}
      <div className="border border-stone-200 rounded-xl bg-white overflow-hidden">
        <div className="px-5 py-3 bg-stone-50 border-b border-stone-100 flex items-center gap-2">
          <Bot className="w-4 h-4 text-amber-600" />
          <h3 className="font-semibold text-stone-800 text-sm">图片描述智能体</h3>
          <span className="text-xs text-stone-400 ml-2">{`{title}`} {`{bodyPreview}`}</span>
        </div>
        <div className="p-4">
          <Textarea
            value={prompts.imageGenerationPrompt}
            onChange={(e) => onPromptsChange({ ...prompts, imageGenerationPrompt: e.target.value })}
            rows={8}
            className="resize-y text-sm font-mono leading-relaxed"
          />
        </div>
      </div>
    </div>
  );
}
