import { useState, useEffect, useRef } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { FileText, Image, Link2, CheckCircle, AlertCircle, Sparkles } from 'lucide-react';
import { callSchoolLLM, buildAuditPrompt, callSchoolLLMWithImages } from '@/lib/apiClient';
import { showToast } from '@/components/ui/toaster';
import { parseAuditResult } from '@/lib/auditParser';
import { fetchXiemiArticle } from '@/lib/xiemiFetcher';
import { captureArticleScreenshots } from '@/lib/articleScreenshot';
import { loadSettings } from '@/lib/settingsStorage';
import { saveAuditRecord, loadAuditDraft, saveAuditDraft } from '@/lib/auditStorage';
import { AUTO_SAVE_DEBOUNCE_MS } from '@/lib/constants';
import { getSeverityColor, getSeverityLabel } from '@/lib/severity';
import type { AuditIssue } from '@/types';

interface ScreenshotItem {
  id: string;
  file: File;
  name: string;
  base64: string;
  previewUrl: string;
  size: number;
}

function readFileAsScreenshotItem(file: File): Promise<ScreenshotItem> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result as string;
      resolve({
        id: crypto.randomUUID(),
        file,
        name: file.name || '已粘贴的图片.png',
        base64: result.split(',')[1],
        previewUrl: URL.createObjectURL(file),
        size: file.size,
      });
    };
    reader.onerror = () => reject(new Error('读取文件失败'));
    reader.readAsDataURL(file);
  });
}

function validateImageFile(file: File): string | null {
  if (file.size > 5 * 1024 * 1024) return '图片过大，请选择小于 5MB 的文件';
  if (!['image/png', 'image/jpeg'].includes(file.type)) return '仅支持 PNG 和 JPG 格式';
  return null;
}

const SEVERITY_ICONS: Record<string, string> = {
  high: '🔴',
  medium: '🟡',
  low: '🔵',
  pass: '🟢',
};

