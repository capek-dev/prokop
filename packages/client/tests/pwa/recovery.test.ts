import { describe, expect, it } from 'vitest';

import { isProkopCache, isLikelyStaleBuildError } from '@/pwa/recovery';

describe('PWA recovery', () => {
  it('recognizes common stale build failures', () => {
    expect(isLikelyStaleBuildError(new Error('Failed to fetch dynamically imported module'))).toBe(true);
    expect(isLikelyStaleBuildError(new Error('ChunkLoadError: Loading chunk 12 failed'))).toBe(true);
    expect(isLikelyStaleBuildError(new Error("Unexpected token '<'"))).toBe(true);
    expect(isLikelyStaleBuildError(new Error('Module MIME type text/html is not executable'))).toBe(true);
    expect(isLikelyStaleBuildError(new Error('Normal render failure'))).toBe(false);
  });

  it('selects only Jean2 Workbox and runtime caches', () => {
    expect(isProkopCache('workbox-precache-v2-http://localhost')).toBe(true);
    expect(isProkopCache('static-assets')).toBe(true);
    expect(isProkopCache('static-media')).toBe(true);
    expect(isProkopCache('html-cache')).toBe(true);
    expect(isProkopCache('unrelated-cache')).toBe(false);
  });
});
