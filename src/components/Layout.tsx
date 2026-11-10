import { isWebApp, publicAsset } from '@/lib/platform';
import { FileCheck, PenTool, Library, Settings, Home, Mail } from 'lucide-react';

interface LayoutProps {
  current: 'dashboard' | 'audit' | 'generator' | 'library' | 'settings' | 'inbox';
  onNavigate: (page: LayoutProps['current']) => void;
  children: React.ReactNode;
}

const NAV_ITEMS = [
  { id: 'dashboard', label: '仪表盘', icon: Home },
  { id: 'inbox', label: '邮件箱', icon: Mail },
  { id: 'audit', label: '审核台', icon: FileCheck },
  { id: 'generator', label: '生成器', icon: PenTool },

  { id: 'library', label: '工作台', icon: Library },
  { id: 'settings', label: '设置', icon: Settings },
] as const;

export default function Layout({ current, onNavigate, children }: LayoutProps) {
  return (
    <div className={`flex h-screen w-full overflow-hidden ${isWebApp ? 'h-dvh flex-col sm:flex-row foe-web' : ''}`} style={{ backgroundColor: '#FAF9F6' }}>
      {/* 侧边导航 */}
      <aside className={`bg-white border-stone-200 flex flex-col shadow-sm flex-shrink-0 ${isWebApp ? 'w-full border-b sm:w-56 sm:h-full sm:border-r' : 'w-64 h-screen border-r'}`}>
        {/* 品牌区域 - 固定高度 */}
        <div className="h-16 px-5 border-b border-stone-100 flex items-center gap-3 flex-shrink-0">
          <img
            src={publicAsset('logo.png')}
            alt="未来教育引领者"
            className="w-8 h-8 rounded-lg object-cover shadow-sm"
            draggable={false}
          />
          <div className="min-w-0">
            <div className="text-sm font-semibold text-stone-900 leading-none truncate">{isWebApp ? 'FoeFlow' : '未来教育引领者'}</div>
            <div className="text-xs text-stone-500 mt-1 truncate">{isWebApp ? '网页版 · 内容工作台' : '公众号管理工具'}</div>
          </div>
        </div>

        {/* 导航菜单 - 可滚动 */}
        <nav aria-label="工作区导航" className={isWebApp ? "grid grid-cols-6 gap-1 p-2 sm:block sm:flex-1 sm:p-3 sm:space-y-1 sm:overflow-y-auto" : "flex-1 p-3 space-y-1 overflow-y-auto"}>
          {NAV_ITEMS.map((item) => {
            const Icon = item.icon;
            const isActive = current === item.id;
            return (
              <button
                key={item.id}
                aria-current={isActive ? 'page' : undefined}
                onClick={() => onNavigate(item.id)}
                className={`w-full flex items-center py-2.5 rounded-lg text-left ${isWebApp ? 'flex-col justify-center gap-1 px-1 text-xs sm:flex-row sm:justify-start sm:gap-3 sm:px-3 sm:text-sm' : 'gap-3 px-3'} transition-all duration-200 group ${
                  isActive
                    ? 'bg-red-50 text-red-700 font-medium shadow-sm'
                    : 'text-stone-600 hover:bg-stone-50 hover:text-stone-900'
                }`}
              >
                <Icon
                  className={`w-4 h-4 transition-colors flex-shrink-0 ${
                    isActive ? 'text-red-600' : 'text-stone-400 group-hover:text-stone-600'
                  }`}
                />
                <span className="truncate">{item.label}</span>
                {isActive && !isWebApp && <div className="ml-auto w-1.5 h-1.5 rounded-full bg-red-600 flex-shrink-0" />}
              </button>
            );
          })}
        </nav>

        {/* 底部信息 - 固定 */}
        <div className={`p-4 border-t border-stone-100 flex-shrink-0 ${isWebApp ? 'hidden sm:block' : ''}`}>
          <div className="text-xs text-stone-400 text-center">
            {isWebApp ? '稿件保存在此浏览器' : '华东师范大学教育学部'}
          </div>
        </div>
      </aside>

      {/* 主内容区 */}
      <main className="flex-1 min-w-0 min-h-0 overflow-auto h-full scrollbar-hide">
        <div className="h-full">
          {children}
        </div>
      </main>
    </div>
  );
}
