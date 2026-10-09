import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Skeleton } from '@/components/ui/skeleton';
import { Key, Save, Palette, BookOpen, Info, Sparkles, Shield, Library, Mail, RefreshCw, LogOut, ExternalLink, ChevronDown, ChevronRight } from 'lucide-react';
import { loadSettings, saveSettings } from '@/lib/settingsStorage';
import { invoke } from '@tauri-apps/api/core';
import { showToast } from '@/components/ui/toaster';
import type { AppSettings } from '@/types';

function validateSettings(settings: AppSettings): string[] {
  const errors: string[] = [];

  // API URL validation
  if (settings.apiUrl && settings.apiUrl.trim()) {
    try {
      new URL(settings.apiUrl.trim());
    } catch {
      errors.push('API 地址格式不正确，请输入有效的 URL（如 https://api.example.com）');
    }
  }

  // Model name validation — must not be empty
  if (!settings.modelName || !settings.modelName.trim()) {
    errors.push('模型名称不能为空');
  }

  // Email validation
  if (settings.imapEmail && settings.imapEmail.trim()) {
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(settings.imapEmail.trim())) {
      errors.push('邮箱地址格式不正确');
    }
  }

  // Brand color HEX validation
  if (settings.brandColor && settings.brandColor.trim()) {
    const hexRegex = /^#([0-9A-Fa-f]{3}|[0-9A-Fa-f]{6})$/;
    if (!hexRegex.test(settings.brandColor.trim())) {
      errors.push('品牌色格式不正确，请输入有效的 HEX 颜色值（如 #8B1A1A）');
    }
  }

  return errors;
}

function ApiKeyGuide() {
  const [open, setOpen] = useState(false);

  return (
    <div className="text-xs text-stone-500">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className="flex items-center gap-1 text-stone-500 hover:text-stone-700 transition-colors"
      >
        {open ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}
        如何获取 API Key？
      </button>
      {open && (
        <div className="mt-2 ml-4 space-y-2 p-3 bg-stone-50 border border-stone-100 rounded-md leading-relaxed">
          <ol className="list-decimal list-inside space-y-1.5">
            <li>
              访问校内大模型平台{' '}
              <a
                href="https://chat.ecnu.edu.cn"
                target="_blank"
                rel="noopener noreferrer"
                className="text-blue-600 hover:text-blue-800 underline inline-flex items-center gap-0.5"
              >
                chat.ecnu.edu.cn <ExternalLink className="w-3 h-3" />
              </a>
            </li>
            <li>登录后，点击左下角头像旁的齿轮，选择「我的令牌」</li>
            <li>创建新的 API Key 并复制</li>
            <li>将复制的 Key 粘贴到上方输入框中，不要忘了点击此页面最下方的「保存设置」</li>
          </ol>
          <p className="text-stone-400 mt-2">
            API Key 仅在本地存储，不会上传到任何第三方服务器。
          </p>
        </div>
      )}
    </div>
  );
}

