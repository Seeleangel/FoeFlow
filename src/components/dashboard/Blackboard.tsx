import ChalkDust from './ChalkDust';

interface EmailTodo {
  id: string;
  subject: string;
  sender: string;
  date: string;
}

/* ── 邮件通知黑板 ── */
export default function Blackboard({ emails, onMarkRead, onViewInbox }: { emails: EmailTodo[]; onMarkRead: (id: string) => void; onViewInbox: () => void }) {
  const hasEmails = emails.length > 0;

  return (
    <div className="relative mx-auto max-w-sm w-full">
      {/* 黑板主体 */}
      <div
        className="relative rounded-xl overflow-hidden"
        style={{
          background: 'linear-gradient(145deg, #5A6E62 0%, #4A5D52 100%)',
          boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.08), 0 4px 16px rgba(0,0,0,0.08), 0 1px 2px rgba(0,0,0,0.06)',
          border: '2px solid #9E9080',
        }}
      >
        {/* 柔和内发光 */}
        <div className="absolute inset-0 rounded-lg pointer-events-none" style={{ boxShadow: 'inset 0 0 24px rgba(0,0,0,0.12)' }} />

        {/* 粉笔灰 */}
        <ChalkDust />

        <div className="relative z-10 px-5 py-4">
          {hasEmails ? (
            <>
              {/* 标题 */}
              <div className="flex items-center gap-2 mb-3">
                <svg viewBox="0 0 20 20" className="w-4 h-4 text-white/60" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" aria-hidden="true">
                  <path d="M2 5l8 5 8-5M2 5v10h16V5" />
                </svg>
                <span className="text-sm text-white/60 font-medium tracking-wide">新邮件</span>
                <span className="ml-auto text-xs text-white/40">{emails.length} 封未读</span>
              </div>

              {/* 邮件列表 */}
              <div className="space-y-2 mb-4">
                {emails.map((email) => (
                  <div key={email.id} className="flex items-start gap-2.5 group">
                    <span className="mt-0.5 w-3.5 h-3.5 rounded-sm border border-white/30 flex-shrink-0 flex items-center justify-center">
                      <span className="w-2 h-2 rounded-sm bg-white/0 group-hover:bg-white/20 transition-colors" />
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="text-sm text-white/75 leading-relaxed truncate">{email.subject || '（无主题）'}</p>
                      <p className="text-xs text-white/40 truncate">{email.sender || '未知发件人'}</p>
                    </div>
                  </div>
                ))}
              </div>

              {/* 快捷按钮 */}
              <div className="flex gap-2">
                {emails.slice(0, 1).map((email) => (
                  <button
                    key={email.id}
                    onClick={() => onMarkRead(email.id)}
                    className="px-3 py-1.5 rounded-md text-xs text-white/70 bg-white/6 hover:bg-white/12 hover:text-white/90 transition-all duration-200 border border-white/8"
                  >
                    标记已读
                  </button>
                ))}
                <button
                  onClick={onViewInbox}
                  className="px-3 py-1.5 rounded-md text-xs text-white/70 bg-white/6 hover:bg-white/12 hover:text-white/90 transition-all duration-200 border border-white/8"
                >
                  查看全部
                </button>
              </div>
            </>
          ) : (
            /* 空状态 */
            <div className="text-center py-5">
              <p className="text-white/70 text-base leading-relaxed font-serif">
                邮箱静悄悄的……
              </p>
              <button
                onClick={onViewInbox}
                className="mt-4 px-4 py-2 rounded-lg text-sm text-white/80 bg-white/6 hover:bg-white/12 hover:text-white/90 transition-all duration-200 border border-white/8"
              >
                打开收件箱
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
