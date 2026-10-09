import { useEffect, useRef, useState } from 'react';
import { Book, History, Image, PenTool, Search } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import ImageCompressorPanel from '@/components/ImageCompressorPanel';
import ArticlesTab from '@/components/library/ArticlesTab';
import DraftsTab from '@/components/library/DraftsTab';
import AuditsTab from '@/components/library/AuditsTab';
import { getAllUserArticles, saveUserArticle, deleteUserArticle } from '@/lib/libraryStorage';
import { getAllDrafts, deleteDraft } from '@/lib/draftStorage';
import { getAllAuditRecords, deleteAuditRecord } from '@/lib/auditStorage';
import type { UserArticle, GeneratedDraft, AuditRecord } from '@/types';

export default function Library({
  onNavigate,
}: {
  onNavigate?: (page: string) => void;
}) {
  const [articles, setArticles] = useState<UserArticle[]>([]);
  const [drafts, setDrafts] = useState<GeneratedDraft[]>([]);
  const [audits, setAudits] = useState<AuditRecord[]>([]);
  const [activeTab, setActiveTab] = useState<'articles' | 'drafts' | 'audits' | 'image-compress'>('articles');
  const [newTitle, setNewTitle] = useState('');
  const [newContent, setNewContent] = useState('');
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [loading, setLoading] = useState(true);
  const [mounted, setMounted] = useState(false);
  const [tabContentVisible, setTabContentVisible] = useState(true);
  const tabContainerRef = useRef<HTMLDivElement>(null);
  const [sliderStyle, setSliderStyle] = useState({ left: 0, width: 0 });

  const EASE_OUT_QUART = 'cubic-bezier(0.25, 1, 0.5, 1)';

  const refresh = async () => {
    const [a, d, au] = await Promise.all([getAllUserArticles(), getAllDrafts(), getAllAuditRecords()]);
    setArticles(a);
    setDrafts(d);
    setAudits(au);
  };

  useEffect(() => {
    setMounted(true);
    refresh().finally(() => setLoading(false));
  }, []);

  const handleAddArticle = async () => {
    if (!newTitle.trim() || !newContent.trim()) return;
    const article: UserArticle = {
      id: crypto.randomUUID(),
      title: newTitle,
      sourceUrl: '',
      content: newContent,
      templateId: null,
      tags: [],
      createdAt: Date.now(),
    };
    await saveUserArticle(article);
    setNewTitle('');
    setNewContent('');
    await refresh();
  };

  const handleDelete = async (id: string) => {
    await deleteUserArticle(id);
    await refresh();
  };

  const filteredArticles = articles.filter((article) => {
    if (!searchQuery.trim()) return true;
    const q = searchQuery.toLowerCase();
    return article.title.toLowerCase().includes(q) || article.content.toLowerCase().includes(q);
  });

  const filteredDrafts = drafts.filter((draft) => {
    if (!searchQuery.trim()) return true;
    const q = searchQuery.toLowerCase();
    const title = (draft.paramsJson?.title as string) ?? '';
    return title.toLowerCase().includes(q) || draft.contentText.toLowerCase().includes(q);
  });

  const filteredAudits = audits.filter((audit) => {
    if (!searchQuery.trim()) return true;
    const q = searchQuery.toLowerCase();
    const contentMatch = audit.inputContent.toLowerCase().includes(q);
    const issueMatch = audit.resultJson.issues.some(
      (issue) => issue.message.toLowerCase().includes(q) || issue.suggestion?.toLowerCase().includes(q)
    );
    return contentMatch || issueMatch;
  });

  const handleDeleteDraft = async (id: string) => {
    await deleteDraft(id);
    await refresh();
  };

  const handleDeleteAudit = async (id: string) => {
    await deleteAuditRecord(id);
    await refresh();
  };

  const tabs = [
    { key: 'articles' as const, icon: Book, label: '我的文章' },
    { key: 'drafts' as const, icon: PenTool, label: '草稿箱' },
    { key: 'audits' as const, icon: History, label: '审核历史' },
        { key: 'image-compress' as const, icon: Image, label: '图片压缩' },
  ];

  // Tab slider position
  useEffect(() => {
    const updateSlider = () => {
      const container = tabContainerRef.current;
      if (!container) return;
      const activeIndex = tabs.findIndex((t) => t.key === activeTab);
      const activeBtn = container.children[activeIndex + 1] as HTMLElement;
      if (activeBtn) {
        setSliderStyle({
          left: activeBtn.offsetLeft,
          width: activeBtn.offsetWidth,
        });
      }
    };
    updateSlider();
    window.addEventListener('resize', updateSlider);
    return () => window.removeEventListener('resize', updateSlider);
  }, [activeTab]);

  // Tab content fade transition
  const handleTabChange = (key: typeof activeTab) => {
    if (key === activeTab) return;
    setTabContentVisible(false);
    setTimeout(() => {
      setActiveTab(key);
      setTimeout(() => setTabContentVisible(true), 30);
    }, 150);
  };

  return (
    <div className="p-8 pb-12">
      {/* 页面标题 */}
      <div
        className="mb-6"
        style={{
          opacity: mounted ? 1 : 0,
          transform: mounted ? 'translateY(0)' : 'translateY(8px)',
          transition: `opacity 0.5s ${EASE_OUT_QUART}, transform 0.5s ${EASE_OUT_QUART}`,
        }}
      >
        <h1 className="text-2xl font-bold text-stone-900 tracking-tight">工作台</h1>
        <p className="text-sm text-stone-500 mt-1">管理文章素材、草稿、审核记录和图片压缩</p>
      </div>

      {/* 模式选择 - 滑动分段控制器 */}
      <div
        ref={tabContainerRef}
        className="relative flex gap-1 mb-6 p-1 bg-stone-100 rounded-lg w-fit"
        style={{
          opacity: mounted ? 1 : 0,
          transform: mounted ? 'translateY(0)' : 'translateY(6px)',
          transition: `opacity 0.45s ${EASE_OUT_QUART} 60ms, transform 0.45s ${EASE_OUT_QUART} 60ms`,
        }}
      >
        {/* 滑动背景 */}
        <div
          className="absolute top-1 bottom-1 bg-white rounded-md shadow-sm transition-all duration-300 ease-out"
          style={{ left: sliderStyle.left, width: sliderStyle.width }}
        />
        {tabs.map(({ key, icon: Icon, label }) => (
          <button
            key={key}
            onClick={() => handleTabChange(key)}
            className={`relative z-10 px-4 py-2 rounded-md text-sm font-medium transition-colors duration-300 ${
              activeTab === key ? 'text-stone-900' : 'text-stone-600 hover:text-stone-900'
            }`}
          >
            <Icon className="w-4 h-4 inline mr-2" />
            {label}
          </button>
        ))}
      </div>

      {/* 搜索栏 — 图片压缩以外显示 */}
      {activeTab !== 'image-compress' && (
        <div className="relative mb-4">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-stone-400" />
          <Input
            placeholder={
              activeTab === 'articles'
                ? '搜索文章标题或内容...'
                : activeTab === 'drafts'
                  ? '搜索草稿标题或正文...'
                  : '搜索审核内容或问题...'
            }
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="pl-9"
            style={{
              opacity: mounted ? 1 : 0,
              transform: mounted ? 'translateY(0)' : 'translateY(4px)',
              transition: `opacity 0.4s ${EASE_OUT_QUART} 120ms, transform 0.4s ${EASE_OUT_QUART} 120ms`,
            }}
          />
        </div>
      )}

      {/* Tab 内容区 */}
      <div
        style={{
          opacity: tabContentVisible ? 1 : 0,
          transform: tabContentVisible ? 'translateY(0)' : 'translateY(6px)',
          transition: `opacity 0.25s ${EASE_OUT_QUART}, transform 0.25s ${EASE_OUT_QUART}`,
        }}
      >

      {/* Skeleton loading — crossfade to content */}
      <div className="relative">
        <div
          className={`space-y-3 transition-opacity duration-300 ${loading ? 'opacity-100' : 'opacity-0 pointer-events-none absolute inset-0'}`}
        >
          <Skeleton className="h-10 w-full" />
          <Skeleton className="h-10 w-2/3" />
          <Skeleton className="h-32 w-full" />
        </div>
        <div className={`transition-opacity duration-300 ${loading ? 'opacity-0' : 'opacity-100'}`}>
          {/* 导入文章 */}
          {activeTab === 'articles' && (
            <ArticlesTab
              newTitle={newTitle}
              newContent={newContent}
              onTitleChange={setNewTitle}
              onContentChange={setNewContent}
              onAdd={handleAddArticle}
              articles={filteredArticles}
              emptyMessage={searchQuery.trim() ? '未找到匹配的文章' : '暂无文章'}
              emptyHint={searchQuery.trim() ? '请尝试其他关键词' : '添加第一篇文章素材吧'}
              expandedId={expandedId}
              onToggleExpand={setExpandedId}
              onDelete={handleDelete}
              canAdd={!newTitle.trim() || !newContent.trim()}
            />
          )}

          {/* 草稿箱标签页 */}
          {activeTab === 'drafts' && (
            <DraftsTab
              drafts={filteredDrafts}
              expandedId={expandedId}
              onToggleExpand={setExpandedId}
              onDelete={handleDeleteDraft}
              onNavigate={onNavigate}
            />
          )}

          {/* 审核历史标签页 */}
          {activeTab === 'audits' && (
            <AuditsTab
              audits={filteredAudits}
              expandedId={expandedId}
              onToggleExpand={setExpandedId}
              onDelete={handleDeleteAudit}
            />
          )}

          {/* 图片压缩标签页 */}
          <div style={{ display: activeTab === 'image-compress' ? 'block' : 'none' }}>
            <ImageCompressorPanel isActive={activeTab === 'image-compress'} />
          </div>

                  </div>
      </div>
      </div>
    </div>
  );
}
