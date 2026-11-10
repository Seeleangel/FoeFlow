let workspace: string | undefined;

export function activateWebWorkspace(id: string) {
  if (!/^[a-f0-9]{32}$/.test(id) || (workspace && workspace !== id)) {
    throw new Error('浏览器工作区无效，请重新登录。');
  }
  workspace = id;
}

export function currentWebWorkspace() {
  return workspace;
}

export const SESSION_CHANGE_KEY = 'foeflow-session-change';

export function reloadForSessionChange() {
  try { localStorage.setItem(SESSION_CHANGE_KEY, crypto.randomUUID()); } catch { /* This tab still reloads. */ }
  window.location.reload();
}
