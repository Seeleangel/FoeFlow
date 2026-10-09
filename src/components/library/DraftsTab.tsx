import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { PenTool, ChevronDown, ChevronUp, Trash2, Copy } from 'lucide-react';
import { showToast } from '@/components/ui/toaster';
import type { GeneratedDraft } from '@/types';

interface DraftsTabProps {
  drafts: GeneratedDraft[];
  expandedId: string | null;
  onToggleExpand: (id: string | null) => void;
  onDelete: (id: string) => void;
  onNavigate?: (page: string) => void;
}

const formatDateTime = (timestamp: number) => {
  return new Date(timestamp).toLocaleString('zh-CN', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
};

export default function DraftsTab({
  drafts,
  expandedId,
  onToggleExpand,
  onDelete,
}: DraftsTabProps) {
  const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null);

  return (
    <>
      {drafts.length === 0 ? (
        <div className="text-center py-12 bg-stone-50 rounded-lg">
          <div className="w-16 h-16 rounded-full bg-stone-100 flex items-center justify-center mx-auto mb-4" style={{ animation: 'gentle-float 4s ease-in-out infinite' }}>
            <PenTool className="w-8 h-8 text-stone-400" />
          </div>
          <p className="text-stone-600 font-medium">暂无草稿</p>
          <p className="text-sm text-stone-400 mt-1">在文章生成器页面保存的草稿会显示在这里</p>
        </div>
      ) : (
        <div className="space-y-2">
          {drafts.map((draft) => {
            const isExpanded = expandedId === draft.id;
            return (
              <div
                key={draft.id}
                className="border border-stone-200 rounded-lg bg-white overflow-hidden w-full"
              >
                <div
                  className="flex items-center justify-between gap-3 px-4 py-3 cursor-pointer hover:bg-stone-50 transition-colors"
                  onClick={() => onToggleExpand(isExpanded ? null : draft.id)}
                >
                  <div className="flex items-center gap-2 flex-1 min-w-0">
                    <PenTool className="w-4 h-4 text-stone-400 flex-shrink-0" />
                    <h3 className="font-semibold text-stone-900 text-base truncate">
                      {(draft.paramsJson?.title as string) || '未命名草稿'}
                    </h3>
                  </div>
                  <div className="flex items-center gap-2 flex-shrink-0">
                    <span className="text-xs text-stone-400">{formatDateTime(draft.createdAt)}</span>
                    {isExpanded ? (
                      <ChevronUp className="w-4 h-4 text-stone-400" />
                    ) : (
                      <ChevronDown className="w-4 h-4 text-stone-400" />
                    )}
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={(e) => {
                        e.stopPropagation();
                        setDeleteConfirmId(draft.id);
                      }}
                      className="text-red-600 hover:text-red-700 hover:bg-red-50 h-8 w-8 p-0 hover:scale-110 active:scale-90 transition-all duration-150"
                    >
                      <Trash2 className="w-4 h-4" />
                    </Button>
                  </div>
                </div>
                <div className={`grid transition-all duration-300 ${isExpanded ? 'grid-rows-[1fr]' : 'grid-rows-[0fr]'}`}>
                  <div className="overflow-hidden">
                    <div className="px-4 pb-4 border-t border-stone-100 space-y-3">
                      <div className="py-3">
                        <p className="text-xs font-medium text-stone-500 mb-1">正文</p>
                        <p className="text-base text-stone-600 leading-relaxed whitespace-pre-wrap">
                          {draft.contentText}
                        </p>
                      </div>
                      <div className="flex gap-2">
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() =>
                            navigator.clipboard
                              .writeText(draft.contentHtml)
                              .then(() => showToast('HTML 已复制到剪贴板', 'success'))
                          }
                        >
                          <Copy className="w-3.5 h-3.5 mr-1.5" />
                          复制 HTML
                        </Button>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      <Dialog open={deleteConfirmId !== null} onOpenChange={(open) => !open && setDeleteConfirmId(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>确认删除</DialogTitle>
            <DialogDescription>
              确定要删除此草稿吗？此操作不可恢复。
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteConfirmId(null)}>取消</Button>
            <Button
              className="bg-red-600 hover:bg-red-700 text-white"
              onClick={() => {
                if (deleteConfirmId) {
                  onDelete(deleteConfirmId);
                  setDeleteConfirmId(null);
                }
              }}
            >
              确认删除
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
