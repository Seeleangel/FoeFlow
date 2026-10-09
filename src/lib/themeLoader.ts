/**
 * Theme Loader for FOE Publicity
 *
 * Imports theme JSON files directly (Vite handles the bundling).
 * This is a simpler approach than fetch for a desktop app.
 */

import type { Theme, ThemeMeta } from '@/types';

// Import all theme files at build time
import professionalClean from '@/themes/professional-clean.json';
import warmEditorial from '@/themes/warm-editorial.json';
import academicSerious from '@/themes/academic-serious.json';
import youthEnergy from '@/themes/youth-energy.json';
import minimalGold from '@/themes/minimal-gold.json';
import inkStone from '@/themes/ink-stone.json';

const THEMES: Record<string, Theme> = {
  'professional-clean': professionalClean as Theme,
  'warm-editorial': warmEditorial as Theme,
  'academic-serious': academicSerious as Theme,
  'youth-energy': youthEnergy as Theme,
  'minimal-gold': minimalGold as Theme,
  'ink-stone': inkStone as Theme,
};

/**
 * Get a theme by name.
 */
export function getTheme(name: string): Theme | undefined {
  return THEMES[name];
}

/**
 * Get the default theme.
 */
export function getDefaultTheme(): Theme {
  return THEMES['professional-clean'];
}

/**
 * List all available themes.
 */
export function listAllThemes(): ThemeMeta[] {
  return Object.values(THEMES).map((theme) => ({
    name: theme.name,
    description: theme.description,
  }));
}

/**
 * Get all themes (for gallery).
 */
export function getAllThemes(): Theme[] {
  return Object.values(THEMES);
}
