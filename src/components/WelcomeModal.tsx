import { useState, useCallback, useEffect } from 'react'
import { FileCheck, PenTool, Mail, Library, Settings, ArrowRight, ArrowLeft, Info } from 'lucide-react'

interface WelcomeModalProps {
  onClose: (navigateTo?: 'settings') => void
}

const STEPS = 4

export default function WelcomeModal({ onClose }: WelcomeModalProps) {
  const [step, setStep] = useState(1)

  const goNext = useCallback(() => {
    if (step < STEPS) setStep((s) => s + 1)
  }, [step])

  const goPrev = useCallback(() => {
    if (step > 1) setStep((s) => s - 1)
  }, [step])

  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'ArrowRight' || e.key === 'Enter') {
        if (step < STEPS) goNext()
      }
      if (e.key === 'ArrowLeft') {
        if (step > 1) goPrev()
      }
      if (e.key === 'Escape') {
        if (step === STEPS) onClose(undefined)
      }
    }
    window.addEventListener('keydown', handleKey)
    return () => window.removeEventListener('keydown', handleKey)
  }, [step, goNext, goPrev, onClose])

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center animate-fade-in" style={{ backgroundColor: 'rgba(28, 25, 23, 0.2)' }} role="dialog" aria-modal="true" aria-labelledby="welcome-title">
      <div className="relative w-full max-w-[720px] mx-4 rounded-2xl shadow-2xl overflow-hidden animate-scale-in" style={{ backgroundColor: '#FAF9F6' }}>
        <div className="px-10 py-12 min-h-[420px] flex flex-col">
          <div className="flex-1" key={step}>
            <div className="h-full">
              {step === 1 && <Step1Welcome />}
              {step === 2 && <Step2Features />}
              {step === 3 && <Step3Auxiliary />}
              {step === 4 && <Step4Config />}
            </div>
          </div>

          <div className="mt-8 flex items-center justify-between">
            <div className="flex items-center gap-2">
              {Array.from({ length: STEPS }, (_, i) => (
                <div
                  key={i}
                  className={`h-2 rounded-full transition-all duration-300 ${
                    i + 1 === step
                      ? 'w-6 bg-red-600'
                      : i + 1 < step
                        ? 'w-2 bg-red-300'
                        : 'w-2 bg-stone-200'
                  }`}
                />
              ))}
            </div>

            <div className="flex items-center gap-3">
              {step > 1 && step < STEPS && (
                <button
                  onClick={goPrev}
                  className="px-4 py-2 text-sm text-stone-500 hover:text-stone-800 transition-colors flex items-center gap-1 hover-lift press-scale"
                >
                  <ArrowLeft className="w-4 h-4" />
                  上一步
                </button>
              )}

              {step < STEPS && (
                <button
                  onClick={goNext}
                  className="px-6 py-2.5 bg-red-600 hover:bg-red-700 text-white text-sm font-medium rounded-lg transition-colors flex items-center gap-2 hover-lift press-scale"
                >
                  下一步
                  <ArrowRight className="w-4 h-4" />
                </button>
              )}

              {step === STEPS && (
                <>
                  <button
                    onClick={() => onClose()}
                    className="px-4 py-2.5 text-sm text-stone-500 hover:text-stone-800 border border-stone-200 rounded-lg transition-colors hover-lift press-scale"
                  >
                    稍后再说
                  </button>
                  <button
                    onClick={() => onClose('settings')}
                    className="px-6 py-2.5 bg-red-600 hover:bg-red-700 text-white text-sm font-medium rounded-lg transition-colors flex items-center gap-2 hover-lift press-scale"
                  >
                    <Settings className="w-4 h-4" />
                    前往设置页面配置
                  </button>
                </>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

function Step1Welcome() {
  return (
    <div className="text-center flex flex-col items-center justify-center h-full">
      <img src="/logo.png" alt="FoeFlow" className="w-16 h-16 rounded-xl object-cover shadow-sm mb-6 animate-fade-in-up" style={{ animationDelay: '0ms' }} />
      <h1 id="welcome-title" className="text-3xl font-bold text-stone-900 tracking-tight mb-2 animate-fade-in-up" style={{ animationDelay: '80ms' }}>FoeFlow</h1>
      <p className="text-base text-stone-500 mb-2 animate-fade-in-up" style={{ animationDelay: '140ms' }}>公众号推文创作与审核助手</p>
      <p className="text-sm text-stone-400 animate-fade-in-up" style={{ animationDelay: '200ms' }}>感谢你使用本工具，让我们带你快速了解</p>
    </div>
  )
}

function Step2Features() {
  return (
    <div className="h-full flex flex-col justify-center">
      <h2 className="text-xl font-bold text-stone-900 text-center mb-8 animate-fade-in-up" style={{ animationDelay: '0ms' }}>核心功能</h2>
      <div className="grid grid-cols-1 lg:grid-cols-5 gap-5">
        <div className="lg:col-span-3 bg-white border border-stone-200 rounded-xl p-6 hover:shadow-lg transition-shadow hover-lift animate-fade-in-up" style={{ animationDelay: '100ms' }}>
          <div className="flex items-center gap-3 mb-3">
            <div className="w-10 h-10 rounded-lg bg-red-50 flex items-center justify-center">
              <FileCheck className="w-5 h-5 text-red-600" />
            </div>
            <h3 className="text-lg font-semibold text-stone-900">审核台</h3>
          </div>
          <p className="text-sm text-stone-600 leading-relaxed mb-4">
            粘贴秀米链接、上传截图或输入文字，一键检查推文中的文字错误、合规风险等问题。
          </p>
          <div className="flex flex-wrap gap-2">
            {['秀米链接', '截图上传', '纯文本'].map((tag) => (
              <span key={tag} className="px-2.5 py-1 bg-stone-100 text-stone-500 text-xs rounded-full">{tag}</span>
            ))}
          </div>
        </div>
        <div className="lg:col-span-2 bg-white border border-stone-200 rounded-xl p-6 hover:shadow-lg transition-shadow hover-lift animate-fade-in-up" style={{ animationDelay: '200ms' }}>
          <div className="flex items-center gap-3 mb-3">
            <div className="w-10 h-10 rounded-lg bg-amber-50 flex items-center justify-center">
              <PenTool className="w-5 h-5 text-amber-600" />
            </div>
            <h3 className="text-lg font-semibold text-stone-900">生成器</h3>
          </div>
          <p className="text-sm text-stone-600 leading-relaxed mb-4">
            选择风格模板，快速生成或对话共创推文内容，输出可直接用于秀米的排版格式。
          </p>
          <div className="flex flex-wrap gap-2">
            {['快速生成', '对话共创', 'Word 导出'].map((tag) => (
              <span key={tag} className="px-2.5 py-1 bg-stone-100 text-stone-500 text-xs rounded-full">{tag}</span>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}

function Step3Auxiliary() {
  const features = [
    { icon: Mail, title: '邮件箱', desc: '连接 163 公邮，自动同步未读邮件，在仪表盘黑板随时查看。', color: 'text-amber-600', bg: 'bg-amber-50' },

    { icon: Library, title: '工作台', desc: '管理文章库和历史会话，回顾过往创作与审核记录。', color: 'text-blue-600', bg: 'bg-blue-50' },
  ]

  return (
    <div className="h-full flex flex-col justify-center">
      <h2 className="text-xl font-bold text-stone-900 text-center mb-8 animate-fade-in-up" style={{ animationDelay: '0ms' }}>更多功能</h2>
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        {features.map(({ icon: Icon, title, desc, color, bg }, index) => (
          <div key={title} className="bg-white border border-stone-200 rounded-xl p-5 text-center hover:shadow-md transition-shadow hover-lift animate-fade-in-up" style={{ animationDelay: `${80 + index * 80}ms` }}>
            <div className={`w-10 h-10 rounded-lg ${bg} flex items-center justify-center mx-auto mb-3`}>
              <Icon className={`w-5 h-5 ${color}`} />
            </div>
            <h3 className="text-sm font-semibold text-stone-900 mb-1">{title}</h3>
            <p className="text-xs text-stone-500 leading-relaxed">{desc}</p>
          </div>
        ))}
      </div>
    </div>
  )
}

function Step4Config() {
  return (
    <div className="h-full flex flex-col justify-center">
      <h2 className="text-xl font-bold text-stone-900 text-center mb-6 animate-fade-in-up" style={{ animationDelay: '0ms' }}>使用前准备</h2>

      <div className="bg-blue-50 border border-blue-100 rounded-xl p-5 mb-6 animate-fade-in-up" style={{ animationDelay: '100ms' }}>
        <div className="flex items-start gap-3">
          <Info className="w-5 h-5 text-blue-600 flex-shrink-0 mt-0.5" />
          <div>
            <p className="text-sm text-blue-800 font-medium mb-1">使用审核和生成功能前，需要配置校内大模型 API 参数。</p>
            <p className="text-xs text-blue-600">你稍后可以前往设置页面修改这些参数。</p>
          </div>
        </div>
      </div>

      <div className="bg-white border border-stone-200 rounded-xl p-5 space-y-3 animate-fade-in-up" style={{ animationDelay: '200ms' }}>
        <div className="flex justify-between text-sm">
          <span className="text-stone-500">API 地址</span>
          <span className="text-stone-700 font-mono text-xs">https://chat.ecnu.edu.cn/open/api/v1/chat/completions</span>
        </div>
        <div className="flex justify-between text-sm">
          <span className="text-stone-500">模型名称</span>
          <span className="text-stone-700 font-mono text-xs">ecnu-max</span>
        </div>
        <div className="flex justify-between text-sm">
          <span className="text-stone-500">API Key</span>
          <span className="text-stone-700 font-mono text-xs">sk-...</span>
        </div>
      </div>
    </div>
  )
}
