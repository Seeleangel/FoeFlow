/* ── 底部图标 SVGs ── */

export function MagnifierIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 48 48" className={className} fill="none" aria-hidden="true">
      <circle cx="20" cy="20" r="12" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" />
      <path d="M29 29 L40 40" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" />
      <rect x="8" y="34" width="32" height="4" rx="2" fill="currentColor" opacity="0.15" />
    </svg>
  );
}

export function QuillIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 48 48" className={className} fill="none" aria-hidden="true">
      <path d="M36 8 Q28 16 24 26 Q22 32 20 38 L22 40 Q28 34 32 28 Q38 18 40 10 Q38 12 36 8 Z" fill="currentColor" opacity="0.7" />
      <path d="M20 38 L16 42 L22 40 Z" fill="currentColor" opacity="0.9" />
      <ellipse cx="18" cy="42" rx="8" ry="3" fill="currentColor" opacity="0.15" />
    </svg>
  );
}

export function FolderIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 48 48" className={className} fill="none" aria-hidden="true">
      <path d="M6 14 L6 38 Q6 42 10 42 L38 42 Q42 42 42 38 L42 16 Q42 14 40 14 L24 14 L20 10 L10 10 Q6 10 6 14 Z" fill="currentColor" opacity="0.15" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" />
      <path d="M6 18 L42 18" stroke="currentColor" strokeWidth="1" opacity="0.3" />
    </svg>
  );
}
