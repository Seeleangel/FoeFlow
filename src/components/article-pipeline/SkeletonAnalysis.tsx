export default function SkeletonAnalysis() {
  return (
    <div className="text-center py-10">
      <div className="bg-white rounded-2xl p-6 shadow-sm space-y-4 mb-6">
        <p className="text-xs uppercase tracking-widest text-stone-400 font-medium text-left">
          文章风格分析
        </p>
        <div className="grid grid-cols-2 gap-4">
          {[...Array(4)].map((_, i) => (
            <div key={i} className="flex items-start gap-2.5">
              <div className="w-8 h-8 rounded-lg bg-stone-100 animate-pulse" />
              <div className="space-y-1.5 flex-1">
                <div className="h-3 w-10 bg-stone-100 rounded animate-pulse" />
                <div className="h-4 w-20 bg-stone-200 rounded animate-pulse" />
              </div>
            </div>
          ))}
        </div>
        <div className="flex flex-wrap gap-2">
          {[...Array(4)].map((_, i) => (
            <div key={i} className="h-6 w-16 bg-stone-100 rounded-full animate-pulse" />
          ))}
        </div>
        <div className="h-12 bg-stone-100 rounded animate-pulse" />
      </div>
      <p className="text-sm text-stone-500">正在分析文章风格…</p>
      <div className="flex items-center justify-center gap-1 mt-2">
        <span className="w-1.5 h-1.5 bg-red-400 rounded-full animate-bounce [animation-duration:0.6s]" />
        <span className="w-1.5 h-1.5 bg-red-400 rounded-full animate-bounce [animation-duration:0.6s] [animation-delay:0.1s]" />
        <span className="w-1.5 h-1.5 bg-red-400 rounded-full animate-bounce [animation-duration:0.6s] [animation-delay:0.2s]" />
      </div>
    </div>
  );
}