export default function AuditStation() {
  const [xiemiUrl, setXiemiUrl] = useState('');
  const [textContent, setTextContent] = useState('');
  const [issues, setIssues] = useState<AuditIssue[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [resultVisible, setResultVisible] = useState(false);
  const [inputMode, setInputMode] = useState<'text' | 'xiemi' | 'screenshot'>('text');
  const [screenshots, setScreenshots] = useState<ScreenshotItem[]>([]);
  const [pageLoading, setPageLoading] = useState(true);
  const [mounted, setMounted] = useState(false);
  const tabContainerRef = useRef<HTMLDivElement>(null);
  const [sliderStyle, setSliderStyle] = useState({ left: 0, width: 0 });
  const autoSaveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastAuditTypeRef = useRef<'text' | 'xiemi' | 'screenshot' | null>(null);

  useEffect(() => {
    setMounted(true);
    // 加载已保存的输入草稿
    loadAuditDraft()
      .then((draft) => {
        if (draft) {
          setInputMode(draft.inputMode);
          setTextContent(draft.textContent);
          setXiemiUrl(draft.xiemiUrl);
        }
      })
      .catch(console.error)
      .finally(() => setPageLoading(false));
  }, []);

  // 自动保存输入草稿
  useEffect(() => {
    if (autoSaveTimer.current) clearTimeout(autoSaveTimer.current);
    autoSaveTimer.current = setTimeout(() => {
      saveAuditDraft({
        inputMode,
        textContent,
        xiemiUrl,
      }).catch(console.error);
    }, AUTO_SAVE_DEBOUNCE_MS);
    return () => {
      if (autoSaveTimer.current) clearTimeout(autoSaveTimer.current);
    };
  }, [inputMode, textContent, xiemiUrl]);

  // Trigger result entrance animation when issues arrive
  useEffect(() => {
    if (issues !== null) {
      const timer = setTimeout(() => setResultVisible(true), 50);
      return () => clearTimeout(timer);
    } else {
      setResultVisible(false);
    }
  }, [issues]);

  const tabs = [
    { mode: 'text' as const, icon: FileText, label: '纯文本' },
    { mode: 'xiemi' as const, icon: Link2, label: '秀米链接' },
    { mode: 'screenshot' as const, icon: Image, label: '截图上传' },
  ];

  useEffect(() => {
    const updateSlider = () => {
      const container = tabContainerRef.current;
      if (!container) return;
      const activeIndex = tabs.findIndex((t) => t.mode === inputMode);
      const activeBtn = container.children[activeIndex + 1] as HTMLElement; // +1 for slider div
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
  }, [inputMode]);

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (screenshots.length >= 10) {
      showToast('最多支持 10 张图片', 'error');
      return;
    }

    const error = validateImageFile(file);
    if (error) {
      showToast(error, 'error');
      return;
    }

    try {
      const item = await readFileAsScreenshotItem(file);
      setScreenshots((prev) => [...prev, item]);
    } catch {
      showToast('读取文件失败', 'error');
    }
  };

  const handleRemoveScreenshot = (id: string) => {
    setScreenshots((prev) => {
      const item = prev.find((s) => s.id === id);
      if (item) {
        URL.revokeObjectURL(item.previewUrl);
      }
      return prev.filter((s) => s.id !== id);
    });
  };

  const handleScreenshotAudit = async () => {
    if (screenshots.length === 0) return;
    lastAuditTypeRef.current = 'screenshot';
    setLoading(true);
    setError(null);
    setIssues(null);
    try {
      const settings = await loadSettings();
      const prompt = await buildAuditPrompt('截图中的推文', settings.enabledAuditRules);
      const base64Images = screenshots.map((s) => s.base64);
      const raw = await callSchoolLLMWithImages(prompt, base64Images);
      console.log('[AuditStation] Screenshot LLM returned, raw length:', raw.length);
      const parsed = parseAuditResult(raw);
      console.log('[AuditStation] Screenshot parsed issues:', parsed.length, parsed);
      setIssues(parsed);

      // 保存审核记录
      try {
        await saveAuditRecord({
          id: crypto.randomUUID(),
          inputType: 'screenshot',
          inputContent: `截图审核（${screenshots.length} 张图片）`,
          resultJson: { issues: parsed },
          createdAt: Date.now(),
        });
      } catch (saveErr) {
        console.error('[AuditStation] Failed to save screenshot audit record:', saveErr);
      }
    } catch (err) {
      const msg = String(err);
      console.error('[AuditStation] Screenshot audit failed:', err);
      setError(msg);
    } finally {
      setLoading(false);
    }
  };

  const handleAudit = async (inputType: 'text' | 'xiemi') => {
    lastAuditTypeRef.current = inputType;
    setLoading(true);
    setError(null);
    setIssues(null);
    setResultVisible(false);
    try {
      const settings = await loadSettings();
      console.log('[AuditStation] Settings loaded, enabledRules:', settings.enabledAuditRules);
      let content = '';
      if (inputType === 'xiemi') {
        const article = await fetchXiemiArticle(xiemiUrl);

        // 构建文字内容（保留纯文本给 LLM 交叉参考）
        content = `标题：${article.title}\n\n${article.contentText}`;

        // 自动截图并走多模态审核
        let screenshots: string[] | null = null;
        try {
          console.log('[AuditStation] Capturing screenshots from rawHtml, length:', article.rawHtml.length);
          screenshots = await captureArticleScreenshots(article.rawHtml);
          console.log('[AuditStation] Screenshots captured:', screenshots.length);
        } catch (screenshotErr) {
          console.warn('[AuditStation] Screenshot capture failed, falling back to text-only:', screenshotErr);
          showToast('截图生成失败，已使用纯文本审核', 'warning');
          // 回退时补充图片 URL 信息
          if (article.imageUrls.length > 0) {
            content += `\n\n【推文包含 ${article.imageUrls.length} 张配图】\n图片地址：\n${article.imageUrls.map((url, i) => `${i + 1}. ${url}`).join('\n')}`;
          }
        }

        if (screenshots && screenshots.length > 0) {
          // 限制截图数量，避免请求过大
          const MAX_SCREENS = 12;
          const cappedScreenshots = screenshots.length > MAX_SCREENS
            ? [...screenshots.slice(0, MAX_SCREENS - 2), ...screenshots.slice(-2)]
            : screenshots;
          if (screenshots.length > MAX_SCREENS) {
            showToast(`推文较长，审核仅使用前${MAX_SCREENS - 2}张和最后2张截图`, 'warning');
          }

          const prompt = await buildAuditPrompt(content, settings.enabledAuditRules);
          const raw = await callSchoolLLMWithImages(prompt, cappedScreenshots);
          console.log('[AuditStation] Multimodal LLM returned, raw length:', raw.length);
          const parsed = parseAuditResult(raw);
          setIssues(parsed);

          // 保存审核记录
          try {
            await saveAuditRecord({
              id: crypto.randomUUID(),
              inputType: 'xiemi-link',
              inputContent: content,
              resultJson: { issues: parsed },
              createdAt: Date.now(),
            });
          } catch (saveErr) {
            console.error('[AuditStation] Failed to save audit record:', saveErr);
          }

          setXiemiUrl('');
          setResultVisible(true);
          return; // 走多模态管线，跳过下面纯文本 LLM 调用
        }
        // 截图失败或无截图时，回退到纯文本审核（继续执行下方 LLM 调用）
      } else {
        content = textContent;
      }
      const prompt = await buildAuditPrompt(content, settings.enabledAuditRules);
      console.log('[AuditStation] Prompt built, length:', prompt.length);
      const raw = await callSchoolLLM([
        { role: 'system', content: '你是一位专业的教育类公众号推文审核专家。' },
        { role: 'user', content: prompt },
      ]);
      console.log('[AuditStation] LLM returned, raw length:', raw.length, 'first 100 chars:', raw.slice(0, 100));
      const parsed = parseAuditResult(raw);
      console.log('[AuditStation] Parsed issues:', parsed.length, parsed);
      setIssues(parsed);

      // 清空已提交的输入内容（截图模式保留）
      if (inputType === 'text') {
        setTextContent('');
      } else if (inputType === 'xiemi') {
        setXiemiUrl('');
      }

      // 保存审核记录
      try {
        await saveAuditRecord({
          id: crypto.randomUUID(),
          inputType: inputType === 'xiemi' ? 'xiemi-link' : inputType,
          inputContent: content,
          resultJson: { issues: parsed },
          createdAt: Date.now(),
        });
        console.log('[AuditStation] Audit record saved');
      } catch (saveErr) {
        console.error('[AuditStation] Failed to save audit record:', saveErr);
      }
    } catch (err) {
      const msg = String(err);
      console.error('[AuditStation] Audit failed:', err);
      setError(msg);
    } finally {
      setLoading(false);
    }
  };

  // Cleanup preview URLs on unmount
  useEffect(() => {
    return () => {
      // Cannot reliably clean up all URLs here since screenshots state is stale
      // Individual removals already call URL.revokeObjectURL
    };
  }, []);

  // 监听全局 paste 事件
  useEffect(() => {
    const handlePasteEvent = async (e: ClipboardEvent) => {
      if (inputMode !== 'screenshot') return;

      const items = e.clipboardData?.items;
      if (!items) return;

      for (let i = 0; i < items.length; i++) {
        if (items[i].type.indexOf('image') !== -1) {
          const file = items[i].getAsFile();
          if (!file) continue;

          if (screenshots.length >= 10) {
            showToast('最多支持 10 张图片', 'error');
            return;
          }

          const error = validateImageFile(file);
          if (error) {
            showToast(error, 'error');
            return;
          }

          try {
            const item = await readFileAsScreenshotItem(file);
            setScreenshots((prev) => [...prev, item]);
          } catch {
            showToast('读取文件失败', 'error');
          }
          break;
        }
      }
    };

    window.addEventListener('paste', handlePasteEvent);
    return () => {
      window.removeEventListener('paste', handlePasteEvent);
    };
  }, [inputMode, screenshots]);

  return (
    <div className={`p-8 pb-12 transition-opacity duration-500 ${mounted ? 'opacity-100' : 'opacity-0'}`}>
      {/* 页面标题 */}
      <div className={`mb-6 transition-all duration-500 ease-out ${mounted ? 'translate-y-0 opacity-100' : 'translate-y-4 opacity-0'}`}>
        <h1 className="text-2xl font-bold text-stone-900 tracking-tight hover:scale-[1.01] transition-transform duration-300 origin-left flex items-center gap-3">
          智能审核台
          <Sparkles className="w-5 h-5 text-red-500 animate-pulse-slow" />
        </h1>
        <p className="text-sm text-stone-500 mt-1 transition-colors duration-300">多模式推文审核，识别文字、内容、合规、排版问题</p>
      </div>

      {/* 模式选择 - 滑动分段控制器 */}
      <div
        ref={tabContainerRef}
        className={`relative flex gap-1 mb-6 p-1 bg-stone-100 rounded-lg w-fit transition-all duration-500 ease-out ${mounted ? 'translate-y-0 opacity-100' : 'translate-y-4 opacity-0'}`}
        style={{ transitionDelay: '100ms' }}
      >
        {/* 滑动背景 */}
        <div
          className="absolute top-1 bottom-1 bg-white rounded-md shadow-sm transition-all duration-300 ease-out"
          style={{ left: sliderStyle.left, width: sliderStyle.width }}
        />
        {tabs.map(({ mode, icon: Icon, label }) => (
          <button
            key={mode}
            onClick={() => setInputMode(mode)}
            className={`relative z-10 px-4 py-2 rounded-md text-sm font-medium transition-colors duration-300 flex items-center gap-2 ${
              inputMode === mode ? 'text-stone-900' : 'text-stone-600 hover:text-stone-900'
            }`}
          >
            <Icon className={`w-4 h-4 transition-transform duration-300 ${inputMode === mode ? 'scale-110' : ''}`} />
            {label}
          </button>
        ))}
      </div>

      {/* Skeleton loading — crossfade to content */}
      <div className="relative">
        <div
          className={`space-y-3 transition-opacity duration-300 ${pageLoading ? 'opacity-100' : 'opacity-0 pointer-events-none absolute inset-0'}`}
        >
          <Skeleton className="h-10 w-full" />
          <Skeleton className="h-10 w-2/3" />
          <Skeleton className="h-32 w-full" />
        </div>
        <div className={`transition-opacity duration-300 ${pageLoading ? 'opacity-0' : 'opacity-100'}`}>
          {/* 纯文本模式 */}
          {inputMode === 'text' && (
            <div className="space-y-4">
              <div className="space-y-2">
                <label className="text-sm font-medium text-stone-700 mb-2 block transition-colors duration-300 hover:text-red-600">推文内容</label>
                <Textarea
                  value={textContent}
              onChange={(e) => setTextContent(e.target.value)}
              placeholder="请粘贴推文文字内容..."
              rows={16}
              className="resize-none text-base leading-relaxed transition-all duration-300 focus:ring-4 focus:ring-red-100 focus:border-red-300 hover:border-red-200"
            />
          </div>
          <Button
            onClick={() => handleAudit('text')}
            disabled={loading || !textContent.trim()}
            className="bg-red-600 hover:bg-red-700 text-white px-8 shadow-lg shadow-red-200/50 hover-lift press-scale disabled:opacity-50 disabled:shadow-none transition-all duration-300 group"
          >
            {loading ? (
              <>
                <span className="inline-block animate-spin mr-2">⏳</span>
                审核中...
              </>
            ) : (
              <>
                <CheckCircle className="w-4 h-4 mr-2 transition-transform duration-300 group-hover:scale-110" />
                开始审核
              </>
            )}
          </Button>
        </div>
      )}

      {/* 秀米链接模式 */}
      {inputMode === 'xiemi' && (
        <div className="space-y-4 max-w-2xl">
          <div className="space-y-2">
            <label className="text-sm font-medium text-stone-700 mb-2 block transition-colors duration-300 hover:text-red-600">秀米预览链接</label>
            <Input
              value={xiemiUrl}
              onChange={(e) => setXiemiUrl(e.target.value)}
              placeholder="https://xiumi.us/..."
              className="text-base transition-all duration-300 focus:ring-4 focus:ring-red-100 focus:border-red-300 hover:border-red-200"
            />
          </div>
          <Button
            onClick={() => handleAudit('xiemi')}
            disabled={loading || !xiemiUrl.trim()}
            className="bg-red-600 hover:bg-red-700 text-white px-8 shadow-lg shadow-red-200/50 hover-lift press-scale disabled:opacity-50 disabled:shadow-none transition-all duration-300 group"
          >
            {loading ? (
              <>
                <span className="inline-block animate-spin mr-2">⏳</span>
                审核中...
              </>
            ) : (
              <>
                <CheckCircle className="w-4 h-4 mr-2 transition-transform duration-300 group-hover:scale-110" />
                开始审核
              </>
            )}
          </Button>
        </div>
      )}

      {/* 截图上传模式 */}
      {inputMode === 'screenshot' && (
        <div className="space-y-4 max-w-2xl">
          <div className="space-y-2">
            <label className="text-sm font-medium text-stone-700 mb-2 block transition-colors duration-300 hover:text-red-600">上传截图</label>
            <Input
              type="file"
              accept="image/*"
              onChange={handleFileChange}
              disabled={screenshots.length >= 10}
              className="transition-all duration-300 focus:ring-4 focus:ring-red-100 focus:border-red-300 disabled:opacity-50"
            />
            <p className="text-sm text-stone-500 mt-2 flex items-center gap-1">
              <span className="animate-pulse">💡</span>
              <span>按 Ctrl+V 粘贴截图（最多 10 张）</span>
            </p>
          </div>

          {/* 图片列表 - 水平滚动 */}
          {screenshots.length > 0 && (
            <div className="space-y-2">
              <p className="text-sm text-stone-600 transition-colors duration-300">已添加 <span className="font-semibold text-red-600">{screenshots.length}</span> 张图片</p>
              <div className="flex gap-3 overflow-x-auto pb-2">
                {screenshots.map((item) => (
                  <div
                    key={item.id}
                    className="relative flex-shrink-0 group"
                  >
                    <img
                      src={item.previewUrl}
                      alt={item.name}
                      className="w-28 h-28 object-cover rounded-lg border border-stone-200 transition-all duration-300 group-hover:scale-105 group-hover:shadow-lg group-hover:border-red-200"
                    />
                    <button
                      onClick={() => handleRemoveScreenshot(item.id)}
                      className="absolute -top-2 -right-2 w-6 h-6 bg-red-500 text-white rounded-full flex items-center justify-center hover:bg-red-600 shadow-sm transition-all duration-300 hover:scale-110 hover:rotate-90"
                    >
                      ×
                    </button>
                    <p className="text-xs text-stone-500 mt-1 text-center max-w-[7rem] truncate transition-colors duration-300 group-hover:text-stone-700">
                      {item.name}
                    </p>
                    <p className="text-xs text-stone-400 text-center transition-colors duration-300 group-hover:text-stone-500">
                      {(item.size / 1024).toFixed(1)} KB
                    </p>
                  </div>
                ))}
              </div>
            </div>
          )}

          <Button
            onClick={handleScreenshotAudit}
            disabled={loading || screenshots.length === 0}
            className="bg-red-600 hover:bg-red-700 text-white px-8 shadow-lg shadow-red-200/50 hover-lift press-scale disabled:opacity-50 disabled:shadow-none transition-all duration-300 group"
          >
            {loading ? (
              <>
                <span className="inline-block animate-spin mr-2">⏳</span>
                审核中...
              </>
            ) : (
              <>
                <CheckCircle className="w-4 h-4 mr-2 transition-transform duration-300 group-hover:scale-110" />
                开始审核
              </>
            )}
          </Button>
        </div>
          )}
        </div>
      </div>

      {/* 错误提示 */}
      {error && (
        <div
          className="mt-6 p-4 bg-red-50 border border-red-200 rounded-lg"
          style={{
            opacity: 1,
            transform: 'translateY(0)',
            animation: 'fade-in-down 0.4s cubic-bezier(0.25, 1, 0.5, 1) forwards',
          }}
        >
          <div className="flex items-center justify-between">
            <div>
              <div className="flex items-center gap-2 text-red-700 font-medium mb-1">
                <AlertCircle className="w-5 h-5" />
                审核失败
              </div>
              <p className="text-sm text-red-600">{error}</p>
            </div>
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                if (lastAuditTypeRef.current === 'screenshot') {
                  handleScreenshotAudit();
                } else if (lastAuditTypeRef.current) {
                  handleAudit(lastAuditTypeRef.current);
                }
              }}
              className="ml-3 text-red-600 border-red-200 hover:bg-red-50 flex-shrink-0"
            >
              重试
            </Button>
          </div>
        </div>
      )}

      {/* 审核结果 - 明显分离 */}
      {issues && (
        <div
          className="pt-6 border-t border-stone-100 mt-8"
          style={{
            opacity: resultVisible ? 1 : 0,
            transform: resultVisible ? 'translateY(0)' : 'translateY(12px)',
            transition: 'opacity 0.5s cubic-bezier(0.25, 1, 0.5, 1), transform 0.5s cubic-bezier(0.25, 1, 0.5, 1)',
          }}
        >
          <div className="mb-4 p-3 bg-stone-50 border border-stone-100 rounded-lg flex items-start gap-2 text-xs text-stone-500">
            <span className="mt-0.5 flex-shrink-0">💡</span>
            <span>AI 审核结果由大模型自动生成，仅供参考，请务必结合实际情况进行人工复核。</span>
          </div>
          <div className={`flex items-center gap-2 mb-5 transition-all duration-300 ${issues.length === 0 ? 'text-green-600' : 'text-red-600'}`}>
            <h2 className="text-lg font-bold text-stone-900 flex items-center gap-2">
              {issues.length === 0 ? (
                <CheckCircle className="w-5 h-5 text-green-600 animate-pulse" />
              ) : (
                <AlertCircle className="w-5 h-5 text-red-600 animate-pulse" />
              )}
              审核结果
            </h2>
            <Badge variant={issues.length === 0 ? 'default' : 'destructive'} className="text-xs">
              {issues.length} 个问题
            </Badge>
          </div>

          {issues.length === 0 ? (
            <div
              className="p-6 bg-green-50 border border-green-200 rounded-lg flex items-center gap-4 hover:shadow-md transition-all duration-300 hover:scale-[1.01]"
              style={{
                opacity: resultVisible ? 1 : 0,
                transform: resultVisible ? 'translateY(0)' : 'translateY(8px)',
                transition: 'opacity 0.45s cubic-bezier(0.25, 1, 0.5, 1) 80ms, transform 0.45s cubic-bezier(0.25, 1, 0.5, 1) 80ms',
              }}
            >
              <CheckCircle className="w-12 h-12 text-green-600 flex-shrink-0 animate-pulse-slow" />
              <div>
                <p className="font-medium text-green-900 transition-colors duration-300 hover:text-green-700">未发现明显问题</p>
                <p className="text-sm text-green-700 transition-colors duration-300 hover:text-green-600">推文内容符合审核标准要求</p>
              </div>
            </div>
          ) : (
            <div className="space-y-3">
              {issues.map((issue, idx) => (
                <div
                  key={idx}
                  className="p-4 border border-stone-200 rounded-lg bg-white hover:shadow-md transition-shadow duration-200"
                  style={{
                    opacity: resultVisible ? 1 : 0,
                    transform: resultVisible ? 'translateY(0)' : 'translateY(8px)',
                    transition: `opacity 0.4s cubic-bezier(0.25, 1, 0.5, 1) ${Math.min(idx * 45, 270)}ms, transform 0.4s cubic-bezier(0.25, 1, 0.5, 1) ${Math.min(idx * 45, 270)}ms`,
                  }}
                >
                  <div className="space-y-2.5">
                    {/* 风险等级标签 */}
                    <Badge
                      className={`${getSeverityColor(issue.severity)} border font-semibold text-xs px-2 py-0.5`}
                    >
                      <span className="mr-1">{SEVERITY_ICONS[issue.severity]}</span>
                      {getSeverityLabel(issue.severity)}
                    </Badge>

                    {/* 问题描述 */}
                    <p className="text-base text-stone-800 leading-relaxed">
                      {issue.message}
                    </p>

                    {/* 修改建议 */}
                    {issue.suggestion && (
                      <p className="text-base text-stone-500 leading-relaxed">
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
      )}
    </div>
  );
}
