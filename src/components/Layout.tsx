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
    <div className="flex h-screen w-full overflow-hidden" style={{ backgroundColor: '#FAF9F6' }}>
      {/* 侧边导航 */}
      <aside className="w-64 h-screen bg-white border-r border-stone-200 flex flex-col shadow-sm flex-shrink-0">
        {/* 品牌区域 - 固定高度 */}
        <div className="h-16 px-5 border-b border-stone-100 flex items-center gap-3 flex-shrink-0">
          <img
            src="/logo.png"
            alt="未来教育引领者"
            className="w-8 h-8 rounded-lg object-cover shadow-sm"
            draggable={false}
          />
          <div className="min-w-0">
            <div className="text-sm font-semibold text-stone-900 leading-none truncate">未来教育引领者</div>
            <div className="text-xs text-stone-500 mt-1 truncate">公众号管理工具</div>
          </div>
        </div>

        {/* 导航菜单 - 可滚动 */}
        <nav className="flex-1 p-3 space-y-1 overflow-y-auto">
          {NAV_ITEMS.map((item) => {
            const Icon = item.icon;
            const isActive = current === item.id;
            return (
              <button
                key={item.id}
                onClick={() => onNavigate(item.id)}
                className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-left transition-all duration-200 group ${
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
                {isActive && <div className="ml-auto w-1.5 h-1.5 rounded-full bg-red-600 flex-shrink-0" />}
              </button>
            );
          })}
        </nav>

        {/* 底部信息 - 固定 */}
        <div className="p-4 border-t border-stone-100 flex-shrink-0">
          <div className="text-xs text-stone-400 text-center">
            华东师范大学教育学部
          </div>
        </div>
      </aside>

      {/* 主内容区 */}
      <main className="flex-1 overflow-auto h-full scrollbar-hide">
        <div className="h-full">
          {children}
        </div>
      </main>
    </div>
  );
}
