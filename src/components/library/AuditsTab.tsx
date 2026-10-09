import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { History, ChevronDown, ChevronUp, Trash2, CheckCircle } from 'lucide-react';
import type { AuditRecord } from '@/types';
import { getSeverityColor, getSeverityLabel } from '@/lib/severity';

interface AuditsTabProps {
  audits: AuditRecord[];
  expandedId: string | null;
  onToggleExpand: (id: string | null) => void;
  onDelete: (id: string) => void;
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

const getInputTypeLabel = (type: string) => {
  const map: Record<string, string> = {
    text: '纯文本',
    'xiemi-link': '秀米链接',
    screenshot: '截图',
  };
  return map[type] || type;
};

export default function AuditsTab({
  audits,
  expandedId,
  onToggleExpand,
  onDelete,
}: AuditsTabProps) {
  const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null);

  return (
    <>
      {audits.length === 0 ? (
        <div className="text-center py-12 bg-stone-50 rounded-lg">
          <div className="w-16 h-16 rounded-full bg-stone-100 flex items-center justify-center mx-auto mb-4" style={{ animation: 'gentle-float 4s ease-in-out infinite' }}>
            <History className="w-8 h-8 text-stone-400" />
          </div>
          <p className="text-stone-600 font-medium">暂无审核记录</p>
          <p className="text-sm text-stone-400 mt-1">在智能审核台完成的审核会显示在这里</p>
        </div>
      ) : (
        <div className="space-y-2">
          {audits.map((audit) => {
            const isExpanded = expandedId === audit.id;
            const issueCount = audit.resultJson.issues.length;
            return (
              <div
                key={audit.id}
                className="border border-stone-200 rounded-lg bg-white overflow-hidden w-full"
              >
                <div
                  className="flex items-center justify-between gap-3 px-4 py-3 cursor-pointer hover:bg-stone-50 transition-colors"
                  onClick={() => onToggleExpand(isExpanded ? null : audit.id)}
                >
                  <div className="flex items-center gap-2 flex-1 min-w-0">
                    <History className="w-4 h-4 text-stone-400 flex-shrink-0" />
                    <span className="text-xs px-2 py-0.5 rounded bg-stone-100 text-stone-600 whitespace-nowrap flex-shrink-0">
                      {getInputTypeLabel(audit.inputType)}
                    </span>
                    <span className="text-sm text-stone-500 truncate">
                      {audit.inputContent.slice(0, 40)}
                      {audit.inputContent.length > 40 ? '...' : ''}
                    </span>
                  </div>
                  <div className="flex items-center gap-2 flex-shrink-0">
                    {issueCount > 0 ? (
                      <span className="text-xs px-2 py-0.5 rounded bg-red-50 text-red-600 font-medium">
                        {issueCount} 个问题
                      </span>
                    ) : (
                      <span className="text-xs px-2 py-0.5 rounded bg-green-50 text-green-600 font-medium">
                        通过
                      </span>
                    )}
                    <span className="text-xs text-stone-400">{formatDateTime(audit.createdAt)}</span>
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
                        setDeleteConfirmId(audit.id);
                      }}
                      className="text-red-600 hover:text-red-700 hover:bg-red-50 h-8 w-8 p-0 hover:scale-110 active:scale-90 transition-all duration-150"
                    >
                      <Trash2 className="w-4 h-4" />
                    </Button>
                  </div>
                </div>
                <div className={`grid transition-all duration-300 ${isExpanded ? 'grid-rows-[1fr]' : 'grid-rows-[0fr]'}`}>
                  <div className="overflow-hidden">
                    <div className="px-4 pb-4 border-t border-stone-100">
                      {issueCount === 0 ? (
                        <div className="py-4 flex items-center gap-2 text-green-600">
                          <CheckCircle className="w-5 h-5" />
                          <span className="text-sm font-medium">未发现明显问题</span>
                        </div>
                      ) : (
                        <div className="space-y-2 py-3">
                          {audit.resultJson.issues.map((issue, idx) => (
                            <div key={idx} className="flex items-start gap-2">
                              <span className={`text-xs px-1.5 py-0.5 rounded font-medium flex-shrink-0 mt-0.5 ${getSeverityColor(issue.severity)}`}>
                                {getSeverityLabel(issue.severity)}
                              </span>
                              <div className="space-y-1">
                                <p className="text-base text-stone-800">{issue.message}</p>
                                {issue.suggestion && (
                                  <p className="text-base text-stone-500">
                                    <span className="font-medium text-stone-600">建议：</span>
                                    {issue.suggestion}
                                  </p>
                                )}
                              </div>
                            </div>
                          ))}
                        </div>
                      )}
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
              确定要删除此审核记录吗？此操作不可恢复。
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
