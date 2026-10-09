import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Plus, Book, FileText, ChevronDown, ChevronUp, Trash2 } from 'lucide-react';
import type { UserArticle } from '@/types';

interface ArticlesTabProps {
  newTitle: string;
  newContent: string;
  onTitleChange: (v: string) => void;
  onContentChange: (v: string) => void;
  onAdd: () => void;
  articles: UserArticle[];
  emptyMessage: string;
  emptyHint: string;
  expandedId: string | null;
  onToggleExpand: (id: string | null) => void;
  onDelete: (id: string) => void;
  canAdd: boolean;
}

const formatDate = (timestamp: number) => {
  return new Date(timestamp).toLocaleDateString('zh-CN', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });
};

export default function ArticlesTab({
  newTitle,
  newContent,
  onTitleChange,
  onContentChange,
  onAdd,
  articles,
  emptyMessage,
  emptyHint,
  expandedId,
  onToggleExpand,
  onDelete,
  canAdd,
}: ArticlesTabProps) {
  const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null);

  return (
    <>
      <div className="space-y-4 mb-8">
        <div>
          <label className="text-sm font-medium text-stone-700 mb-2 block">文章标题</label>
          <Input
            placeholder="请输入文章标题"
            value={newTitle}
            onChange={(e) => onTitleChange(e.target.value)}
          />
        </div>
        <div>
          <label className="text-sm font-medium text-stone-700 mb-2 block">文章内容</label>
          <Textarea
            placeholder="粘贴文章内容..."
            value={newContent}
            onChange={(e) => onContentChange(e.target.value)}
            rows={5}
            className="resize-none"
          />
        </div>
        <Button
          onClick={onAdd}
          disabled={canAdd}
          className="bg-red-600 hover:bg-red-700 text-white px-8"
        >
          <Plus className="w-4 h-4 mr-2" />
          添加文章
        </Button>
      </div>

      {/* 文章列表 */}
      {articles.length === 0 ? (
        <div className="text-center py-12 bg-stone-50 rounded-lg">
          <div className="w-16 h-16 rounded-full bg-stone-100 flex items-center justify-center mx-auto mb-4" style={{ animation: 'gentle-float 4s ease-in-out infinite' }}>
            <Book className="w-8 h-8 text-stone-400" />
          </div>
          <p className="text-stone-600 font-medium">{emptyMessage}</p>
          <p className="text-sm text-stone-400 mt-1">{emptyHint}</p>
        </div>
      ) : (
        <div className="space-y-2">
          {articles.map((article) => {
            const isExpanded = expandedId === article.id;
            return (
              <div
                key={article.id}
                className="border border-stone-200 rounded-lg bg-white overflow-hidden w-full"
              >
                {/* 标题行 */}
                <div
                  className="flex items-center justify-between gap-3 px-4 py-3 cursor-pointer hover:bg-stone-50 transition-colors"
                  onClick={() => onToggleExpand(isExpanded ? null : article.id)}
                >
                  <div className="flex items-center gap-2 flex-1 min-w-0">
                    <FileText className="w-4 h-4 text-stone-400 flex-shrink-0" />
                    <h3 className="font-semibold text-stone-900 text-base truncate">{article.title}</h3>
                  </div>
                  <div className="flex items-center gap-2 flex-shrink-0">
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
                        setDeleteConfirmId(article.id);
                      }}
                      className="text-red-600 hover:text-red-700 hover:bg-red-50 h-8 w-8 p-0 hover:scale-110 active:scale-90 transition-all duration-150"
                    >
                      <Trash2 className="w-4 h-4" />
                    </Button>
                  </div>
                </div>

                {/* 展开内容 */}
                <div
                  className={`grid transition-all duration-300 ${isExpanded ? 'grid-rows-[1fr]' : 'grid-rows-[0fr]'}`}
                >
                  <div className="overflow-hidden">
                    <div className="px-4 pb-4 border-t border-stone-100">
                      <p className="text-base text-stone-600 leading-relaxed whitespace-pre-wrap py-3">
                        {article.content}
                      </p>
                      <p className="text-xs text-stone-400">
                        添加于 {formatDate(article.createdAt)}
                      </p>
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
              确定要删除这篇文章吗？此操作不可恢复。
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
