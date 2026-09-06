import { expect, test } from 'vitest';
import { getFiletypeFromFileName, getSharedHighlighter } from '@pierre/diffs';
import { resolvePierreLang } from '@/lib/pierreDiffsTheme';
import { preloadPierreDiffsHighlighter } from '@/lib/pierreDiffsPreload';
preloadPierreDiffsHighlighter();

test('all filename-driven Pierre surfaces detect kt and kts as Kotlin', () => {
  expect(getFiletypeFromFileName('ClassificationEngine.kt')).toBe('kotlin');
  expect(getFiletypeFromFileName('build.gradle.kts')).toBe('kotlin');
  expect(resolvePierreLang(undefined, 'kotlin')).toBe('kotlin');
});
test('real shared highlighter produces Kotlin syntax colors in both themes', async () => {
  const highlighter = await getSharedHighlighter({ langs: ['kotlin'], themes: ['github-dark', 'github-light'] });
  for (const theme of ['github-dark', 'github-light']) {
    const result = highlighter.codeToTokens('fun classify(value: String): Boolean = true', { lang: 'kotlin', theme });
    expect(new Set(result.tokens.flat().map((token) => token.color)).size).toBeGreaterThan(1);
  }
});
