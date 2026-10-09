import type { CSSProperties } from 'react';

/**
 * Hues for worktree identity. Red, amber, and green are left out: they mean
 * error, needs-you, and success in session status.
 */
const WORKTREE_HUES = [255, 195, 300, 165, 225, 335, 105, 280] as const;

/** Stable hue for a worktree id, so a worktree keeps its color everywhere. */
export function worktreeHue(worktreeId: string): number {
  let hash = 0;
  for (let index = 0; index < worktreeId.length; index += 1) {
    hash = (hash * 31 + worktreeId.charCodeAt(index)) >>> 0;
  }
  return WORKTREE_HUES[hash % WORKTREE_HUES.length];
}

/** Inline style for `.worktree-tone` elements (lightness/chroma follow the theme in CSS). */
export function worktreeToneStyle(worktreeId: string): CSSProperties {
  return { '--wt-hue': worktreeHue(worktreeId) } as CSSProperties;
}
