import { useEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Sparkles, User, Send, History, Plus, FileText, X } from 'lucide-react';
import TypewriterText from '@/components/TypewriterText';
import { getDateBasedSuggestions, getCachedSuggestions, prefetchSuggestions } from '@/lib/dateSuggestions';

interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
  timestamp: Date;
  isHistorical?: boolean;
}

interface ChatPanelProps {
  messages: ChatMessage[];
  inputValue: string;
  loading: boolean;
  pipelineLoading: boolean;
  showHistory: boolean;
  sessions: Array<{ id: string; title: string; updatedAt: number }>;
  currentSessionId: string;
  chatScrollRef: React.RefObject<HTMLDivElement | null>;
  chatError: string | null;
  onInputChange: (value: string) => void;
  onSend: () => void;
  onNewSession: () => void;
  onLoadSession: (id: string) => void;
  onDeleteSession: (id: string, e: React.MouseEvent) => void;
  onToggleHistory: () => void;
  onGeneratePreview: (content: string) => void;
  onRetry: () => void;
  onLayoutTagClick?: (tag: string) => void;
}

function formatTime(date: Date) {
  return date.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' });
}

const LAYOUT_TAGS_MARKER = '__LAYOUT_TAGS__:';

const parseLayoutTags = (content: string): { text: string; tags: string[] } | null => {
  const idx = content.indexOf(LAYOUT_TAGS_MARKER);
  if (idx === -1) return null;
  const text = content.substring(0, idx).trim();
  const tagsStr = content.substring(idx + LAYOUT_TAGS_MARKER.length).trim();
  const tags = tagsStr.split(',').map((t) => t.trim()).filter(Boolean);
  return { text, tags };
};

const TAG_LABEL_MAP: Record<string, string> = {
  '颜色': '颜色方面不满意，',
  '间距': '间距方面不满意，',
  '结构': '排版结构方面不满意，',
  '装饰': '装饰元素方面不满意，',
  '字体': '字体方面不满意，',
  '全都不满意': '全都不满意',
};

