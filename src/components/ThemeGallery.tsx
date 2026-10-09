import { useState, useEffect } from 'react';
import { X, Palette } from 'lucide-react';
import type { Theme } from '@/types';
import { listThemes, loadTheme } from '@/lib/themeEngine';

interface ThemeGalleryProps {
  open: boolean;
  onClose: () => void;
  selectedTheme: string;
  onSelectTheme: (themeName: string) => void;
}

interface ThemeCardProps {
  theme: Theme;
  selected: boolean;
  onSelect: () => void;
}

/**
 * Preview card for a single theme.
 * Shows a miniature preview of how the theme styles content.
 */
function ThemeCard({ theme, selected, onSelect }: ThemeCardProps) {
  const previewHtml = `
    <div style="padding: 12px;">
      <h2 style="font-size: 14px; font-weight: 600; margin: 0 0 8px 0; color: ${theme.colors.primary};">${theme.name}</h2>
      <p style="font-size: 10px; line-height: 1.5; color: ${theme.colors.text}; margin: 0;">
        这是一段预览文本，展示主题的排版效果。<strong style="color: ${theme.colors.primary};">加粗文字</strong>和<em>斜体</em>。
      </p>
      <div style="margin-top: 8px; padding: 6px; background: ${theme.colors.quoteBg}; border-left: 2px solid ${theme.colors.quoteBorder}; border-radius: 4px;">
        <span style="font-size: 9px; color: ${theme.colors.textLight};">引用块样式</span>
      </div>
    </div>
  `;

  return (
    <button
      onClick={onSelect}
      className={`relative flex flex-col items-start w-full p-0 border-2 rounded-xl overflow-hidden transition-all duration-200 hover:shadow-lg ${
        selected
          ? 'border-blue-500 ring-2 ring-blue-200'
          : 'border-stone-200 hover:border-stone-300'
      }`}
    >
      {/* Preview area */}
      <div className="w-full h-28 bg-white border-b border-stone-100 overflow-hidden">
        <div dangerouslySetInnerHTML={{ __html: previewHtml }} />
      </div>

      {/* Info area */}
      <div className="w-full p-3 bg-white">
        <div className="flex items-center gap-2">
          <div
            className="w-4 h-4 rounded-full border border-stone-200"
            style={{ backgroundColor: theme.colors.primary }}
          />
          <span className="font-medium text-sm text-stone-900">{theme.name}</span>
        </div>
        <p className="text-xs text-stone-500 mt-1">{theme.description}</p>
      </div>

      {/* Selected indicator */}
      {selected && (
        <div className="absolute top-2 right-2 w-5 h-5 bg-blue-500 rounded-full flex items-center justify-center">
          <svg className="w-3 h-3 text-white" fill="currentColor" viewBox="0 0 20 20" aria-hidden="true">
            <path
              fillRule="evenodd"
              d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z"
              clipRule="evenodd"
            />
          </svg>
        </div>
      )}
    </button>
  );
}

/**
 * Theme Gallery Modal
 *
 * Displays all available themes in a grid layout with live previews.
 * Users can click to select a theme.
 */
export default function ThemeGallery({
  open,
  onClose,
  selectedTheme,
  onSelectTheme,
}: ThemeGalleryProps) {
  const [themes, setThemes] = useState<Theme[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    async function loadThemes() {
      if (!open) return;

      setLoading(true);
      try {
        const themeMetas = await listThemes();
        const loadedThemes: Theme[] = [];

        for (const meta of themeMetas) {
          try {
            const theme = await loadTheme(meta.name);
            loadedThemes.push(theme);
          } catch (err) {
            console.error(`Failed to load theme ${meta.name}:`, err);
          }
        }

        setThemes(loadedThemes);
      } catch (err) {
        console.error('Failed to load themes:', err);
      } finally {
        setLoading(false);
      }
    }

    loadThemes();
  }, [open]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-4xl max-h-[80vh] overflow-hidden flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-stone-100">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-full bg-blue-100 flex items-center justify-center">
              <Palette className="w-5 h-5 text-blue-600" />
            </div>
            <div>
              <h2 className="text-lg font-semibold text-stone-900">主题画廊</h2>
              <p className="text-xs text-stone-500">选择适合你文章风格的排版主题</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="w-8 h-8 rounded-full hover:bg-stone-100 flex items-center justify-center transition-colors"
          >
            <X className="w-5 h-5 text-stone-500" />
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-6">
          {loading ? (
            <div className="flex items-center justify-center py-16">
              <div className="flex items-center gap-3 text-stone-500">
                <span className="w-2 h-2 bg-stone-300 rounded-full animate-bounce" />
                <span className="w-2 h-2 bg-stone-300 rounded-full animate-bounce [animation-delay:0.1s]" />
                <span className="w-2 h-2 bg-stone-300 rounded-full animate-bounce [animation-delay:0.2s]" />
                <span className="text-sm">加载主题中...</span>
              </div>
            </div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
              {themes.map((theme) => (
                <ThemeCard
                  key={theme.name}
                  theme={theme}
                  selected={selectedTheme === theme.name}
                  onSelect={() => {
                    onSelectTheme(theme.name);
                    onClose();
                  }}
                />
              ))}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-6 py-4 border-t border-stone-100 bg-stone-50">
          <p className="text-xs text-stone-500">
            提示：切换主题后可在预览区实时查看效果。主题仅影响 HTML 导出样式，不影响 Word 导出。
          </p>
        </div>
      </div>
    </div>
  );
}
