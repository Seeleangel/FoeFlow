import { useEffect, useRef, useState } from 'react';
import { useAgentRun } from '@/hooks/useAgentRun';
import { isAbortError, throwIfAborted } from '@/lib/agentRuntime';
import { parseJsonObject, parseLayoutDirection } from '@/lib/agentValidation';
import { useArticlePipeline } from '@/hooks/useArticlePipeline';
import { useLayoutPipeline } from '@/hooks/useLayoutPipeline';
import { getAllTemplates } from '@/lib/libraryStorage';
import { seedBuiltinTemplates } from '@/lib/seedTemplates';
import { gatherRequirements } from '@/lib/requirementAgent';
import { buildHtmlArticle } from '@/lib/htmlBuilder';
import { exportToDocx } from '@/lib/wordExport';
import { getDefaultTheme } from '@/lib/themeLoader';
import { analyzeArticleStyles } from '@/lib/articleStyleAnalyzer';
import { saveDraft } from '@/lib/draftStorage';
import { AUTO_SAVE_DEBOUNCE_MS } from '@/lib/constants';
import { showToast } from '@/components/ui/toaster';
import ChatPanel from '@/components/generator/ChatPanel';
import PreviewPanel from '@/components/generator/PreviewPanel';
import {
  saveGeneratorSession,
  loadGeneratorSession,
  deleteGeneratorSession,
  getAllGeneratorSessions,
} from '@/lib/generatorSessionStorage';
import type { GeneratorSessionState } from '@/lib/generatorSessionStorage';
import type { StyleTemplate } from '@/types';
import type { LayoutStrategy, LayoutDirection } from '@/types/layout';

import type { WritingDirection } from '@/types/article';

import { runLayoutAgent, classifyFeedbackIntent } from '@/lib/layoutAgent';

type LayoutFeedbackState = 'idle' | 'awaitingFeedback' | 'awaitingDirection' | 'processing';

interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
  timestamp: Date;
  isHistorical?: boolean;
}

