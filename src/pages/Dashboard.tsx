import { useEffect, useState, useCallback } from 'react';
import { getUnreadEmails, saveEmails, getMaxUid, markEmailAsRead, deduplicateEmails } from '@/lib/emailStorage';
import { fetchImapEmails } from '@/lib/imapClient';
import { loadSettings } from '@/lib/settingsStorage';
import { useTypewriter } from '@/hooks/useTypewriter';
import { getSceneByHour } from '@/components/dashboard/SceneDecor';
import { SketchStar, SketchEllipse, SketchWiggle, SketchDots } from '@/components/dashboard/SketchElements';
import { MagnifierIcon, QuillIcon, FolderIcon } from '@/components/dashboard/NavIcons';
import Blackboard from '@/components/dashboard/Blackboard';

interface DashboardProps {
  onNavigate: (page: 'audit' | 'generator' | 'library' | 'settings' | 'inbox') => void;
}

/* ── 邮件通知项 ── */
interface EmailTodo {
  id: string;
  subject: string;
  sender: string;
  date: string;
}

/* ── 主页面 ── */
export default function Dashboard({ onNavigate }: DashboardProps) {
  const [mounted, setMounted] = useState(false);
  const [emails, setEmails] = useState<EmailTodo[]>([]);
  const [loading, setLoading] = useState(true);

  const hour = new Date().getHours();
  const scene = getSceneByHour(hour);

  const dateStr = new Date().toLocaleDateString('zh-CN', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    weekday: 'long',
  });

  const typedGreeting = useTypewriter(scene.greeting, { speedMs: 75 });

  /* 加载用户数据生成待办 */
  useEffect(() => {
    const t = setTimeout(() => setMounted(true), 80);
    return () => clearTimeout(t);
  }, []);

  const loadEmails = useCallback(async () => {
    try {
      await deduplicateEmails();
      const unread = await getUnreadEmails();
      setEmails(
        unread.map((e) => ({
          id: e.id,
          subject: e.subject,
          sender: e.sender,
          date: e.date,
        }))
      );
    } catch {
      setEmails([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadEmails();
  }, [loadEmails]);

  const handleMarkRead = useCallback(async (id: string) => {
    await markEmailAsRead(id);
    loadEmails();
  }, [loadEmails]);

  /* 轮询邮箱 */
  useEffect(() => {
    let intervalId: ReturnType<typeof setInterval> | null = null;

    async function pollEmails() {
      try {
        const settings = await loadSettings();
        if (!settings.imapEmail || !settings.imapAuthCode) return;

        const lastUid = await getMaxUid();
        const newEmails = await fetchImapEmails(
          {
            email: settings.imapEmail,
            authCode: settings.imapAuthCode,
            server: 'imap.163.com',
            port: 993,
          },
          lastUid
        );

        if (newEmails.length > 0) {
          await saveEmails(newEmails);
          loadEmails();
        }
      } catch (err) {
        console.error('[Dashboard] Email poll failed:', err);
      }
    }

    // Initial poll
    pollEmails();

    // Setup interval
    loadSettings().then((settings) => {
      const minutes = Math.max(1, settings.imapPollInterval ?? 5);
      if (settings.imapEmail && settings.imapAuthCode) {
        intervalId = setInterval(pollEmails, minutes * 60 * 1000);
      }
    });

    return () => {
      if (intervalId) clearInterval(intervalId);
    };
  }, [loadEmails]);

  return (
    <div className="h-full flex flex-col items-center justify-center relative overflow-hidden select-none" style={{ backgroundColor: '#FAF9F6' }}>
      {/* 场景色调叠加 */}
      <div className={`absolute inset-0 bg-gradient-to-b ${scene.tint} pointer-events-none`} />

      {/* ── 背景手绘装饰 ── */}
      <div
        className={`absolute top-[12%] left-[8%] text-stone-300 transition-all duration-[1200ms] ease-out ${
          mounted ? 'opacity-100 translate-y-0' : 'opacity-0 -translate-y-4'
        }`}
        style={{ transitionDelay: '300ms', animation: mounted ? 'float 7s ease-in-out infinite' : 'none', animationDelay: '0s' }}
      >
        <SketchStar className="w-16 h-16 lg:w-20 lg:h-20 rotate-[-8deg]" />
      </div>

      <div
        className={`absolute top-[18%] right-[10%] text-stone-300 transition-all duration-[1200ms] ease-out ${
          mounted ? 'opacity-100 translate-y-0' : 'opacity-0 -translate-y-4'
        }`}
        style={{ transitionDelay: '450ms', animation: mounted ? 'float-reverse 6s ease-in-out infinite' : 'none', animationDelay: '1s' }}
      >
        <SketchDots className="w-14 h-14" />
      </div>

      <div
        className={`absolute bottom-[22%] left-[12%] text-stone-300 transition-all duration-[1200ms] ease-out ${
          mounted ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-4'
        }`}
        style={{ transitionDelay: '500ms', animation: mounted ? 'float 8s ease-in-out infinite' : 'none', animationDelay: '2s' }}
      >
        <SketchEllipse className="w-28 h-14 lg:w-36 lg:h-18 rotate-[6deg]" />
      </div>

      <div
        className={`absolute bottom-[16%] right-[14%] text-stone-300 transition-all duration-[1200ms] ease-out ${
          mounted ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-4'
        }`}
        style={{ transitionDelay: '600ms', animation: mounted ? 'float-reverse 5.5s ease-in-out infinite' : 'none', animationDelay: '0.5s' }}
      >
        <SketchWiggle className="w-20 h-7 lg:w-28 lg:h-10 rotate-[3deg]" />
      </div>

      <div
        className={`absolute top-[40%] right-[6%] text-stone-200 transition-all duration-[1200ms] ease-out ${
          mounted ? 'opacity-100' : 'opacity-0'
        }`}
        style={{ transitionDelay: '700ms', animation: mounted ? 'float 9s ease-in-out infinite' : 'none', animationDelay: '3s' }}
      >
        <svg viewBox="0 0 80 80" className="w-10 h-10 lg:w-12 lg:h-12" fill="none" stroke="currentColor" strokeWidth="1" strokeLinecap="round" aria-hidden="true">
          <path d="M40 8 L44 32 L68 32 L48 48 L56 72 L40 56 L24 72 L32 48 L12 32 L36 32 Z" />
        </svg>
      </div>

      {/* ── 中央内容 ── */}
      <div className="relative z-10 text-center max-w-xl px-6 w-full">
        {/* 日期 */}
        <p
          className={`text-xs text-stone-400 tracking-[0.2em] uppercase mb-6 transition-all duration-700 ${
            mounted ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-3'
          }`}
        >
          {dateStr}
        </p>

        {/* 主标题 */}
        <h1
          className={`text-4xl sm:text-5xl lg:text-[3.5rem] font-light text-stone-800 tracking-tight leading-[1.15] mb-4 transition-all duration-700 ease-out font-serif ${
            mounted ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-5'
          }`}
          style={{ transitionDelay: '120ms' }}
        >
          未来教育
          <span className="font-medium"> 引领者</span>
        </h1>

        {/* 分隔装饰 */}
        <div
          className={`flex items-center justify-center gap-3 mb-4 transition-all duration-700 ${
            mounted ? 'opacity-100' : 'opacity-0'
          }`}
          style={{ transitionDelay: '240ms' }}
        >
          <span className="w-8 h-px bg-stone-300" />
          <svg viewBox="0 0 16 16" className="w-3 h-3 text-stone-400" fill="currentColor" style={{ animation: mounted ? 'breathe 3s ease-in-out infinite' : 'none' }} aria-hidden="true">
            <circle cx="8" cy="8" r="2" />
          </svg>
          <span className="w-8 h-px bg-stone-300" />
        </div>

        {/* 副标题 */}
        <p
          className={`text-sm sm:text-base text-stone-500 font-light leading-relaxed mb-2 transition-all duration-700 ${
            mounted ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-4'
          }`}
          style={{ transitionDelay: '360ms' }}
        >
          公众号推文创作与审核助手
        </p>

        {/* 时间提示语（打字机效果） */}
        <p
          className={`text-sm text-stone-400 font-light h-6 mb-6 transition-all duration-700 ${
            mounted ? 'opacity-100' : 'opacity-0'
          }`}
          style={{ transitionDelay: '480ms' }}
        >
          {typedGreeting}
          <span className="inline-block w-0.5 h-4 bg-stone-400/60 ml-0.5 animate-blink align-middle" />
        </p>

        {/* ── 黑板待办 ── */}
        <div
          className={`transition-all duration-700 ${
            mounted ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-4'
          }`}
          style={{ transitionDelay: '600ms' }}
        >
          {!loading && <Blackboard emails={emails} onMarkRead={handleMarkRead} onViewInbox={() => onNavigate('inbox')} />}
        </div>
      </div>

      {/* ── 底部快捷入口（教室物品） ── */}
      <div
        className={`absolute bottom-10 flex gap-8 transition-all duration-700 ${
          mounted ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-3'
        }`}
        style={{ transitionDelay: '700ms' }}
      >
        {[
          { label: '审核', page: 'audit' as const, Icon: MagnifierIcon },
          { label: '生成', page: 'generator' as const, Icon: QuillIcon },
          { label: '工作台', page: 'library' as const, Icon: FolderIcon },
        ].map((item) => (
          <button
            key={item.page}
            onClick={() => onNavigate(item.page)}
            className="group flex flex-col items-center gap-2 text-stone-400 hover:text-red-500 transition-colors duration-300"
          >
            <div className="relative w-12 h-12 flex items-center justify-center">
              <item.Icon className="w-10 h-10 transition-transform duration-300 group-hover:scale-110" />
              {/* 悬停时放大镜晃动 / 羽毛笔蘸墨效果 */}
              {item.page === 'audit' && (
                <span className="absolute inset-0 opacity-0 group-hover:opacity-100 transition-opacity duration-300">
                  <svg viewBox="0 0 48 48" className="w-10 h-10 text-red-400 animate-wiggle" fill="none" aria-hidden="true">
                    <circle cx="20" cy="20" r="12" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" />
                    <path d="M29 29 L40 40" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" />
                  </svg>
                </span>
              )}
            </div>
            <span className="text-xs tracking-wider opacity-0 group-hover:opacity-100 transition-opacity duration-300">
              {item.label}
            </span>
          </button>
        ))}
      </div>
    </div>
  );
}
