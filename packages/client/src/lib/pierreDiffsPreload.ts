import { preloadHighlighter } from '@pierre/diffs';

/**
 * Warm the shared Shiki highlighter used by every @pierre/diffs surface
 * (editor, previews, chat visualizations).
 *
 * Why: when the first surface mounts before the shared highlighter instance
 * finishes creating, the renderer returns an empty result and mounts an empty
 * code block. The lib only self-schedules that repaint through a worker pool,
 * which this app does not use, so the block stays blank until it is remounted
 * (e.g. toggling expand twice). Preloading the highlighter plus the two themes
 * every surface requests removes that race window entirely. Languages attach
 * per-surface on demand; a rare language renders plain text for one frame and
 * then highlights, which does not need startup help.
 *
 * Fire-and-forget: if this fails, surfaces still fall back to their own async
 * highlighting path.
 */
export function preloadPierreDiffsHighlighter(): void {
  void preloadHighlighter({
    themes: ['github-dark', 'github-light'],
    langs: [],
  }).catch(() => {
    // Per-surface async highlighting remains the fallback.
  });
}