export default function Generator() {
  const [templates, setTemplates] = useState<StyleTemplate[]>([]);
  const [selectedId, setSelectedId] = useState<string>('');
  // 仅保留对话共创模式
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([]);
  const [chatInput, setChatInput] = useState('');
  const [generatedText, setGeneratedText] = useState('');
  const [generatedHtml, setGeneratedHtml] = useState('');
  const [generatedTitle, setGeneratedTitle] = useState('');
  const [loading, setLoading] = useState(false);
  const { begin: beginChatRun, cancel: cancelChatRun } = useAgentRun();
  const [layoutStrategy, setLayoutStrategy] = useState<LayoutStrategy | null>(null);
  const [layoutHtml, setLayoutHtml] = useState<string>('');
  const [layoutFeedbackState, setLayoutFeedbackState] = useState<LayoutFeedbackState>('idle');
  // Smart article pipeline hook
  const {
    articleStage,
    articleSpec,
    articleDirections,
    articleReview,
    articleFixRounds,
    articlePipelineLoading,
    articleProgress,
    setArticleStage,
    launchArticlePipeline,
    handleArticleDirectionSelect,
    cancelArticlePipeline,
  } = useArticlePipeline({
    onArticleGenerated: (article, review, fixRounds) => {
      const targetSession = sessionRef.current;
      generateResultFromText(article).then(async () => {
        if (targetSession !== sessionRef.current) return;
        const articleMsg: ChatMessage = {
          role: 'assistant',
          content: article,
          timestamp: new Date(),
        };
        setChatMessages((prev) => [...prev, articleMsg]);
        showToast(
          `文章已生成${review.passed ? '' : '，请检查自审未通过的内容'}${fixRounds > 0 ? `（修改 ${fixRounds} 轮）` : ''}`,
          review.passed ? 'success' : 'warning'
        );
        // Auto-trigger layout pipeline
        autoLayoutRef.current = true;
        await handleLayoutAnalyze(article);
      });
    },
    onError: (message: string) => {
      showToast(message, 'error');
    },
  });
  const {
    layoutStage,
    layoutProgress,
    cancelLayoutPipeline,
    styleSpec,
    layoutDirections,
    selectedDirection,
    specLoading,
    layoutError,
    pipelineSnapshot,
    setStyleSpec,
    reset,
    handleLayoutAnalyze,
    handleDirectionSelect: handleLayoutDirectionSelect,
    handleRefineLayout,
    setSelectedDirection,
  } = useLayoutPipeline({
    onLayoutGenerated: (html, strategy, fixRounds, review) => {
      setLayoutHtml(html);
      setLayoutStrategy(strategy);
      showToast(
        `排版已生成${review?.passed === false ? '，请检查效果' : ''}${fixRounds > 0 ? `（修改 ${fixRounds} 轮）` : ''}`,
        review?.passed === false ? 'warning' : 'success'
      );
    },
    onError: (message) => showToast(message, 'error'),
  });
  const [sessions, setSessions] = useState<Array<{ id: string; title: string; updatedAt: number }>>([]);
  const [session, setSession] = useState<string>(`generator_${Date.now()}`);
  const [showHistory, setShowHistory] = useState(false);
  const sessionRef = useRef(session);
  sessionRef.current = session;
  const chatScrollRef = useRef<HTMLDivElement>(null);
  const autoLayoutRef = useRef(false);
  // Hold latest styleSpec/selectedDirection in refs so the feedback guard
  // never fails due to stale React state (e.g. after session load or reset).
  const styleSpecRef = useRef(styleSpec);
  styleSpecRef.current = styleSpec;
  const selectedDirectionRef = useRef(selectedDirection);
  selectedDirectionRef.current = selectedDirection;

  // 加载模板、范文风格分析和历史会话
  useEffect(() => {
    const init = async () => {
      try {
        let t = await getAllTemplates();
        if (t.length === 0) {
          await seedBuiltinTemplates();
          t = await getAllTemplates();
        }
        setTemplates(t);

        // Load session history
        const allSessions = await getAllGeneratorSessions();
        setSessions(allSessions.map((s) => ({ id: s.id, title: s.title, updatedAt: s.updatedAt })));

        // Default to a fresh new session — only select first template
        if (t.length > 0) {
          setSelectedId(t[0].id);
        }

        await analyzeArticleStyles();
      } catch (err) {
        console.error('[Generator] Failed to initialize:', err);
      }
    };

    init();
  }, []);

  useEffect(() => {
    // Scroll to bottom on new messages
    if (chatScrollRef.current) {
      chatScrollRef.current.scrollTop = chatScrollRef.current.scrollHeight;
    }
  }, [chatMessages, loading]);

  // Auto-select first layout direction after article-generated layout analysis
  useEffect(() => {
    if (autoLayoutRef.current && layoutDirections.length > 0 && !selectedDirection && generatedText) {
      autoLayoutRef.current = false;
      handleLayoutDirectionSelect(layoutDirections[0], generatedText);
    }
  }, [layoutDirections, selectedDirection, generatedText, handleLayoutDirectionSelect]);

  const flushSave = async () => {
    const currentId = sessionRef.current;
    const hasContent = chatMessages.length > 0 || generatedText.length > 0;
    if (!hasContent) return;
    const state: GeneratorSessionState = {
      messages: chatMessages.map((m) => ({
        ...m,
        timestamp: m.timestamp.toISOString(),
      })),
      chatInput,
      generatedText,
      generatedHtml,
      generatedTitle,
      layoutHtml,
      layoutStrategyJson: layoutStrategy ? JSON.stringify(layoutStrategy) : '',
      styleSpecJson: styleSpec ? JSON.stringify(styleSpec) : '',
      selectedDirectionJson: selectedDirection ? JSON.stringify(selectedDirection) : '',
      selectedTemplateId: selectedId,
    };
    await saveGeneratorSession(currentId, state).catch(console.error);
  };

  const stopAllTasks = () => {
    cancelChatRun(); cancelArticlePipeline(); cancelLayoutPipeline();
    setLoading(false); setLayoutFeedbackState('idle');
  };

  const handleNewSession = async () => {
    stopAllTasks();
    await flushSave();
    const newId = `generator_${Date.now()}`;
    setSession(newId);
    setChatMessages([]);
    setChatInput('');
    setGeneratedText('');
    setGeneratedHtml('');
    setGeneratedTitle('');
    setLayoutHtml('');
    setLayoutStrategy(null);
    reset();
    setLayoutFeedbackState('idle');
    cancelArticlePipeline();
    setShowHistory(false);
  };

  const handleLoadSession = async (sessionId: string) => {
    if (sessionId === sessionRef.current) {
      setShowHistory(false);
      return;
    }
    stopAllTasks();
    await flushSave();
    const loaded = await loadGeneratorSession(sessionId);
    if (loaded) {
      setSession(sessionId);
      setChatMessages(
        loaded.state.messages.map((m) => ({ ...m, timestamp: new Date(m.timestamp), isHistorical: true }))
      );
      setChatInput(loaded.state.chatInput);
      setGeneratedText(loaded.state.generatedText);
      setGeneratedHtml(loaded.state.generatedHtml);
      setGeneratedTitle(loaded.state.generatedTitle);
      setLayoutHtml(loaded.state.layoutHtml);
      if (loaded.state.layoutStrategyJson) {
        try {
          setLayoutStrategy(JSON.parse(loaded.state.layoutStrategyJson));
        } catch {
          setLayoutStrategy(null);
        }
      } else {
        setLayoutStrategy(null);
      }
      reset();
      cancelArticlePipeline();
      if (loaded.state.styleSpecJson) {
        try { setStyleSpec(JSON.parse(loaded.state.styleSpecJson)); } catch { /* keep null */ }
      }
      if (loaded.state.selectedDirectionJson) {
        try { setSelectedDirection(JSON.parse(loaded.state.selectedDirectionJson)); } catch { /* keep null */ }
      }
    }
    setShowHistory(false);
  };

  const handleDeleteSession = async (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    await deleteGeneratorSession(id);
    const updatedSessions = await getAllGeneratorSessions();
    setSessions(updatedSessions.map((s) => ({ id: s.id, title: s.title, updatedAt: s.updatedAt })));
    if (sessionRef.current === id) {
      if (updatedSessions.length > 0) {
        await handleLoadSession(updatedSessions[0].id);
      } else {
        await handleNewSession();
      }
    }
  };

  const selectedTemplate = templates.find((t) => t.id === selectedId);

  // Split AI response: non-article content (questions, confirmations) separated from article content (# headings)
  const splitAiResponse = (reply: string): string[] => {
    const headingIdx = reply.search(/\n\n(?=# )/);
    if (headingIdx === -1) return [reply];
    const nonArticle = reply.substring(0, headingIdx).trim();
    const article = reply.substring(headingIdx + 2).trim();
    if (!nonArticle || !article) return [reply];
    return [nonArticle, article];
  };

  const handleChatSend = async () => {
    if (loading || articlePipelineLoading || layoutStage === 'generating' || specLoading) return;
    const rawText = chatInput.trim() || lastUserInputRef.current;
    if (!rawText) return;
    const chatRun = beginChatRun();
    try {
      const text = rawText;
      lastUserInputRef.current = text;
      setChatError(null);

      // Intercept layout feedback messages (before template check)
      if (layoutFeedbackState === 'awaitingFeedback') {
        const newUserMessage: ChatMessage = { role: 'user', content: text, timestamp: new Date() };
        setChatMessages((prev) => [...prev, newUserMessage]);
        setChatInput('');

        if (text.trim() === '全都不满意') {
          setLayoutFeedbackState('awaitingDirection');
          const directionMsg: ChatMessage = {
            role: 'assistant',
            content: '想要什么感觉？比如更活泼、更正式、更简约……请描述一下你期望的风格方向。',
            timestamp: new Date(),
          };
          setChatMessages((prev) => [...prev, directionMsg]);
          return;
        }

        setLoading(true);
        try {
          const intent = await classifyFeedbackIntent(text, chatRun.signal);
          if (!chatRun.isCurrent()) return;
          if (intent === 'redo') {
            setLayoutFeedbackState('awaitingDirection');
            const directionMsg: ChatMessage = {
              role: 'assistant',
              content: '想要什么感觉？比如更活泼、更正式、更简约……请描述一下你期望的风格方向。',
              timestamp: new Date(),
            };
            setChatMessages((prev) => [...prev, directionMsg]);
          } else {
            if (!layoutHtml) {
              showToast('请先生成排版后再修改', 'warning');
              setLayoutFeedbackState('idle');
              setLoading(false);
              return;
            }
            if (!styleSpecRef.current || !selectedDirectionRef.current) {
              showToast('请先点击「智能排版」生成排版后再修改', 'warning');
              setLayoutFeedbackState('idle');
              setLoading(false);
              return;
            }
            setLayoutFeedbackState('processing');
            const updated = await handleRefineLayout(layoutHtml, text, styleSpecRef.current, selectedDirectionRef.current);
            if (!chatRun.isCurrent()) return;
            if (!updated) { setLayoutFeedbackState('awaitingFeedback'); return; }
            setLayoutFeedbackState('idle');
            const doneMsg: ChatMessage = {
              role: 'assistant',
              content: '已根据你的反馈调整排版，请在右侧预览查看。',
              timestamp: new Date(),
            };
            setChatMessages((prev) => [...prev, doneMsg]);
          }
        } catch (err) {
        if (!chatRun.isCurrent() || isAbortError(err)) return;
          showToast('处理反馈失败：' + String(err), 'error');
          setLayoutFeedbackState('idle');
        } finally {
          if (chatRun.isCurrent()) setLoading(false);
        }
        return;
      }

      if (layoutFeedbackState === 'awaitingDirection') {
        const newUserMessage: ChatMessage = { role: 'user', content: text, timestamp: new Date() };
        setChatMessages((prev) => [...prev, newUserMessage]);
        setChatInput('');

        setLoading(true);
        await handleFullRedoDirection(text, chatRun.signal);
        if (!chatRun.isCurrent()) return;
        setLoading(false);
        return;
      }

      // Normal flow requires template
      if (!selectedTemplate || loading || articlePipelineLoading) return;

      const newUserMessage: ChatMessage = { role: 'user', content: text, timestamp: new Date() };
      const newMessages = [...chatMessages, newUserMessage];
      setChatMessages(newMessages);
      setChatInput('');
      setLoading(true);

      try {
        const result = await gatherRequirements(newMessages, chatRun.signal);

        if (!chatRun.isCurrent()) return;
        if (result.type === 'ready') {
          if (articleStage) {
            showToast('已有文章生成任务进行中，请先取消当前任务', 'warning');
            return;
          }

          const transitionMsg: ChatMessage = {
            role: 'assistant',
            content: result.content,
            timestamp: new Date(),
          };
          const messagesWithTransition = [...newMessages, transitionMsg];
          setChatMessages(messagesWithTransition);

          const pipelineHistory = messagesWithTransition
            .map((m) => `${m.role === 'user' ? '用户' : 'AI'}：${m.content}`)
            .join('\n');
          await launchArticlePipeline(result.collectedInfo?.materials || text, pipelineHistory);
          return;
        }

        // Question — display in chat
        const parts = splitAiResponse(result.content);
        const assistantMessages: ChatMessage[] = parts.map((content, i) => ({
          role: 'assistant',
          content,
          timestamp: new Date(Date.now() + i),
        }));
        setChatMessages([...newMessages, ...assistantMessages]);
      } catch (err) {
        if (!chatRun.isCurrent() || isAbortError(err)) return;
        const errorMsg = String(err);
        showToast(errorMsg, 'error');
        setChatError(errorMsg);
      } finally {
        if (chatRun.isCurrent()) setLoading(false);
      }
    } finally {
      if (chatRun.isCurrent()) { setLoading(false); chatRun.finish(); }
    }
  };

  const generateResultFromText = async (text: string) => {
    if (!selectedTemplate) return;
    try {
      setGeneratedText(text);
      // Remove the # Title line from paragraphs to avoid double rendering in buildHtmlArticle
      const paragraphs = text.split('\n').filter((p) => p.trim() && !p.startsWith('# '));
      const titleMatch = text.match(/^#\s+(.*)$/m);
      const title = titleMatch ? titleMatch[1].trim() : (generatedTitle || selectedTemplate.name);
      setGeneratedTitle(title);
      setGeneratedHtml(buildHtmlArticle(title, paragraphs, getDefaultTheme()));
      // Reset layout pipeline state when new article content is generated, so the
      // preview panel shows the latest article instead of stale layout artifacts.
      setLayoutStrategy(null);
      setLayoutHtml('');
      reset();
      setLayoutFeedbackState('idle');
    } catch (err) {
      showToast(String(err), 'error');
    }
  };

  // 自动保存会话到历史
  useEffect(() => {
    const hasContent = chatMessages.length > 0 || generatedText.length > 0;
    if (!hasContent) return;

    const currentId = session;
    const timer = setTimeout(() => {
      const state: GeneratorSessionState = {
        messages: chatMessages.map((m) => ({
          ...m,
          timestamp: m.timestamp.toISOString(),
        })),
        chatInput,
        generatedText,
        generatedHtml,
        generatedTitle,
        layoutHtml,
        layoutStrategyJson: layoutStrategy ? JSON.stringify(layoutStrategy) : '',
        styleSpecJson: styleSpec ? JSON.stringify(styleSpec) : '',
        selectedDirectionJson: selectedDirection ? JSON.stringify(selectedDirection) : '',
        selectedTemplateId: selectedId,
      };
      saveGeneratorSession(currentId, state)
        .then(() => {
          setSessions((prev) => {
            const filtered = prev.filter((s) => s.id !== currentId);
            return [
              { id: currentId, title: generatedTitle || '未命名生成', updatedAt: Date.now() },
              ...filtered,
            ];
          });
        })
        .catch(console.error);
    }, AUTO_SAVE_DEBOUNCE_MS);

    return () => clearTimeout(timer);
  }, [chatMessages, chatInput, generatedText, generatedHtml, generatedTitle, layoutStrategy, layoutHtml, selectedId, styleSpec, selectedDirection, session]);

  const flushRef = useRef({ chatMessages, chatInput, generatedText, generatedHtml, generatedTitle, layoutHtml, layoutStrategy, styleSpec, selectedDirection, selectedId });
  flushRef.current = { chatMessages, chatInput, generatedText, generatedHtml, generatedTitle, layoutHtml, layoutStrategy, styleSpec, selectedDirection, selectedId };

  // Flush save on unmount
  useEffect(() => {
    return () => {
      const latest = flushRef.current;
      const currentId = sessionRef.current;
      const hasContent = latest.chatMessages.length > 0 || latest.generatedText.length > 0;
      if (!hasContent) return;
      const state: GeneratorSessionState = {
        messages: latest.chatMessages.map((m) => ({
          ...m,
          timestamp: m.timestamp.toISOString(),
        })),
        chatInput: latest.chatInput,
        generatedText: latest.generatedText,
        generatedHtml: latest.generatedHtml,
        generatedTitle: latest.generatedTitle,
        layoutHtml: latest.layoutHtml,
        layoutStrategyJson: latest.layoutStrategy ? JSON.stringify(latest.layoutStrategy) : '',
        styleSpecJson: latest.styleSpec ? JSON.stringify(latest.styleSpec) : '',
        selectedDirectionJson: latest.selectedDirection ? JSON.stringify(latest.selectedDirection) : '',
        selectedTemplateId: latest.selectedId,
      };
      saveGeneratorSession(currentId, state).catch(console.error);
    };
  }, []);

  const [chatError, setChatError] = useState<string | null>(null);
  const lastUserInputRef = useRef('');
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  // PreviewPanel callbacks
  const handlePreviewArticleDirectionSelect = (direction: WritingDirection) => {
    const history = chatMessages
      .map((m) => `${m.role === 'user' ? '用户' : 'AI'}：${m.content}`)
      .join('\n');
    handleArticleDirectionSelect(direction, history);
  };

  const handlePreviewArticleAdjustStyle = () => {
    const adjustMsg: ChatMessage = {
      role: 'assistant',
      content: '请描述您对风格模板的调整要求（如语气、篇幅、结构等），我会重新分析并更新风格规格。',
      timestamp: new Date(),
    };
    setChatMessages((prev) => [...prev, adjustMsg]);
  };

  const handleArticleSpecConfirm = () => {
    setArticleStage('directionSelect');
  };

  const handleArticleBackToStyle = () => {
    setArticleStage('styleConfirm');
  };

  const handlePreviewLayoutAnalyze = async () => {
    await handleLayoutAnalyze(generatedText);
  };

  const handlePreviewLayoutDirectionSelect = (direction: LayoutDirection) => {
    handleLayoutDirectionSelect(direction, generatedText);
  };

  const handleRequestRefine = () => {
    setLayoutFeedbackState('awaitingFeedback');
    const refineMsg: ChatMessage = {
      role: 'assistant',
      content: '请说说不满意的地方，我会针对性修改。\n__LAYOUT_TAGS__:颜色,间距,结构,装饰,字体,全都不满意',
      timestamp: new Date(),
    };
    setChatMessages((prev) => [...prev, refineMsg]);
  };

  const handleLayoutTagAction = (tag: string) => {
    if (tag === '全都不满意') {
      setLayoutFeedbackState('awaitingDirection');
      const directionMsg: ChatMessage = {
        role: 'assistant',
        content: '想要什么感觉？比如更活泼、更正式、更简约……请描述一下你期望的风格方向。',
        timestamp: new Date(),
      };
      setChatMessages((prev) => [...prev, directionMsg]);
    }
  };

  const handleFullRedoDirection = async (directionDesc: string, signal?: AbortSignal) => {
    const spec = styleSpecRef.current;
    if (!spec) return;
    setLayoutFeedbackState('processing');

    try {
      const { callAI } = await import('@/lib/ai');

      const directionPrompt = `基于以下风格规格和用户描述，生成一个新排版方向。输出纯 JSON：

{
  "id": "d-refine",
  "name": "方向名称",
  "description": "简短描述",
  "features": ["特征1", "特征2"],
  "whyFit": "为什么适合",
  "philosophy": "设计哲学"
}

风格规格：
- 文章类型：${spec.articleType}
- 情感基调：${spec.emotionTone}
- 主色：${spec.primaryColor}
- 辅色：${spec.secondaryColor}
- 装饰密度：${spec.density}
- 关键词：${spec.keywords.join('、')}

用户描述：${directionDesc}`;

      const response = await callAI({
        messages: [
          { role: 'system', content: '你是排版方向设计师。根据用户描述生成一个新的排版方向。只输出 JSON，不要其他。' },
          { role: 'user', content: directionPrompt },
        ],
        temperature: 0.5,
        purpose: 'general',
        signal,
      });

      throwIfAborted(signal);
      const newDirection = parseLayoutDirection(parseJsonObject(response.content));

      const result = await runLayoutAgent(generatedText, spec, newDirection, { skipAnalyze: true, signal });

      throwIfAborted(signal);
      const strategy: LayoutStrategy = {
        articleType: spec.articleType as LayoutStrategy['articleType'],
        style: newDirection.name,
        density: spec.density,
        colorScheme: {
          primary: spec.primaryColor,
          secondary: spec.secondaryColor,
          ...(spec.accentColor ? { accent: spec.accentColor } : {}),
        },
        layoutPattern: 'default',
        decorations: [],
      };

      setLayoutHtml(result.html);
      setLayoutStrategy(strategy);
      setSelectedDirection(newDirection);
      setLayoutFeedbackState('idle');
      const doneMsg: ChatMessage = {
        role: 'assistant',
        content: `已按「${newDirection.name}」方向重新生成排版，请在右侧预览查看。`,
        timestamp: new Date(),
      };
      setChatMessages((prev) => [...prev, doneMsg]);
      showToast(result.review.passed ? '排版已重新生成' : '排版已生成，请检查效果', result.review.passed ? 'success' : 'warning');
    } catch (err) {
      if (signal?.aborted || isAbortError(err)) return;
      showToast('重新排版失败：' + String(err), 'error');
      setLayoutFeedbackState('idle');
    }
  };

  const handleCopyHtml = () => {
    navigator.clipboard
      .writeText(layoutHtml || generatedHtml)
      .then(() => showToast('HTML 已复制到剪贴板', 'success'));
  };

  const handleSaveDraft = async () => {
    const title = generatedTitle || selectedTemplate?.name || '未命名文章';
    try {
      await saveDraft({
        id: crypto.randomUUID(),
        templateId: selectedTemplate?.id || '',
        mode: 'generator-draft',
        paramsJson: { title },
        contentHtml: generatedHtml,
        contentText: generatedText,
        createdAt: Date.now(),
      });
      showToast('草稿已保存到工作台', 'success');
    } catch (err) {
      showToast('保存失败：' + String(err), 'error');
    }
  };

  const handleExportWord = async () => {
    const paragraphs = generatedText.split('\n').filter((p) => p.trim());
    const title = generatedTitle || selectedTemplate?.name || '未命名文章';
    const blob = await exportToDocx(title, paragraphs);
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${title}.docx`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className={`h-screen overflow-hidden bg-gradient-to-b from-stone-50 to-white transition-opacity duration-500 ${mounted ? 'opacity-100' : 'opacity-0'}`}>
      {/* 页面标题区域 */}
      <div className={`max-w-5xl mx-auto px-8 pt-12 pb-8 transition-all duration-500 ease-out ${mounted ? 'translate-y-0 opacity-100' : 'translate-y-4 opacity-0'}`}>
        <div className="flex items-start justify-between">
          <div>
            <h1 className="text-3xl font-bold text-stone-900 tracking-tight mb-2">文章生成器</h1>
            <p className="text-base text-stone-500">选择风格模板，快速生成或对话共创推文内容</p>
            {(loading || articlePipelineLoading || specLoading || layoutStage === 'generating') && (
              <div className="mt-3 flex items-center gap-3 text-sm" role="status">
                <span className="text-stone-500">{articleProgress || layoutProgress || '正在整理需求'}</span>
                <button type="button" onClick={stopAllTasks} className="text-red-600 hover:underline">停止生成</button>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* 主内容区域 */}
      <div className="max-w-5xl mx-auto px-8 pb-6 h-[calc(100vh-8rem)] overflow-hidden">
        {selectedTemplate && (
          <div className="grid grid-cols-2 gap-6 h-full">
            <div className="h-full overflow-hidden">
              <ChatPanel
                messages={chatMessages}
                inputValue={chatInput}
                loading={loading}
                pipelineLoading={articlePipelineLoading || specLoading || layoutStage === 'generating'}
                showHistory={showHistory}
                sessions={sessions}
                currentSessionId={session}
                chatScrollRef={chatScrollRef}
                chatError={chatError}
                onInputChange={setChatInput}
                onSend={handleChatSend}
                onNewSession={handleNewSession}
                onLoadSession={handleLoadSession}
                onDeleteSession={handleDeleteSession}
                onToggleHistory={() => setShowHistory((v) => !v)}
                onGeneratePreview={generateResultFromText}
                onRetry={handleChatSend}
                onLayoutTagClick={handleLayoutTagAction}
              />
            </div>
            <PreviewPanel
              articleStage={articleStage}
              articleSpec={articleSpec}
              articleDirections={articleDirections}
              articleReview={articleReview}
              articleFixRounds={articleFixRounds}
              onArticleSpecConfirm={handleArticleSpecConfirm}
              onArticleDirectionSelect={handlePreviewArticleDirectionSelect}
              onArticleCancel={stopAllTasks}
              onArticleAdjustStyle={handlePreviewArticleAdjustStyle}
              onArticleBackToStyle={handleArticleBackToStyle}
              layoutStage={layoutStage}
              styleSpec={styleSpec}
              layoutDirections={layoutDirections}
              selectedDirection={selectedDirection}
              specLoading={specLoading}
              layoutError={layoutError}
              layoutStrategy={layoutStrategy}
              pipelineSnapshot={pipelineSnapshot}
              layoutHtml={layoutHtml}
              onLayoutAnalyze={handlePreviewLayoutAnalyze}
              onLayoutDirectionSelect={handlePreviewLayoutDirectionSelect}
              onStyleSpecChange={setStyleSpec}
              generatedHtml={generatedHtml}
              generatedText={generatedText}
              generatedTitle={generatedTitle}
              selectedTemplateName={selectedTemplate.name}
              selectedTemplateId={selectedTemplate.id}
              layoutFeedbackState={layoutFeedbackState}
              onLayoutRefineRequest={handleRequestRefine}
              onLayoutTagAction={handleLayoutTagAction}
              onCopyHtml={handleCopyHtml}
              onSaveDraft={handleSaveDraft}
              onExportWord={handleExportWord}
            />
          </div>
        )}
      </div>
    </div>
  );
}
