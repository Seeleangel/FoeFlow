import { useEffect, useState, type FormEvent, type ReactNode } from 'react';
import { Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { publicAsset } from '@/lib/platform';
import { mailRequest, type MailSession } from '@/lib/webMail';
import { activateWebWorkspace, reloadForSessionChange, SESSION_CHANGE_KEY } from '@/lib/webWorkspace';

export type WebAccount = { username: string; signOut: () => Promise<void> };

export default function WebAccountGate({ children }: { children: (account: WebAccount) => ReactNode }) {
  const [session, setSession] = useState<MailSession>();
  const [mode, setMode] = useState<'login' | 'register'>('login');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    const controller = new AbortController();
    const handleSessionChange = (event: StorageEvent) => {
      if (event.key === SESSION_CHANGE_KEY) window.location.reload();
    };
    window.addEventListener('storage', handleSessionChange);
    mailRequest<MailSession>('session', { signal: controller.signal }).then((current) => {
      if (controller.signal.aborted) return;
      if (current.username && current.workspaceId) activateWebWorkspace(current.workspaceId);
      setSession(current);
    }).catch(() => {
      if (!controller.signal.aborted) setError('暂时无法检查登录状态，请重试。');
    });
    return () => {
      controller.abort();
      window.removeEventListener('storage', handleSessionChange);
    };
  }, []);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    const fields = new FormData(event.currentTarget);
    setBusy(true);
    setError('');
    try {
      await mailRequest(mode, { method: 'POST', body: {
        username: String(fields.get('username')),
        password: String(fields.get('password')),
      } });
      reloadForSessionChange();
    } catch (err) {
      setError(err instanceof Error ? err.message : '暂时无法登录，请重试。');
      setBusy(false);
    }
  }

  async function signOut() {
    await mailRequest('logout', { method: 'POST' });
    reloadForSessionChange();
  }

  if (session?.username && session.workspaceId) return children({ username: session.username, signOut });

  const signup = mode === 'register';
  return (
    <main className="min-h-dvh bg-[#FAF9F6] px-5 py-12 sm:py-20">
      <div className="mx-auto max-w-sm">
        <div className="mb-8 flex items-center gap-3">
          <img src={publicAsset('logo.png')} alt="" className="size-10 rounded-lg" />
          <div><p className="font-semibold text-stone-900">FoeFlow</p><p className="text-sm text-stone-600">公众号内容工作台</p></div>
        </div>
        <section className="rounded-xl border border-stone-200 bg-white p-6 sm:p-7">
          <h1 className="text-2xl font-semibold tracking-tight text-stone-900">{signup ? '创建 FoeFlow 账号' : '登录 FoeFlow'}</h1>
          <p className="mt-2 text-sm leading-relaxed text-stone-600">{signup ? '设置用户名和密码，即可使用网页版。' : '使用 FoeFlow 账号进入工作台。原邮件箱账号也可以直接登录。'}</p>
          {error && <p role="alert" className="mt-4 rounded-md bg-red-50 p-3 text-sm text-red-800">{error}</p>}
          {session === undefined ? (
            error ? <Button className="mt-4" variant="outline" onClick={() => window.location.reload()}>重试</Button> : <p role="status" className="mt-4 text-sm text-stone-600">正在检查登录状态…</p>
          ) : (
            <form key={mode} className="mt-6 space-y-4" onSubmit={submit}>
              <div className="space-y-2">
                <Label htmlFor="workspace-username">用户名</Label>
                <Input id="workspace-username" name="username" autoComplete="username" autoCapitalize="none" required minLength={3} maxLength={32} />
                {signup && <p className="text-xs text-stone-600">3–32 位字母、数字、下划线或连字符。</p>}
              </div>
              <div className="space-y-2">
                <Label htmlFor="workspace-password">密码</Label>
                <Input id="workspace-password" name="password" type="password" autoComplete={signup ? 'new-password' : 'current-password'} required minLength={12} maxLength={128} />
                {signup && <p className="text-xs text-stone-600">至少 12 位。</p>}
              </div>
              <Button type="submit" disabled={busy} className="w-full bg-red-700 text-white hover:bg-red-800">
                {busy && <Loader2 className="size-4 animate-spin" />}{signup ? '注册' : '登录'}
              </Button>
              <Button type="button" variant="ghost" disabled={busy} className="w-full" onClick={() => { setMode(signup ? 'login' : 'register'); setError(''); }}>
                {signup ? '已有账号，返回登录' : '创建账号'}
              </Button>
            </form>
          )}
        </section>
      </div>
    </main>
  );
}
