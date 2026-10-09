import { useState, useEffect } from 'react';
import { CheckCircle, AlertCircle, Info } from 'lucide-react';

type ToastType = 'success' | 'error' | 'info' | 'warning';

interface Toast {
  id: string;
  message: string;
  type: ToastType;
}

export function showToast(message: string, type: ToastType = 'info') {
  document.dispatchEvent(
    new CustomEvent('app-toast', { detail: { message, type } })
  );
}

export default function Toaster() {
  const [toasts, setToasts] = useState<Toast[]>([]);

  useEffect(() => {
    const handler = (e: Event) => {
      const { message, type } = (e as CustomEvent<{ message: string; type: ToastType }>).detail;
      const id = Math.random().toString(36).slice(2, 9);
      setToasts((prev) => [...prev, { id, message, type }]);
      setTimeout(() => {
        setToasts((prev) => prev.filter((t) => t.id !== id));
      }, 2800);
    };
    document.addEventListener('app-toast', handler);
    return () => document.removeEventListener('app-toast', handler);
  }, []);

  if (toasts.length === 0) return null;

  const iconMap: Record<ToastType, React.ReactNode> = {
    success: <CheckCircle className="w-4 h-4 text-green-600" />,
    error: <AlertCircle className="w-4 h-4 text-red-600" />,
    info: <Info className="w-4 h-4 text-stone-500" />,
    warning: <AlertCircle className="w-4 h-4 text-amber-500" />,
  };

  const bgMap: Record<ToastType, string> = {
    success: 'bg-white border-green-200 shadow-green-100/50',
    error: 'bg-white border-red-200 shadow-red-100/50',
    info: 'bg-white border-stone-200 shadow-stone-100/50',
    warning: 'bg-white border-amber-200 shadow-amber-100/50',
  };

  return (
    <div className="fixed top-5 left-1/2 -translate-x-1/2 z-[100] flex flex-col items-center gap-2 pointer-events-none">
      {toasts.map((t) => (
        <div
          key={t.id}
          className={`pointer-events-auto flex items-center gap-2.5 px-4 py-2.5 rounded-xl border shadow-lg backdrop-blur-sm ${bgMap[t.type]}`}
        >
          {iconMap[t.type]}
          <span className="text-sm font-medium text-stone-700">{t.message}</span>
        </div>
      ))}
    </div>
  );
}
