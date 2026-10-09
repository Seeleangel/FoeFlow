/* ── 粉笔灰粒子 ── */
export default function ChalkDust() {
  const particles = Array.from({ length: 12 }, (_, i) => ({
    id: i,
    left: `${10 + Math.random() * 80}%`,
    delay: `${Math.random() * 4}s`,
    duration: `${3 + Math.random() * 4}s`,
    size: `${1 + Math.random() * 2}px`,
  }));

  return (
    <div className="absolute inset-0 pointer-events-none overflow-hidden">
      {particles.map((p) => (
        <span
          key={p.id}
          className="absolute rounded-full bg-white/20 animate-chalk-fall"
          style={{
            left: p.left,
            width: p.size,
            height: p.size,
            animationDelay: p.delay,
            animationDuration: p.duration,
            top: '-4px',
          }}
        />
      ))}
    </div>
  );
}
