/* ── 场景配置 ── */
export function getSceneByHour(hour: number) {
  if (hour >= 5 && hour < 11) {
    return {
      key: 'morning',
      greeting: '新的一天，从一篇好推文开始',
      tint: 'from-amber-50/40 via-transparent to-transparent',
    };
  }
  if (hour >= 11 && hour < 14) {
    return {
      key: 'noon',
      greeting: '午间时光，来完善一下推文内容吧',
      tint: 'from-orange-50/40 via-transparent to-transparent',
    };
  }
  if (hour >= 14 && hour < 18) {
    return {
      key: 'afternoon',
      greeting: '下午好，让创意在指尖流淌',
      tint: 'from-sky-50/30 via-transparent to-transparent',
    };
  }
  if (hour >= 18 && hour < 22) {
    return {
      key: 'evening',
      greeting: '晚上好，今天的推文进度如何？',
      tint: 'from-indigo-50/30 via-transparent to-transparent',
    };
  }
  return {
    key: 'night',
    greeting: '夜深了，注意休息，明天再创作也不迟',
    tint: 'from-slate-100/40 via-transparent to-transparent',
  };
}

/* ── 场景装饰 SVGs ── */

export function MorningDecor({ className }: { className?: string }) {
  return (
    <>
      {/* 窗户光斑 */}
      <svg viewBox="0 0 200 200" className={className} fill="none" aria-hidden="true">
        <path d="M20 20 L180 20 L180 180 L20 180 Z" stroke="#D4C4A8" strokeWidth="1.5" strokeLinecap="round" opacity="0.4" />
        <path d="M20 100 L180 100" stroke="#D4C4A8" strokeWidth="1" opacity="0.25" />
        <path d="M100 20 L100 180" stroke="#D4C4A8" strokeWidth="1" opacity="0.25" />
        <circle cx="60" cy="60" r="18" fill="#FDE68A" opacity="0.15" />
        <circle cx="60" cy="60" r="10" fill="#FDE68A" opacity="0.2" />
      </svg>
      {/* 翻开的课本 */}
      <svg viewBox="0 0 120 80" className={className} fill="none" style={{ transform: 'translate(20px, 40px)' }} aria-hidden="true">
        <path d="M10 70 L60 55 L110 70 L110 15 L60 5 L10 15 Z" fill="#F5F0E8" stroke="#C4B59A" strokeWidth="1" opacity="0.5" />
        <path d="M10 15 L60 5 L60 55 L10 70 Z" fill="#FAF7F1" stroke="#C4B59A" strokeWidth="0.8" opacity="0.4" />
        <path d="M110 15 L60 5 L60 55 L110 70 Z" fill="#FAF7F1" stroke="#C4B59A" strokeWidth="0.8" opacity="0.4" />
        <path d="M20 25 L45 20 M20 35 L45 30 M20 45 L40 42" stroke="#C4B59A" strokeWidth="0.6" opacity="0.3" strokeLinecap="round" />
        <path d="M75 20 L100 25 M75 30 L100 35 M80 42 L100 45" stroke="#C4B59A" strokeWidth="0.6" opacity="0.3" strokeLinecap="round" />
      </svg>
    </>
  );
}

export function NoonDecor({ className }: { className?: string }) {
  return (
    <>
      {/* 咖啡杯 */}
      <svg viewBox="0 0 80 80" className={className} fill="none" aria-hidden="true">
        <path d="M15 30 L15 60 Q15 70 25 70 L45 70 Q55 70 55 60 L55 30 Z" fill="#E8DDD0" stroke="#B8A898" strokeWidth="1" opacity="0.5" />
        <path d="M55 38 Q68 38 68 48 Q68 58 55 58" fill="none" stroke="#B8A898" strokeWidth="1.2" opacity="0.5" strokeLinecap="round" />
        <path d="M25 22 Q28 12 35 12 Q42 12 45 22" fill="none" stroke="#B8A898" strokeWidth="0.8" opacity="0.3" strokeLinecap="round" />
        <ellipse cx="35" cy="30" rx="20" ry="4" fill="#D4C4A8" opacity="0.3" />
      </svg>
      {/* 便签纸 */}
      <svg viewBox="0 0 60 70" className={className} fill="none" style={{ transform: 'translate(30px, -10px) rotate(8deg)' }} aria-hidden="true">
        <rect x="5" y="5" width="50" height="60" rx="2" fill="#FEF3C7" opacity="0.4" stroke="#D4C4A8" strokeWidth="0.8" />
        <path d="M15 20 L45 20 M15 30 L40 30 M15 40 L42 40 M15 50 L35 50" stroke="#B8A898" strokeWidth="0.8" opacity="0.3" strokeLinecap="round" />
      </svg>
    </>
  );
}

