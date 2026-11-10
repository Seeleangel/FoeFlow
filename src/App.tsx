import { useState, useEffect, Component, type ReactNode } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { isWebApp } from '@/lib/platform';
import { initDb } from '@/hooks/useDb';
import { seedSampleArticles } from '@/lib/seedSampleArticles';
import { loadSettings, saveSettings } from '@/lib/settingsStorage'
import { prefetchSuggestions } from '@/lib/dateSuggestions'
import type { AppSettings } from '@/types'
import Layout from '@/components/Layout';
import Dashboard from '@/pages/Dashboard';
import Settings from '@/pages/Settings';
import AuditStation from '@/pages/AuditStation';
import Library from '@/pages/Library';
import Generator from '@/pages/Generator';
import Inbox from '@/pages/Inbox';
import WebInbox from '@/pages/WebInbox';
import WebAccountGate, { type WebAccount } from '@/components/WebAccountGate';

import WelcomeModal from '@/components/WelcomeModal'
import LicenseGate from '@/components/LicenseGate';
import Toaster from '@/components/ui/toaster';

class ErrorBoundary extends Component<{ children: ReactNode }, { hasError: boolean; error: string }> {
  constructor(props: { children: ReactNode }) {
    super(props);
    this.state = { hasError: false, error: '' };
  }
  static getDerivedStateFromError(error: Error) {
    return { hasError: true, error: error.message + '\n' + (error.stack || '') };
  }
  render() {
    if (this.state.hasError) {
      return (
        <div className="p-6 text-red-700 bg-red-50 h-full overflow-auto">
          <h2 className="text-lg font-bold mb-2">页面渲染出错</h2>
          <pre className="text-xs whitespace-pre-wrap">{this.state.error}</pre>
        </div>
      );
    }
    return this.props.children;
  }
}

type ActivationStatus = { active: boolean; code?: string; fingerprint?: string; token?: string; expires_at?: number };

function Workspace({ account }: { account?: WebAccount }) {
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [page, setPage] = useState<Parameters<typeof Layout>[0]['current']>(() => isWebApp && window.location.hash === '#mail' ? 'inbox' : 'dashboard');
  const [showWelcome, setShowWelcome] = useState(false)
  const [settings, setSettings] = useState<AppSettings | null>(null)

  const [licenseActive, setLicenseActive] = useState<boolean | null>(null);

  // Page transition state
  const [displayPage, setDisplayPage] = useState(page);
  const [pageFading, setPageFading] = useState(false);
  const navigateTo = (newPage: Parameters<typeof Layout>[0]['current']) => {
    if (newPage === displayPage || pageFading) return;
    setPage(newPage);
    if (isWebApp && (newPage === 'inbox' || window.location.hash === '#mail')) {
      window.history.replaceState(window.history.state, '', window.location.pathname + window.location.search + (newPage === 'inbox' ? '#mail' : ''));
    }
    setPageFading(true);
    setTimeout(() => {
      setDisplayPage(newPage);
      setPageFading(false);
    }, 150);
  };

  useEffect(() => {
    let loadedSettings: AppSettings;
    initDb()
      .then(() => isWebApp ? undefined : seedSampleArticles())
      .then(() => loadSettings())
      .then((s): Promise<ActivationStatus> => {
        loadedSettings = s;
        setSettings(s);
        setShowWelcome(!isWebApp && !s.hasSeenWelcome);
        if (isWebApp) return Promise.resolve({ active: true });
        // Check license activation
        return invoke<ActivationStatus>('check_activation');
      })
      .then((status) => {
        setLicenseActive(status.active);
        if (status.active && status.code) {
          const updated = {
            ...loadedSettings,
            licenseCode: status.code,
            licenseFingerprint: status.fingerprint,
            licenseToken: status.token,
            licenseExpiresAt: status.expires_at,
          };
          saveSettings(updated);
          setSettings(updated);
        }
        setReady(true);
        if (!isWebApp) prefetchSuggestions();
      })
      .catch((err) => {
        console.error('Failed to initialize app:', err);
        setError(String(err));
      });
  }, []);

  const handleWelcomeClose = async (navigateTo?: 'settings') => {
    if (settings) {
      const updated = { ...settings, hasSeenWelcome: true }
      await saveSettings(updated)
      setSettings(updated)
    }
    setShowWelcome(false)
    if (navigateTo) { setPage(navigateTo); setDisplayPage(navigateTo); }
  }

  if (error) {
    return (
      <div className="p-4 text-red-600">
        <h2 className="text-lg font-bold mb-2">初始化失败</h2>
        <p className="text-sm">{error}</p>
      </div>
    );
  }

  if (!ready) return <div className="p-4">初始化中...</div>;

  if (licenseActive === false) {
    return (
      <LicenseGate
        onActivated={(info) => {
          setLicenseActive(true);
          if (settings) {
            const updated = {
              ...settings,
              licenseCode: info.code,
              licenseFingerprint: info.fingerprint,
              licenseToken: info.token,
              licenseExpiresAt: info.expires_at,
            };
            saveSettings(updated);
            setSettings(updated);
          }
        }}
      />
    );
  }

  return (
    <>
      <Layout current={page} onNavigate={navigateTo} account={account}>
        <ErrorBoundary>
          <div className="h-full" style={{
            opacity: pageFading ? 0 : 1,
            transition: 'opacity 0.15s ease-out',
          }}>
            {displayPage === 'dashboard' && <Dashboard onNavigate={(p) => navigateTo(p)} />}
            {displayPage === 'settings' && <Settings onOpenMailbox={isWebApp ? () => navigateTo('inbox') : undefined} />}
            {displayPage === 'audit' && <AuditStation />}
            {displayPage === 'library' && (
              <Library
                onNavigate={(p) => navigateTo(p as Parameters<typeof Layout>[0]['current'])}
              />
            )}
            {displayPage === 'generator' && <Generator />}
            {displayPage === 'inbox' && (isWebApp ? <WebInbox /> : <Inbox />)}
          </div>
        </ErrorBoundary>
      </Layout>
      {showWelcome && settings && (
        <WelcomeModal onClose={handleWelcomeClose} />
      )}
      <Toaster />
    </>
  );
}

export default function App() {
  return isWebApp ? <WebAccountGate>{(account) => <Workspace account={account} />}</WebAccountGate> : <Workspace />;
}
