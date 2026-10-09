import { useEffect, useState, useCallback, useRef } from 'react';
import { Mail, RefreshCw, Check, Trash2, InboxIcon, AlertCircle, Info, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { getAllEmails, saveEmails, markEmailAsRead, getMaxUid, clearAllEmails, deduplicateEmails } from '@/lib/emailStorage';
import { fetchImapEmails } from '@/lib/imapClient';
import { loadSettings } from '@/lib/settingsStorage';
import type { EmailMessage } from '@/types';

const STAGGER_MS = 40;
const MAX_STAGGER_MS = 300;

function usePrevious<T>(value: T): T | undefined {
  const ref = useRef<T>(undefined);
  useEffect(() => { ref.current = value; }, [value]);
  return ref.current;
}

export default function Inbox() {
  const [emails, setEmails] = useState<EmailMessage[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [errorVisible, setErrorVisible] = useState(false);
  const [lastSync, setLastSync] = useState<string | null>(null);
  const [itemsVisible, setItemsVisible] = useState(false);
  const [countPulse, setCountPulse] = useState(false);
  const [syncComplete, setSyncComplete] = useState(false);
  const [newEmailCount, setNewEmailCount] = useState(0);
  const unreadCount = emails.filter((e) => !e.isRead).length;
  const prevUnreadCount = usePrevious(unreadCount);
  const handleDismissError = () => {
    setErrorVisible(false);
    setTimeout(() => setError(null), 350);
  };

  const loadLocalEmails = useCallback(async () => {
    try {
      const cleaned = await deduplicateEmails();
      if (cleaned > 0) {
        console.log('[Inbox] Deduplicated emails, kept', cleaned, 'unique records');
      }
      const all = await getAllEmails();
      setEmails(all);
    } catch (err) {
      console.error('[Inbox] Failed to load local emails:', err);
    }
  }, []);

  useEffect(() => {
    loadLocalEmails();
  }, [loadLocalEmails]);

  // Staggered item entrance when emails load
  useEffect(() => {
    if (emails.length > 0) {
      const timer = setTimeout(() => setItemsVisible(true), 50);
      return () => clearTimeout(timer);
    } else {
      setItemsVisible(false);
    }
  }, [emails.length]);

  // Error banner visibility
  useEffect(() => {
    if (error) {
      setErrorVisible(true);
    } else {
      setErrorVisible(false);
    }
  }, [error]);

  // Pulse unread count when it changes
  useEffect(() => {
    if (prevUnreadCount !== undefined && prevUnreadCount !== unreadCount) {
      setCountPulse(true);
      const timer = setTimeout(() => setCountPulse(false), 400);
      return () => clearTimeout(timer);
    }
  }, [unreadCount, prevUnreadCount]);

  const handleSync = async () => {
    setLoading(true);
    setError(null);
    setNewEmailCount(0);
    setSyncComplete(false);
    try {
      const settings = await loadSettings();
      if (!settings.imapEmail || !settings.imapAuthCode) {
        setError('请在设置页配置 163 邮箱地址和 IMAP 授权码');
        setLoading(false);
        return;
      }

      const lastUid = await getMaxUid();
      console.log('[Inbox] Syncing emails, lastUid=', lastUid);

      const newEmails = await fetchImapEmails(
        {
          email: settings.imapEmail,
          authCode: settings.imapAuthCode,
          server: 'imap.163.com',
          port: 993,
        },
        lastUid
      );

      console.log('[Inbox] Fetched', newEmails.length, 'emails from server');

      if (newEmails.length > 0) {
        await saveEmails(newEmails);
      }

      await loadLocalEmails();
      setLastSync(new Date().toLocaleTimeString('zh-CN'));
      setNewEmailCount(newEmails.length);
      setSyncComplete(true);
      setTimeout(() => setSyncComplete(false), 3000);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error('[Inbox] Sync failed:', msg);
      setError(`同步失败: ${msg}`);
    } finally {
      setLoading(false);
    }
  };

  const handleMarkRead = async (id: string) => {
    await markEmailAsRead(id);
    loadLocalEmails();
  };

  const handleClearAll = async () => {
    if (!confirm('确定清空所有邮件记录吗？此操作不可恢复。')) return;
    await clearAllEmails();
    loadLocalEmails();
  };

  return (
    <div className="p-8 pb-12 max-w-5xl h-full overflow-auto">
      {/* 页面标题 */}
      <div className="mb-6 flex items-start justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold text-stone-800 tracking-tight flex items-center gap-2">
            <Mail className="w-5 h-5 text-amber-600" strokeWidth={2} />
            邮件收件箱
          </h1>
          <p className="text-sm text-stone-500 mt-1.5 leading-relaxed">
            {emails.length > 0 ? (
              <span className="inline-flex items-center gap-1">
                共 {emails.length} 封邮件，其中
                <span
                  className="inline-flex items-center justify-center min-w-[1.25rem] px-1 h-5 text-xs font-semibold text-amber-700 bg-amber-100 rounded-md transition-transform duration-200"
                  style={{
                    transform: countPulse ? 'scale(1.25)' : 'scale(1)',
                    transitionTimingFunction: 'cubic-bezier(0.25, 1, 0.5, 1)',
                  }}
                >
                  {unreadCount}
                </span>
                封未读
              </span>
            ) : (
              '连接 163 邮箱同步邮件'
            )}
          </p>
          <p className="inline-flex items-center gap-1.5 text-xs text-stone-500 bg-stone-50 border border-stone-100 px-2.5 py-1 rounded-full mt-2">
            <Info className="w-3 h-3 text-stone-400" />
            邮件正文请查看公邮
          </p>
        </div>
        <div className="flex items-center gap-3 flex-shrink-0">
          {lastSync && (
            <span className="text-xs text-stone-400">上次同步: {lastSync}</span>
          )}
          <Button
            onClick={handleSync}
            disabled={loading}
            className="bg-red-600 hover:bg-red-700 text-white text-sm hover:scale-[1.02] hover:shadow-md active:scale-[0.98] transition-all duration-200"
          >
            <RefreshCw className={`w-4 h-4 mr-2 ${loading ? 'animate-spin' : ''}`} />
            {loading ? '同步中...' : '立即同步'}
          </Button>
        </div>
      </div>

      {/* 错误提示 */}
      {error && (
        <div
          className="mb-5 p-4 bg-red-50 border border-red-200 rounded-xl flex items-start gap-3 overflow-hidden"
          style={{
            opacity: errorVisible ? 1 : 0,
            transform: errorVisible ? 'translateY(0)' : 'translateY(-8px)',
            maxHeight: errorVisible ? 200 : 0,
            paddingTop: errorVisible ? undefined : 0,
            paddingBottom: errorVisible ? undefined : 0,
            marginBottom: errorVisible ? undefined : 0,
            transition: 'opacity 0.35s cubic-bezier(0.25, 1, 0.5, 1), transform 0.35s cubic-bezier(0.25, 1, 0.5, 1), max-height 0.35s cubic-bezier(0.25, 1, 0.5, 1), padding 0.35s cubic-bezier(0.25, 1, 0.5, 1), margin 0.35s cubic-bezier(0.25, 1, 0.5, 1)',
          }}
        >
          <AlertCircle className="w-5 h-5 text-red-600 flex-shrink-0 mt-0.5" />
          <div className="flex-1 min-w-0">
            <p className="text-sm text-red-700 font-medium">同步出错</p>
            <p className="text-sm text-red-600 mt-1 leading-relaxed">{error}</p>
          </div>
          <button
            onClick={handleDismissError}
            className="p-1 rounded-md text-red-400 hover:text-red-600 hover:bg-red-100 transition-colors duration-150 flex-shrink-0"
            title="关闭"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      {/* 同步中的动态文本 */}
      {loading && (
        <div className="mb-4">
          <p className="text-sm text-stone-500 flex items-center gap-2">
            <RefreshCw className="w-3.5 h-3.5 animate-spin" />
            正在同步…
          </p>
        </div>
      )}

      {/* 同步完成提示 */}
      {syncComplete && !loading && (
        <div className="mb-4">
          <p className="text-sm text-green-600 flex items-center gap-1.5">
            <Check className="w-3.5 h-3.5" />
            {newEmailCount > 0
              ? `同步完成，获取 ${newEmailCount} 封新邮件`
              : '同步完成，暂无新邮件'}
          </p>
        </div>
      )}

      {/* 邮件列表 */}
      {emails.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-24 text-stone-400">
          <InboxIcon
            className="w-14 h-14 mb-5 opacity-25"
            strokeWidth={1.5}
            style={{
              animation: 'gentle-float 4s ease-in-out infinite',
            }}
          />
          <p className="text-base font-medium text-stone-500 mb-2">邮箱静悄悄的……</p>
          <p className="text-sm text-stone-400 mb-8 leading-relaxed">点击「立即同步」从 163 邮箱拉取邮件</p>
          <Button
            onClick={handleSync}
            disabled={loading}
            variant="outline"
            className="border-stone-300 text-stone-600 hover:scale-[1.02] active:scale-[0.98] transition-all duration-200"
          >
            <RefreshCw className={`w-4 h-4 mr-2 ${loading ? 'animate-spin' : ''}`} />
            {loading ? '同步中...' : '立即同步'}
          </Button>
        </div>
      ) : (
        <div className="space-y-1.5">
          {emails.map((email, index) => (
            <div
              key={email.id}
              className={`bg-white border rounded-xl py-3.5 px-5 flex items-start justify-between gap-4 transition-all duration-300 ease-out group ${
                email.isRead
                  ? 'border-stone-100 hover:border-stone-200 hover:bg-stone-50/60'
                  : 'border-stone-200 shadow-sm hover:border-amber-200 hover:bg-amber-50/30'
              }`}
              style={{
                opacity: itemsVisible ? 1 : 0,
                transform: itemsVisible ? 'translateY(0)' : 'translateY(6px)',
                transition: `opacity 0.4s cubic-bezier(0.25, 1, 0.5, 1) ${Math.min(index * STAGGER_MS, MAX_STAGGER_MS)}ms, transform 0.4s cubic-bezier(0.25, 1, 0.5, 1) ${Math.min(index * STAGGER_MS, MAX_STAGGER_MS)}ms, border-color 0.3s ease-out, background-color 0.3s ease-out, box-shadow 0.3s ease-out`,
              }}
            >
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2 mb-1.5">
                  <span
                    className={`w-1.5 h-1.5 rounded-full bg-amber-500 flex-shrink-0 transition-all duration-300 ${
                      email.isRead ? 'opacity-0 scale-0' : 'opacity-100 scale-100'
                    }`}
                  />
                  <h3
                    className={`text-sm truncate leading-snug transition-colors duration-300 ${
                      email.isRead
                        ? 'text-stone-400 font-normal'
                        : 'text-stone-800 font-semibold'
                    }`}
                  >
                    {email.subject || '（无主题）'}
                  </h3>
                </div>
                <div className="flex items-center gap-2.5 text-xs text-stone-400 leading-relaxed">
                  <span className="truncate">{email.sender || '未知发件人'}</span>
                  <span className="text-stone-300 flex-shrink-0">·</span>
                  <span className="flex-shrink-0">{email.date || ''}</span>
                </div>
              </div>
              {!email.isRead && (
                <button
                  onClick={() => handleMarkRead(email.id)}
                  className="mt-0.5 p-1.5 rounded-md text-stone-400 hover:text-green-600 hover:bg-green-50 hover:scale-110 active:scale-90 transition-all duration-150 flex-shrink-0"
                  title="标记已读"
                >
                  <Check className="w-4 h-4" strokeWidth={2} />
                </button>
              )}
            </div>
          ))}

          {/* 清空按钮 */}
          <div
            className="pt-5 flex justify-center"
            style={{
              opacity: itemsVisible ? 1 : 0,
              transition: `opacity 0.4s cubic-bezier(0.25, 1, 0.5, 1) ${Math.min(emails.length * STAGGER_MS, MAX_STAGGER_MS)}ms`,
            }}
          >
            <button
              onClick={handleClearAll}
              className="flex items-center gap-1.5 text-xs text-stone-400 hover:text-red-600 hover:scale-105 active:scale-95 transition-all duration-150"
            >
              <Trash2 className="w-3.5 h-3.5" />
              清空所有邮件记录
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
