/**
 * Theme Engine for FOE Publicity
 *
 * Loads theme definitions and applies inline styles to HTML elements.
 * Inspired by wewrite's theme.py and converter.py
 */

export interface ThemeColors {
  primary: string;
  secondary: string;
  text: string;
  textLight: string;
  background: string;
  codeBg: string;
  codeColor: string;
  quoteBorder: string;
  quoteBg: string;
  border: string;
}

export interface ThemeStyle {
  [property: string]: string;
}

export interface Theme {
  name: string;
  description: string;
  colors: ThemeColors;
  typography: {
    fontFamily: string;
    fontSize: string;
    lineHeight: number;
  };
  styles: {
    [element: string]: ThemeStyle;
  };
}

/**
 * Resolve a color reference to its actual value.
 * e.g., "primary" → "#2563eb", "#333333" → "#333333"
 */
function resolveColor(value: string, colors: ThemeColors): string {
  if (!value) return '';

  // Check if it's a color key
  const colorKey = value as keyof ThemeColors;
  if (colorKey in colors) {
    return colors[colorKey];
  }

  // Otherwise return as-is (already a color value)
  return value;
}

/**
 * Convert a style object to inline CSS string.
 */
function styleToString(style: ThemeStyle, colors: ThemeColors): string {
  const parts: string[] = [];

  for (const [property, value] of Object.entries(style)) {
    // Convert camelCase to kebab-case
    const cssProperty = property.replace(/([A-Z])/g, '-$1').toLowerCase();
    const cssValue = resolveColor(value, colors);

    if (cssValue) {
      parts.push(`${cssProperty}: ${cssValue}`);
    }
  }

  return parts.join('; ');
}

/**
 * Load a theme by name from the themes directory.
 */
export async function loadTheme(name: string): Promise<Theme> {
  try {
    const response = await fetch(`/src/themes/${name}.json`);
    if (!response.ok) {
      throw new Error(`Theme not found: ${name}`);
    }
    return await response.json();
  } catch (error) {
    console.error(`[ThemeEngine] Failed to load theme "${name}":`, error);
    throw error;
  }
}

/**
 * Load theme from a custom path (for user-defined themes).
 */
export async function loadThemeFromPath(path: string): Promise<Theme> {
  try {
    const response = await fetch(path);
    if (!response.ok) {
      throw new Error(`Theme not found: ${path}`);
    }
    return await response.json();
  } catch (error) {
    console.error(`[ThemeEngine] Failed to load theme from "${path}":`, error);
    throw error;
  }
}

/**
 * List all available built-in themes.
 * Returns an array of theme metadata.
 */
export async function listThemes(): Promise<Array<{ name: string; description: string }>> {
  const themeNames = [
    'professional-clean',
    'warm-editorial',
    'academic-serious',
    'youth-energy',
    'minimal-gold',
    'ink-stone',
  ];

  return themeNames.map(name => ({
    name,
    description: `${name}-theme`, // Will be filled when loading
  }));
}

/**
 * Get inline styles for all elements defined in the theme.
 * Returns a map of element selector → inline CSS string.
 */
export function getInlineStyles(theme: Theme): Record<string, string> {
  const result: Record<string, string> = {};

  for (const [element, style] of Object.entries(theme.styles)) {
    result[element] = styleToString(style, theme.colors);
  }

  return result;
}

/**
 * Apply theme styles to an HTML string.
 * Parses the HTML, applies inline styles based on the theme, and returns the result.
 */
export function applyTheme(html: string, theme: Theme): string {
  // Simple regex-based approach for WeChat/Xiemi compatibility
  // This avoids the need for a heavy DOM parser

  const styles = getInlineStyles(theme);
  let result = html;

  // Apply typography to body/container
  const bodyStyle = `font-family: ${theme.typography.fontFamily}; font-size: ${theme.typography.fontSize}; line-height: ${theme.typography.lineHeight};`;

  // Wrap content in a container with base styles
  if (!html.trim().startsWith('<')) {
    result = `<div style="${bodyStyle}">${html}</div>`;
  }

  // Apply styles element by element
  for (const [selector, styleString] of Object.entries(styles)) {
    if (!styleString) continue;

    // Handle different selector types
    if (selector.match(/^[a-z]+$/i)) {
      // Simple tag selector (h1, p, etc.)
      const tagRegex = new RegExp(`<${selector}(\\s[^>]*)?>`, 'gi');
      result = result.replace(tagRegex, (match, attrs) => {
        // Extract existing style
        const existingStyleMatch = attrs?.match(/style\s*=\s*["']([^"']*)["']/);
        if (existingStyleMatch) {
          // Style already exists, don't override
          return match;
        }
        return `<${selector}${attrs || ''} style="${styleString}">`;
      });
    }
  }

  return result;
}

/**
 * Apply styles to a specific element.
 * Utility for fine-grained control.
 */
export function applyStyleToElement(
  element: HTMLElement,
  selector: string,
  theme: Theme
): void {
  const styles = getInlineStyles(theme);
  const styleString = styles[selector];

  if (styleString) {
    const existing = element.getAttribute('style') || '';
    element.setAttribute('style', existing ? `${existing}; ${styleString}` : styleString);
  }
}

/**
 * Get the default theme name.
 */
export function getDefaultTheme(): string {
  return 'professional-clean';
}

/**
 * Validate a theme definition.
 * Returns true if valid, throws an error if invalid.
 */
export function validateTheme(theme: unknown): theme is Theme {
  if (!theme || typeof theme !== 'object') {
    throw new Error('Theme must be an object');
  }

  const t = theme as Record<string, unknown>;

  if (!t.name || typeof t.name !== 'string') {
    throw new Error('Theme must have a "name" string field');
  }

  if (!t.description || typeof t.description !== 'string') {
    throw new Error('Theme must have a "description" string field');
  }

  if (!t.colors || typeof t.colors !== 'object') {
    throw new Error('Theme must have a "colors" object');
  }

  if (!t.typography || typeof t.typography !== 'object') {
    throw new Error('Theme must have a "typography" object');
  }

  if (!t.styles || typeof t.styles !== 'object') {
    throw new Error('Theme must have a "styles" object');
  }

  return true;
}