export default function Settings() {
  const [settings, setSettings] = useState<AppSettings | null>(null);
  const [loading, setLoading] = useState(true);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    loadSettings()
      .then(setSettings)
      .finally(() => setLoading(false));
  }, []);

  const handleSave = async () => {
    if (!settings) return;
    const validationErrors = validateSettings(settings);
    if (validationErrors.length > 0) {
      validationErrors.forEach((err) => showToast(err, 'error'));
      return;
    }
    await saveSettings(settings);
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  };

  if (loading || !settings) {
    return (
      <div className="p-8 pb-12 max-w-4xl">
        <Skeleton className="h-8 w-48 mb-4" />
        <Skeleton className="h-4 w-72 mb-8" />
        <div className="space-y-4">
          <Skeleton className="h-32 w-full rounded-lg" />
          <Skeleton className="h-32 w-full rounded-lg" />
          <Skeleton className="h-24 w-full rounded-lg" />
        </div>
      </div>
    );
  }

  return (
    <div className="p-8 pb-12 max-w-4xl">
      {/* 页面标题 */}
      <div className="mb-8">
        <h1 className="text-2xl font-bold text-stone-900 tracking-tight">设置</h1>
        <p className="text-sm text-stone-500 mt-1">配置 API 参数和应用偏好</p>
      </div>

      {/* API 配置 */}
      <div className="mb-8">
        <div className="flex items-center gap-3 mb-4">
          <div className="w-10 h-10 rounded-lg bg-blue-50 flex items-center justify-center">
            <Key className="w-5 h-5 text-blue-600" />
          </div>
          <div>
            <h2 className="text-lg font-semibold text-stone-900">校内 API 配置</h2>
            <p className="text-sm text-stone-500">配置学校大模型 API 访问参数</p>
          </div>
        </div>
        <div className="space-y-4 p-6 bg-white border border-stone-200 rounded-lg">
          <div className="space-y-2">
            <Label htmlFor="api-url">API 地址</Label>
            <Input
              id="api-url"
              value={settings.apiUrl}
              onChange={(e) => setSettings({ ...settings, apiUrl: e.target.value })}
              placeholder="https://api.school.edu/v1/chat/completions"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="api-key">API Key</Label>
            <Input
              id="api-key"
              type="password"
              value={settings.apiKey}
              onChange={(e) => setSettings({ ...settings, apiKey: e.target.value })}
              placeholder="sk-..."
            />
            <ApiKeyGuide />
          </div>
          <div className="space-y-2">
            <Label htmlFor="model-name">模型名称</Label>
            <Input
              id="model-name"
              value={settings.modelName}
              onChange={(e) => setSettings({ ...settings, modelName: e.target.value })}
              placeholder="qwen-max"
            />
          </div>
        </div>
      </div>

      {/* 许可证信息 */}
      {settings.licenseCode && (
        <div className="mb-8">
          <div className="flex items-center gap-3 mb-4">
            <div className="w-10 h-10 rounded-lg bg-green-50 flex items-center justify-center">
              <Shield className="w-5 h-5 text-green-600" />
            </div>
            <div>
              <h2 className="text-lg font-semibold text-stone-900">许可证信息</h2>
              <p className="text-sm text-stone-500">已激活，可离线使用</p>
            </div>
          </div>
          <div className="space-y-4 p-6 bg-white border border-stone-200 rounded-lg">
            <div className="flex justify-between text-sm">
              <span className="text-stone-500">校验码</span>
              <span className="text-stone-700 font-mono">
                {settings.licenseCode.slice(0, 4)}-****-****-{settings.licenseCode.slice(-4)}
              </span>
            </div>
            {settings.licenseExpiresAt && (
              <div className="flex justify-between text-sm">
                <span className="text-stone-500">有效期至</span>
                <span className="text-stone-700">
                  {new Date(settings.licenseExpiresAt * 1000).toLocaleDateString()}
                </span>
              </div>
            )}
            <div className="flex gap-3 pt-2">
              <button
                onClick={async () => {
                  try {
                    const status = await invoke<{
                      active: boolean;
                      code?: string;
                      fingerprint?: string;
                      token?: string;
                      expires_at?: number;
                    }>('check_activation');
                    if (status.active && status.code) {
                      const s = {
                        ...settings,
                        licenseCode: status.code,
                        licenseFingerprint: status.fingerprint,
                        licenseToken: status.token,
                        licenseExpiresAt: status.expires_at,
                      };
                      await saveSettings(s);
                      setSettings(s);
                    }
                    alert('激活状态已刷新');
                  } catch {
                    alert('刷新失败');
                  }
                }}
                className="px-4 py-2 text-sm text-stone-600 hover:text-stone-900 border border-stone-200 rounded-lg transition-colors flex items-center gap-1.5"
              >
                <RefreshCw className="w-4 h-4" />
                刷新状态
              </button>
              <button
                onClick={async () => {
                  if (!confirm('确定要退出激活吗？需要重新输入校验码。')) return;
                  await invoke('clear_license');
                  const s = { ...settings, licenseCode: undefined, licenseFingerprint: undefined, licenseToken: undefined, licenseExpiresAt: undefined };
                  await saveSettings(s);
                  setSettings(s);
                  window.location.reload();
                }}
                className="px-4 py-2 text-sm text-red-600 hover:text-red-700 border border-red-200 rounded-lg transition-colors flex items-center gap-1.5"
              >
                <LogOut className="w-4 h-4" />
                退出激活
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 邮箱配置 */}
      <div className="mb-8">
        <div className="flex items-center gap-3 mb-4">
          <div className="w-10 h-10 rounded-lg bg-amber-50 flex items-center justify-center">
            <Mail className="w-5 h-5 text-amber-600" />
          </div>
          <div>
            <h2 className="text-lg font-semibold text-stone-900">163 邮箱配置</h2>
            <p className="text-sm text-stone-500">连接邮箱自动获取未读邮件到待办</p>
          </div>
        </div>
        <div className="space-y-4 p-6 bg-white border border-stone-200 rounded-lg">
          <div className="space-y-2">
            <Label htmlFor="imap-email">邮箱地址</Label>
            <Input
              id="imap-email"
              value={settings.imapEmail ?? ''}
              onChange={(e) => setSettings({ ...settings, imapEmail: e.target.value })}
              placeholder="example@163.com"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="imap-auth-code">IMAP 授权码</Label>
            <Input
              id="imap-auth-code"
              type="password"
              value={settings.imapAuthCode ?? ''}
              onChange={(e) => setSettings({ ...settings, imapAuthCode: e.target.value })}
              placeholder="在 163 邮箱设置中生成的授权码"
            />
            <p className="text-xs text-stone-400">
              不是登录密码。请前往 163 邮箱 → 设置 → IMAP/SMTP → 开启服务并获取授权码
            </p>
          </div>
          <div className="space-y-2">
            <Label htmlFor="imap-interval">轮询间隔（分钟）</Label>
            <Input
              id="imap-interval"
              type="number"
              min={1}
              max={60}
              value={settings.imapPollInterval ?? 5}
              onChange={(e) => {
                const val = parseInt(e.target.value, 10);
                setSettings({ ...settings, imapPollInterval: Number.isNaN(val) ? 5 : val });
              }}
              placeholder="5"
            />
          </div>
        </div>
      </div>

      {/* 品牌色设置 */}
      <div className="mb-8">
        <div className="flex items-center gap-3 mb-4">
          <div className="w-10 h-10 rounded-lg bg-purple-50 flex items-center justify-center">
            <Palette className="w-5 h-5 text-purple-600" />
          </div>
          <div>
            <h2 className="text-lg font-semibold text-stone-900">品牌色</h2>
            <p className="text-sm text-stone-500">自定义应用主题色（默认华师大红）</p>
          </div>
        </div>
        <div className="p-6 bg-white border border-stone-200 rounded-lg">
          <div className="flex items-center gap-4">
            <div
              className="w-12 h-12 rounded-lg border border-stone-200 flex-shrink-0"
              style={{ backgroundColor: settings.brandColor }}
            />
            <div className="flex-1 space-y-2">
              <Label htmlFor="brand-color">颜色值（HEX）</Label>
              <Input
                id="brand-color"
                value={settings.brandColor}
                onChange={(e) => setSettings({ ...settings, brandColor: e.target.value })}
                placeholder="#8B1A1A"
              />
            </div>
          </div>
        </div>
      </div>

      {/* 使用指南 */}
      <div className="mb-8">
        <div className="flex items-center gap-3 mb-4">
          <div className="w-10 h-10 rounded-lg bg-green-50 flex items-center justify-center">
            <BookOpen className="w-5 h-5 text-green-600" />
          </div>
          <div>
            <h2 className="text-lg font-semibold text-stone-900">使用指南</h2>
            <p className="text-sm text-stone-500">各功能模块的简要说明</p>
          </div>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div className="p-5 bg-white border border-stone-200 rounded-lg">
            <div className="flex items-center gap-2 mb-3">
              <Sparkles className="w-4 h-4 text-blue-600" />
              <h3 className="font-semibold text-stone-800 text-sm">文章生成器</h3>
            </div>
            <p className="text-sm text-stone-600 leading-relaxed">
              与 AI 对话共创推文内容。左侧为对话区，右侧实时显示排版预览。对话完成后点击「智能排版」即可生成可直接复制到秀米的 HTML 代码。
            </p>
          </div>
          <div className="p-5 bg-white border border-stone-200 rounded-lg">
            <div className="flex items-center gap-2 mb-3">
              <Shield className="w-4 h-4 text-red-600" />
              <h3 className="font-semibold text-stone-800 text-sm">智能审核</h3>
            </div>
            <p className="text-sm text-stone-600 leading-relaxed">
              支持输入文字、粘贴秀米链接或上传截图三种方式。AI 会自动检查错别字、语法错误、敏感词、逻辑矛盾等常见问题。
            </p>
          </div>
          <div className="p-5 bg-white border border-stone-200 rounded-lg">
            <div className="flex items-center gap-2 mb-3">
              <Library className="w-4 h-4 text-amber-600" />
              <h3 className="font-semibold text-stone-800 text-sm">工作台</h3>
            </div>
            <p className="text-sm text-stone-600 leading-relaxed">
              管理公众号文章素材。支持添加文章、搜索查找、展开查看详情。「智能体提示词」标签页可自定义各步骤 AI 的系统提示词。
            </p>
          </div>
        </div>
      </div>

      {/* 关于 */}
      <div className="mb-8">
        <div className="flex items-center gap-3 mb-4">
          <div className="w-10 h-10 rounded-lg bg-stone-50 flex items-center justify-center">
            <Info className="w-5 h-5 text-stone-600" />
          </div>
          <div>
            <h2 className="text-lg font-semibold text-stone-900">关于</h2>
            <p className="text-sm text-stone-500">应用信息</p>
          </div>
        </div>
        <div className="p-6 bg-white border border-stone-200 rounded-lg space-y-3">
          <div className="flex justify-between items-center">
            <span className="text-sm text-stone-600">应用名称</span>
            <span className="text-sm font-medium text-stone-900">FoeFlow</span>
          </div>
          <div className="flex justify-between items-center">
            <span className="text-sm text-stone-600">版本</span>
            <span className="text-sm font-medium text-stone-900">v0.1.0</span>
          </div>
          <div className="flex justify-between items-center">
            <span className="text-sm text-stone-600">开发者</span>
            <span className="text-sm font-medium text-stone-900">Violet·致义无反顾的自己</span>
          </div>
          <div className="pt-3 border-t border-stone-100">
            <p className="text-xs text-stone-400 leading-relaxed">
              本工具为华东师范大学教育学部公众号「未来教育引领者」的桌面端辅助应用，基于校内大模型 API 提供智能审核、文章生成、AI 排版等功能。所有数据存储在本地，确保隐私安全。
            </p>
            <p className="text-xs text-stone-400 leading-relaxed mt-2">
              有任何问题或建议请联系 <a href="mailto:contact@example.invalid" className="text-red-600 hover:text-red-700 underline">contact@example.invalid</a>
            </p>
          </div>
        </div>
      </div>

      {/* 保存按钮 */}
      <div className="flex items-center gap-4 pt-4 border-t border-stone-200">
        <Button
          onClick={handleSave}
          disabled={saved}
          className="bg-red-600 hover:bg-red-700 text-white px-8"
        >
          {saved ? (
            <>
              <span className="text-green-300 mr-2">✓</span>
              已保存
            </>
          ) : (
            <>
              <Save className="w-4 h-4 mr-2" />
              保存设置
            </>
          )}
        </Button>
      </div>
    </div>
  );
}
