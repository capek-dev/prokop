import type { Hono } from 'hono';
import { streamSSE } from 'hono/streaming';
import type { AttentionFeed } from '@/application/attention/feed';

const SSE_KEEPALIVE_MS = 25_000;

/**
 * What needs the user on this server. Any paired caller may read it: a client
 * working on another machine keeps one stream per paired server open so
 * approvals and finished runs elsewhere are never missed.
 */
export function registerAttentionRoutes(app: Hono, feed: AttentionFeed): void {
  /** GET /api/attention - current snapshot. */
  app.get('/api/attention', (c) => c.json(feed.snapshot()));

  /**
   * GET /api/attention/events - Server-Sent Events. Sends a `snapshot` event
   * immediately and again whenever the content changes.
   */
  app.get('/api/attention/events', (c) => streamSSE(c, async (stream) => {
    let pending = Promise.resolve();
    const send = (snapshot: ReturnType<AttentionFeed['snapshot']>) => {
      // Keep writes ordered; a slow client must not interleave snapshots.
      pending = pending.then(() => stream.writeSSE({ event: 'snapshot', data: JSON.stringify(snapshot) })).catch(() => {});
    };
    const unsubscribe = feed.subscribe(send);
    const closed = new Promise<void>((resolve) => stream.onAbort(resolve));
    const keepalive = setInterval(() => {
      pending = pending.then(() => stream.write(': keepalive\n\n')).then(() => undefined).catch(() => {});
    }, SSE_KEEPALIVE_MS);
    try {
      send(feed.snapshot());
      await closed;
    } finally {
      clearInterval(keepalive);
      unsubscribe();
    }
  }));
}