export function AfternoonDecor({ className }: { className?: string }) {
  return (
    <>
      {/* 粉笔 */}
      <svg viewBox="0 0 80 40" className={className} fill="none" aria-hidden="true">
        <rect x="10" y="12" width="55" height="14" rx="3" fill="#F5F5F5" stroke="#C4B5A0" strokeWidth="0.8" opacity="0.5" />
        <rect x="60" y="12" width="12" height="14" rx="2" fill="#E8DDD0" stroke="#C4B5A0" strokeWidth="0.8" opacity="0.4" />
        <path d="M72 19 L78 16 L78 22 L72 19 Z" fill="#F5F5F5" opacity="0.5" />
      </svg>
      {/* 黑板擦 */}
      <svg viewBox="0 0 70 50" className={className} fill="none" style={{ transform: 'translate(-10px, 20px)' }} aria-hidden="true">
        <rect x="8" y="15" width="54" height="22" rx="3" fill="#8B7E6A" opacity="0.3" stroke="#A09380" strokeWidth="0.8" />
        <rect x="8" y="28" width="54" height="9" rx="2" fill="#D4C4A8" opacity="0.4" />
        <rect x="20" y="8" width="30" height="8" rx="2" fill="#6B5B4F" opacity="0.3" />
      </svg>
    </>
  );
}

export function EveningDecor({ className }: { className?: string }) {
  return (
    <>
      {/* 台灯 */}
      <svg viewBox="0 0 80 100" className={className} fill="none" aria-hidden="true">
        <path d="M40 35 L25 85 L55 85 Z" fill="#D4C4A8" opacity="0.25" stroke="#A09380" strokeWidth="0.8" />
        <path d="M25 85 L55 85 L58 92 L22 92 Z" fill="#8B7E6A" opacity="0.3" stroke="#A09380" strokeWidth="0.8" />
        <ellipse cx="40" cy="35" rx="22" ry="8" fill="#FEF3C7" opacity="0.2" stroke="#A09380" strokeWidth="0.8" />
        <path d="M40 35 L40 15" stroke="#A09380" strokeWidth="1" opacity="0.4" />
        <path d="M28 15 Q40 8 52 15" fill="none" stroke="#A09380" strokeWidth="0.8" opacity="0.4" strokeLinecap="round" />
      </svg>
      {/* 堆叠的书 */}
      <svg viewBox="0 0 70 70" className={className} fill="none" style={{ transform: 'translate(10px, 10px)' }} aria-hidden="true">
        <rect x="5" y="45" width="60" height="12" rx="1" fill="#D4C4A8" opacity="0.3" stroke="#A09380" strokeWidth="0.8" />
        <rect x="8" y="32" width="56" height="12" rx="1" fill="#C4B59A" opacity="0.25" stroke="#A09380" strokeWidth="0.8" />
        <rect x="12" y="19" width="48" height="12" rx="1" fill="#B8A898" opacity="0.2" stroke="#A09380" strokeWidth="0.8" />
      </svg>
    </>
  );
}

export function NightDecor({ className }: { className?: string }) {
  return (
    <>
      {/* 月光 */}
      <svg viewBox="0 0 100 100" className={className} fill="none" aria-hidden="true">
        <circle cx="65" cy="35" r="18" fill="#E2E8F0" opacity="0.15" />
        <circle cx="65" cy="35" r="12" fill="#E2E8F0" opacity="0.2" />
        <path d="M20 85 Q35 75 50 80 Q65 72 80 78" stroke="#94A3B8" strokeWidth="0.6" opacity="0.15" fill="none" strokeLinecap="round" />
      </svg>
      {/* 走廊尽头的光 */}
      <svg viewBox="0 0 120 80" className={className} fill="none" style={{ transform: 'translate(-20px, 10px)' }} aria-hidden="true">
        <rect x="10" y="10" width="100" height="60" rx="2" fill="none" stroke="#94A3B8" strokeWidth="0.8" opacity="0.15" />
        <rect x="50" y="10" width="20" height="60" fill="#FEF3C7" opacity="0.08" />
        <circle cx="60" cy="40" r="6" fill="#FDE68A" opacity="0.15" />
      </svg>
    </>
  );
}
