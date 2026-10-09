import { preloadHighlighter, setCustomExtension } from '@pierre/diffs';

/**
 * Warm the shared Shiki highlighter used by every @pierre/diffs surface
 * (editor, previews, chat visualizations).
 *
 * Why: the main-thread highlighter still serves the editor (which opts out
 * of the worker pool) and every surface that mounts before the pool in
 * `lib/pierreWorkerPool.ts` is ready. When such a surface mounts before the
 * shared highlighter instance finishes creating, the renderer returns an
 * empty result and mounts an empty code block that stays blank until it is
 * remounted (e.g. toggling expand twice). Preloading the highlighter plus the two themes
 * every surface requests removes that race window entirely. Languages attach
 * per-surface on demand; a rare language renders plain text for one frame and
 * then highlights, which does not need startup help.
 *
 * Fire-and-forget: if this fails, surfaces still fall back to their own async
 * highlighting path.
 */
export function preloadPierreDiffsHighlighter(): void {
  // Pierre recognizes .kt but does not map Kotlin scripts by default.
  setCustomExtension('kt', 'kotlin');
  setCustomExtension('kts', 'kotlin');
  void preloadHighlighter({
    themes: ['github-dark', 'github-light'],
    langs: ['kotlin'],
  }).catch(() => {
    // Per-surface async highlighting remains the fallback.
  });
}
