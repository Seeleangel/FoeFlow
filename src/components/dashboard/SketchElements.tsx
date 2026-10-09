/* ── 手绘基础装饰（保留）── */
export function SketchStar({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 120 120" className={className} fill="none" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M60 8 L68 45 L108 45 L76 68 L88 108 L60 84 L32 108 L44 68 L12 45 L52 45 Z" />
      <path d="M60 20 L64 48 L96 48 L70 66 L80 96 L60 78 L40 96 L50 66 L24 48 L56 48 Z" opacity="0.4" />
    </svg>
  );
}

export function SketchEllipse({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 200 100" className={className} fill="none" stroke="currentColor" strokeWidth="1" strokeLinecap="round" aria-hidden="true">
      <path d="M20 50 Q20 8 100 8 Q180 8 180 50 Q180 92 100 92 Q20 92 20 50" />
      <path d="M35 50 Q35 20 100 20 Q165 20 165 50 Q165 80 100 80 Q35 80 35 50" opacity="0.35" />
    </svg>
  );
}

export function SketchWiggle({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 120 40" className={className} fill="none" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" aria-hidden="true">
      <path d="M4 20 Q16 4 28 20 T52 20 T76 20 T100 20 T116 20" />
    </svg>
  );
}

export function SketchDots({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 60 60" className={className} fill="currentColor" aria-hidden="true">
      <circle cx="8" cy="8" r="2.5" opacity="0.5" />
      <circle cx="28" cy="14" r="1.8" opacity="0.3" />
      <circle cx="48" cy="6" r="2" opacity="0.45" />
      <circle cx="18" cy="34" r="2.2" opacity="0.4" />
      <circle cx="42" cy="38" r="1.5" opacity="0.25" />
      <circle cx="10" cy="52" r="1.8" opacity="0.35" />
      <circle cx="52" cy="54" r="2" opacity="0.3" />
    </svg>
  );
}