export default function ChatPanel({
  messages, inputValue, loading, pipelineLoading,
  showHistory, sessions, currentSessionId, chatScrollRef,
  chatError, onInputChange, onSend, onNewSession, onLoadSession,
  onDeleteSession, onToggleHistory, onGeneratePreview, onRetry,
  onLayoutTagClick,
}: ChatPanelProps) {
  const historyRef = useRef<HTMLDivElement>(null);

  const [suggestions, setSuggestions] = useState<string[]>(
    () => getCachedSuggestions() ?? getDateBasedSuggestions()
  );

  useEffect(() => {
    let cancelled = false;
    prefetchSuggestions().then((result) => {
      if (!cancelled) setSuggestions(result);
    });
    return () => { cancelled = true; };
  }, []);

  // 点击外部关闭历史面板
  useEffect(() => {
    if (!showHistory) return;
    const handleClickOutside = (e: MouseEvent) => {
      if (historyRef.current && !historyRef.current.contains(e.target as Node)) {
        onToggleHistory();
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [showHistory, onToggleHistory]);

  const scrollToBottom = () => {
    if (chatScrollRef.current) {
      chatScrollRef.current.scrollTop = chatScrollRef.current.scrollHeight;
    }
  };

  const handleTagClick = (tag: string) => {
    if (tag === '全都不满意') {
      onLayoutTagClick?.(tag);
    } else {
      const label = TAG_LABEL_MAP[tag] || `${tag}方面不满意，`;
      onInputChange(label);
    }
  };

  return (
    <div className="bg-gradient-to-b from-stone-50/90 to-white rounded-2xl border border-stone-100 shadow-sm transition-all duration-300 hover:shadow-md flex flex-col h-full">
      {/* Header */}
      <div ref={historyRef} className="px-5 py-3.5 border-b border-stone-100 bg-white/80 backdrop-blur-sm flex items-center justify-between flex-shrink-0 relative z-20">
        <div className="flex items-center gap-2.5">
          <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-red-100 to-red-50 flex items-center justify-center">
            <Sparkles className="w-4 h-4 text-red-600" />
          </div>
          <p className="text-sm font-semibold text-stone-700">AI 创作助手</p>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={onToggleHistory}
            className={`flex items-center gap-1.5 text-xs font-medium px-2.5 py-1.5 rounded-lg border transition-all duration-200 ${
              showHistory ? 'bg-red-50 border-red-200 text-red-700' : 'border-stone-200 text-stone-600 hover:border-stone-300 hover:bg-stone-50'
            }`}>
            <History className="w-3.5 h-3.5" /> 历史
          </button>
          <button onClick={onNewSession}
            className="flex items-center gap-1.5 text-xs font-medium px-2.5 py-1.5 rounded-lg border border-red-200 text-red-600 hover:bg-red-50 transition-all duration-200">
            <Plus className="w-3.5 h-3.5" /> 新建
          </button>
        </div>
        {showHistory && (
          <div className="absolute top-full left-0 right-0 z-30 animate-fade-in-down">
            <div className="mx-3 mt-1 mb-2 bg-white rounded-xl border border-stone-200 shadow-xl shadow-stone-200/50 overflow-hidden">
              <div className="p-2 space-y-1 max-h-56 overflow-y-auto">
                {sessions.length === 0 && (
                  <div className="text-center text-stone-400 text-sm py-4"><p>还没有历史会话</p></div>
                )}
                {sessions.map((s) => {
                  const isActive = s.id === currentSessionId;
                  return (
                    <div key={s.id} onClick={() => onLoadSession(s.id)}
                      className={`cursor-pointer rounded-lg px-3 py-2 border transition-all duration-200 flex items-center justify-between group ${
                        isActive ? 'bg-red-50 border-red-200' : 'bg-white border-stone-100 hover:border-stone-300 hover:shadow-sm'
                      }`}>
                      <div className="min-w-0 flex-1">
                        <p className={`text-sm font-medium truncate ${isActive ? 'text-red-700' : 'text-stone-700'}`}>{s.title}</p>
                        <p className="text-xs text-stone-400 mt-0.5">{new Date(s.updatedAt).toLocaleString('zh-CN', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}</p>
                      </div>
                      {!isActive && (
                        <button onClick={(e) => onDeleteSession(s.id, e)}
                          className="text-stone-300 hover:text-red-500 transition-colors ml-2 p-1 rounded hover:bg-red-50">
                          <X className="w-3.5 h-3.5" />
                        </button>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Messages */}
      <div ref={chatScrollRef} className="p-5 space-y-4 overflow-y-auto bg-white/50 flex-1">
        {messages.length === 0 ? (
          <div className="text-center py-16">
            <div className="w-20 h-20 rounded-2xl bg-gradient-to-br from-brand-100 to-brand-50 flex items-center justify-center mx-auto mb-6 shadow-md animate-pulse-slow">
              <Sparkles className="w-10 h-10 text-brand-600 animate-sparkle" />
            </div>
            <p className="text-lg font-semibold text-stone-700">开始对话共创</p>
            <p className="text-sm text-stone-500 mt-2 mb-8 max-w-md mx-auto">描述你的需求，我会根据模板结构一步步帮你完善推文内容</p>
            <div className="flex flex-col gap-2.5 max-w-lg mx-auto">
              {suggestions.map((suggestion, idx) => (
                <button key={suggestion} onClick={() => onInputChange(suggestion)}
                  className="text-left px-4 py-3 bg-white border border-stone-200 rounded-xl text-sm text-stone-600 hover:border-brand-300 hover:text-brand-700 hover:bg-brand-50 transition-all duration-200 shadow-sm hover:shadow-md group"
                  style={{ transitionDelay: `${idx * 80}ms` }}>
                  <span className="flex items-start gap-2.5">
                    <Sparkles className="w-3.5 h-3.5 text-stone-400 group-hover:text-brand-500 transition-colors mt-0.5 shrink-0" />
                    <span className="leading-relaxed">{suggestion}</span>
                  </span>
                </button>
              ))}
            </div>
          </div>
        ) : (
          <>
            {messages.map((m) => (
              <div key={m.timestamp.toISOString()} className={`flex gap-3 ${m.role === 'user' ? 'flex-row-reverse' : 'flex-row'}`}>
                <div className={`w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0 shadow-sm transition-all duration-300 hover:scale-105 ${
                  m.role === 'user' ? 'bg-gradient-to-br from-red-100 to-red-50' : 'bg-gradient-to-br from-brand-100 to-brand-50'
                }`}>
                  {m.role === 'user' ? <User className="w-4.5 h-4.5 text-red-600" /> : <Sparkles className="w-4.5 h-4.5 text-brand-600" />}
                </div>
                <div className={`max-w-[75%] flex flex-col ${m.role === 'user' ? 'items-end' : 'items-start'}`} style={{ minHeight: 'fit-content' }}>
                  <div className={`flex items-center gap-2 mb-1.5 text-xs ${m.role === 'user' ? 'flex-row-reverse' : 'flex-row'}`}>
                    <span className="font-medium text-stone-600">{m.role === 'user' ? '我' : 'AI 助手'}</span>
                    <span className="text-stone-400">{formatTime(m.timestamp)}</span>
                  </div>
                  <div className={`px-4 py-3 rounded-2xl text-sm leading-normal whitespace-pre-wrap break-words ${
                    m.role === 'user' ? 'bg-gradient-to-br from-red-500 to-red-600 text-white rounded-br-md shadow-md shadow-red-100/50'
                    : 'bg-white border border-stone-200 text-stone-800 rounded-bl-md shadow-sm'
                  }`}>
                    {(() => {
                      const tagData = m.role === 'assistant' ? parseLayoutTags(m.content) : null;
                      if (tagData) {
                        return (
                          <>
                            {!m.isHistorical ? <TypewriterText text={tagData.text} onUpdate={scrollToBottom} /> : tagData.text}
                            <div className="flex flex-wrap gap-1.5 mt-2.5">
                              {tagData.tags.map((tag) => (
                                <button
                                  key={tag}
                                  onClick={() => handleTagClick(tag)}
                                  className="text-[11px] px-2.5 py-1 rounded-md border border-stone-200 bg-stone-50 text-stone-600 hover:bg-stone-100 hover:border-stone-300 hover:text-stone-800 transition-all duration-200 cursor-pointer"
                                >
                                  {tag}
                                </button>
                              ))}
                            </div>
                          </>
                        );
                      }
                      return m.role === 'assistant' && !m.isHistorical ? <TypewriterText text={m.content} onUpdate={scrollToBottom} /> : m.content;
                    })()}
                  </div>
                  {m.role === 'assistant' && m.content.length > 50 && !m.content.includes(LAYOUT_TAGS_MARKER) && (
                    <div className="flex gap-2 mt-2">
                      <button onClick={() => onGeneratePreview(m.content)}
                        className="text-xs text-brand-600 hover:text-brand-700 transition-all duration-200 font-medium hover:underline flex items-center gap-1 group">
                        <FileText className="w-3 h-3 transition-transform group-hover:scale-110" /> 生成预览
                      </button>
                    </div>
                  )}
                </div>
              </div>
            ))}
            {loading && (
              <div className="flex gap-3 flex-row animate-fade-in-up">
                <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-brand-100 to-brand-50 flex items-center justify-center flex-shrink-0 shadow-sm">
                  <Sparkles className="w-4.5 h-4.5 text-brand-600 animate-pulse" />
                </div>
                <div className="max-w-[75%] flex flex-col items-start">
                  <div className="flex items-center gap-2 mb-1.5">
                    <span className="text-xs font-medium text-stone-500">AI 助手</span>
                    <span className="text-xs text-stone-400">{formatTime(new Date())}</span>
                  </div>
                  <div className="px-4 py-3.5 rounded-2xl bg-white border border-stone-100 shadow-sm flex items-center gap-2">
                    <span className="w-1.5 h-1.5 bg-brand-400 rounded-full animate-bounce [animation-duration:0.6s]" />
                    <span className="w-1.5 h-1.5 bg-brand-400 rounded-full animate-bounce [animation-duration:0.6s] [animation-delay:0.1s]" />
                    <span className="w-1.5 h-1.5 bg-brand-400 rounded-full animate-bounce [animation-duration:0.6s] [animation-delay:0.2s]" />
                  </div>
                </div>
              </div>
            )}
          </>
        )}
      </div>

      {/* AI 操作错误提示 */}
      {chatError && (
        <div className="px-5 pb-2">
          <div className="flex items-center justify-between bg-red-50 border border-red-200 rounded-lg px-3 py-2">
            <span className="text-xs text-red-600 truncate flex-1">{chatError}</span>
            <Button variant="ghost" size="sm" onClick={onRetry}
              className="text-red-600 hover:bg-red-100 h-7 text-xs ml-2">
              重试
            </Button>
          </div>
        </div>
      )}

      {/* Input */}
      <div className="p-5 border-t border-stone-100 bg-white/80 backdrop-blur-sm flex-shrink-0">
        <div className="flex gap-2.5 items-end">
          <div className="flex-1 relative">
            <Textarea value={inputValue} onChange={(e) => onInputChange(e.target.value)}
              onKeyDown={(e) => { if (loading || pipelineLoading) return; if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); onSend(); } }}
              disabled={loading || pipelineLoading}
              className="w-full min-h-[3.5rem] max-h-48 resize-none rounded-xl border border-stone-200 focus:border-brand-300 focus:ring-4 focus:ring-brand-100/50 transition-all duration-200 hover:border-stone-300 disabled:opacity-50 disabled:cursor-not-allowed pr-14"
              rows={1} />
          </div>
          <Button onClick={onSend} disabled={loading || pipelineLoading || !inputValue.trim()}
            className="h-[3.5rem] w-[4.5rem] bg-gradient-to-r from-brand-600 to-brand-500 hover:from-brand-700 hover:to-brand-600 text-white rounded-xl shadow-lg shadow-brand-200/50 hover-lift press-scale disabled:opacity-50 disabled:shadow-none disabled:hover-lift transition-all duration-300 flex items-center justify-center group">
            {loading ? <span className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin" /> : <Send className="w-5 h-5 transition-all duration-300 group-hover:translate-x-0.5 group-hover:-translate-y-0.5" />}
          </Button>
        </div>
        <p className="text-xs text-stone-400 text-center mt-2">按 Enter 发送，Shift + Enter 换行</p>
      </div>
    </div>
  );
}
