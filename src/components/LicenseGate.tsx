import { useState, useEffect, useCallback, useRef } from 'react';
import { Key, Loader2, QrCode, ArrowLeft } from 'lucide-react';
import { invoke } from '@tauri-apps/api/core';

interface LicenseInfo {
  code: string;
  fingerprint: string;
  token: string;
  expires_at: number;
}

interface ClaimRequestResponse {
  token: string;
  status: string;
  code: string | null;
}

interface ClaimCodeResponse {
  status: string;
  code: string | null;
}

interface LicenseGateProps {
  onActivated: (info: LicenseInfo) => void;
}

type View = 'payment' | 'waiting' | 'input';

export default function LicenseGate({ onActivated }: LicenseGateProps) {
  const [view, setView] = useState<View>('payment');
  const [token, setToken] = useState('');
  const [polling, setPolling] = useState(false);
  const [pollError, setPollError] = useState('');
  const [rawInput, setRawInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const cancelledRef = useRef(false);

  const [tokenLoading, setTokenLoading] = useState(true);

  // Fetch device fingerprint token eagerly so users can note it when paying.
  useEffect(() => {
    let cancelled = false;
    setTokenLoading(true);
    invoke<ClaimRequestResponse>('claim_license_request')
      .then((result) => {
        if (!cancelled) { setToken(result.token); setTokenLoading(false); }
      })
      .catch(() => {
        if (!cancelled) setTokenLoading(false);
      });
    return () => { cancelled = true; };
  }, []);

  const formatCode = useCallback((value: string) => {
    const cleaned = value.toUpperCase().replace(/[^A-HJ-NP-Z2-9]/g, '');
    const chunks = [];
    for (let i = 0; i < cleaned.length; i += 4) {
      chunks.push(cleaned.slice(i, i + 4));
    }
    return chunks.join('-').slice(0, 19);
  }, []);

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setError('');
    setRawInput(formatCode(e.target.value));
  };

  const activateWithCode = async (code: string) => {
    setLoading(true);
    setError('');
    try {
      const info = await invoke<LicenseInfo>('verify_license', { code });
      onActivated(info);
    } catch (err: unknown) {
      setError(typeof err === 'string' ? err : '激活失败，请稍后重试');
    } finally {
      setLoading(false);
    }
  };

  const handleActivate = async () => {
    const code = rawInput.replace(/-/g, '');
    if (code.length !== 16) {
      setError('请输入完整的 16 位校验码');
      return;
    }
    await activateWithCode(rawInput);
  };

  const handleStartPayment = async () => {
    setLoading(true);
    setError('');
    setPollError('');
    try {
      const result = await invoke<ClaimRequestResponse>('claim_license_request');
      if (!token) setToken(result.token);

      if (result.status === 'approved' && result.code) {
        await activateWithCode(result.code);
        return;
      }

      setView('waiting');
      setPolling(true);
    } catch (err: unknown) {
      setError(typeof err === 'string' ? err : '发起支付请求失败，请稍后重试');
    } finally {
      setLoading(false);
    }
  };

  const handleCancelWaiting = () => {
    setPolling(false);
    cancelledRef.current = true;
    setView('payment');
    setPollError('');
  };

  useEffect(() => {
    if (!polling || !token) return;

    let timeoutId: ReturnType<typeof setTimeout>;
    let interval = 3000;
    cancelledRef.current = false;

    const poll = async () => {
      if (cancelledRef.current) return;
      try {
        const result = await invoke<ClaimCodeResponse>('claim_license_code', { token });
        if (cancelledRef.current) return;

        if (result.status === 'approved' && result.code) {
          setPolling(false);
          await activateWithCode(result.code);
          return;
        }

        setPollError('');
        interval = 3000;
        timeoutId = setTimeout(poll, interval);
      } catch (err: unknown) {
        if (cancelledRef.current) return;
        setPollError('连接中断，正在重试…');
        interval = Math.min(interval * 2, 30000);
        timeoutId = setTimeout(poll, interval);
      }
    };

    poll();

    return () => {
      cancelledRef.current = true;
      clearTimeout(timeoutId);
    };
  }, [polling, token]);

  const renderPaymentView = () => (
    <>
      <div className="w-14 h-14 rounded-xl bg-red-50 flex items-center justify-center mb-6">
        <QrCode className="w-7 h-7 text-red-600" />
      </div>
      <h2 className="text-xl font-bold text-stone-900 mb-2">扫码支付获取校验码</h2>
      <div className="flex items-baseline gap-1 mb-6">
        <span className="text-2xl font-semibold text-red-600">¥</span>
        <span className="text-4xl font-semibold text-red-600">79</span>
      </div>

      <div className="w-full bg-stone-50 border border-stone-200 rounded-xl px-4 py-3 mb-4">
        <p className="text-xs text-stone-400 mb-1">支付时请备注此设备标识</p>
        {tokenLoading ? (
          <div className="flex items-center gap-2">
            <Loader2 className="w-3 h-3 text-stone-400 animate-spin" />
            <p className="text-sm text-stone-400">获取中...</p>
          </div>
        ) : token ? (
          <p className="text-sm font-mono text-stone-700 break-all select-all">{token}</p>
        ) : (
          <p className="text-sm text-amber-600">获取失败，请点击下方按钮重试</p>
        )}
      </div>

      <div className="w-full flex flex-col items-center mb-6">
        <div className="w-72 h-72 bg-white border border-stone-200 rounded-xl flex items-center justify-center overflow-hidden mb-3">
          <img src="/payment-placeholder.svg" alt="付款说明占位图" className="w-full h-full object-contain" />
        </div>
        <p className="text-xs text-stone-400">请使用微信扫码支付</p>
      </div>

      {error && (
        <p className="text-sm text-red-600 mb-4">{error}</p>
      )}

      <button
        onClick={handleStartPayment}
        disabled={loading}
        className="w-full px-6 py-3 bg-red-600 hover:bg-red-700 disabled:bg-stone-300 disabled:cursor-not-allowed text-white text-sm font-medium rounded-xl transition-colors flex items-center justify-center gap-2"
      >
        {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
        {loading ? '处理中...' : '我已完成支付'}
      </button>

      <button
        onClick={() => { setView('input'); setError(''); }}
        className="mt-4 text-sm text-stone-400 hover:text-stone-600 transition-colors"
      >
        已有校验码？直接输入
      </button>
    </>
  );

  const renderWaitingView = () => (
    <>
      <div className="w-14 h-14 rounded-xl bg-amber-50 flex items-center justify-center mb-6">
        <Loader2 className="w-7 h-7 text-amber-600 animate-spin" />
      </div>
      <h2 className="text-xl font-bold text-stone-900 mb-2">正在等待管理员审核</h2>
      <p className="text-sm text-stone-500 mb-6">支付完成后，管理员会在后台确认并发放校验码</p>

      <div className="w-full bg-stone-50 border border-stone-200 rounded-xl px-4 py-3 mb-6">
        <p className="text-xs text-stone-400 mb-1">设备标识</p>
        <p className="text-sm font-mono text-stone-700 break-all">{token}</p>
      </div>

      {pollError && (
        <p className="text-sm text-amber-600 mb-4">{pollError}</p>
      )}

      <p className="text-xs text-stone-400 mb-6">应用正在自动检查审核结果，请保持此页面打开</p>

      <button
        onClick={handleCancelWaiting}
        className="w-full px-6 py-3 bg-stone-100 hover:bg-stone-200 text-stone-700 text-sm font-medium rounded-xl transition-colors flex items-center justify-center gap-2"
      >
        <ArrowLeft className="w-4 h-4" />
        取消等待，返回支付界面
      </button>
    </>
  );

  const renderInputView = () => (
    <>
      <div className="w-14 h-14 rounded-xl bg-red-50 flex items-center justify-center mb-6">
        <Key className="w-7 h-7 text-red-600" />
      </div>
      <h2 className="text-xl font-bold text-stone-900 mb-2">请输入校验码</h2>
      <p className="text-sm text-stone-500 mb-8">解锁完整功能，开始使用 FoeFlow</p>

      <div className="w-full mb-4">
        <input
          type="text"
          value={rawInput}
          onChange={handleChange}
          placeholder="XXXX-XXXX-XXXX-XXXX"
          maxLength={19}
          className="w-full px-4 py-3 text-center text-lg font-mono tracking-widest bg-white border border-stone-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-red-500 focus:border-transparent transition-all"
          disabled={loading}
        />
      </div>

      {error && (
        <p className="text-sm text-red-600 mb-4">{error}</p>
      )}

      <button
        onClick={handleActivate}
        disabled={loading || rawInput.replace(/-/g, '').length !== 16}
        className="w-full px-6 py-3 bg-red-600 hover:bg-red-700 disabled:bg-stone-300 disabled:cursor-not-allowed text-white text-sm font-medium rounded-xl transition-colors flex items-center justify-center gap-2"
      >
        {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
        {loading ? '验证中...' : '激活'}
      </button>

      <button
        onClick={() => { setView('payment'); setError(''); }}
        className="mt-4 text-sm text-stone-400 hover:text-stone-600 transition-colors"
      >
        没有校验码？扫码获取
      </button>

      <p className="text-xs text-stone-400 mt-6">
        首次激活需要联网验证，之后可离线使用 30 天
      </p>
    </>
  );

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center" style={{ backgroundColor: 'rgba(28, 25, 23, 0.4)' }}>
      <div className="relative w-full max-w-[480px] mx-4 rounded-2xl shadow-2xl overflow-hidden" style={{ backgroundColor: '#FAF9F6' }}>
        <div className="px-10 py-12 flex flex-col items-center text-center">
          {view === 'payment' && renderPaymentView()}
          {view === 'waiting' && renderWaitingView()}
          {view === 'input' && renderInputView()}
        </div>
      </div>
    </div>
  );
}
