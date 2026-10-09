import type { SupportedLanguages, ThemesType, ThemeTypes } from '@pierre/diffs/react';

/**
 * Shared Pierre diff/code surface options. `themeType` is pinned to the app's
 * resolved theme mode so light/dark toggles re-render with the matching Shiki
 * theme. `disableFileHeader` is on because every surface using these options
 * renders its own toolbar/dialog chrome.
 */
export interface PierreDiffsBaseOptions {
  theme: ThemesType;
  themeType: ThemeTypes;
  disableFileHeader: boolean;
  overflow: 'scroll';
}

/**
 * The one Shiki theme pair every surface uses. The worker pool's theme
 * overrides per-surface options, so surfaces must agree with it to look the
 * same whether they highlight on the main thread or in a worker.
 */
export const PIERRE_THEME_PAIR: ThemesType = {
  dark: 'github-dark',
  light: 'github-light',
};

export function pierreDiffsBaseOptions(resolvedMode: 'dark' | 'light'): PierreDiffsBaseOptions {
  return {
    theme: PIERRE_THEME_PAIR,
    themeType: resolvedMode,
    disableFileHeader: true,
    overflow: 'scroll',
  };
}

/**
 * Pierre infers the highlight language from the filename. Only fall back to an
 * explicit `lang` when no usable name is available (preview surfaces without a
 * basename); unknown server languages degrade to plain text.
 */
const LANGUAGE_FALLBACK: Record<string, SupportedLanguages> = {
  typescript: 'typescript',
  javascript: 'javascript',
  json: 'json',
  markdown: 'markdown',
  python: 'python',
  css: 'css',
  html: 'html',
  rust: 'rust',
  go: 'go',
  kotlin: 'kotlin',
  kt: 'kotlin',
  kts: 'kotlin',
};

export function resolvePierreLang(
  name: string | undefined,
  language: string | undefined,
): SupportedLanguages | undefined {
  if (name !== undefined && name.trim() !== '') return undefined;
  const key = (language ?? '').toLowerCase();
  return LANGUAGE_FALLBACK[key] ?? 'text';
}
