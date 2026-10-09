/**
 * Content-addressed cache key for Pierre's worker pool highlight cache.
 *
 * The pool caches highlighted results by `cacheKey`, so a key must change
 * whenever the contents change; otherwise a remount shows stale tokens. A
 * remount with an unchanged key (scrolling back through a transcript,
 * collapse/expand) reuses the cached highlight instead of re-tokenizing.
 * FNV-1a over the contents is linear and far cheaper than tokenizing them.
 */
export function pierreCacheKey(scope: string, contents: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < contents.length; i++) {
    hash ^= contents.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return `${scope}:${contents.length}:${(hash >>> 0).toString(36)}`;
}
