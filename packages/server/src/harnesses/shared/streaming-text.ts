import type { Part, TextPart } from '@prokopai/sdk';
import { persistStreamingPartSnapshots, updatePart } from '@/infrastructure/sqlite/message-store';

const STREAM_PERSIST_INTERVAL_MS = 300;

interface StreamingText {
  sessionId: string;
  part: TextPart;
  text: string;
  persistedAt: number;
}

/**
 * Throttled persistence for text streamed by the native CLI harnesses.
 *
 * Clients still receive every delta as `part.append`. SQLite gets a plain
 * snapshot at most once per interval (no read-before-write, no search
 * reindex), and `settle` writes the final text through `updatePart` so the
 * search index sees it once. Callers broadcast the settled part as
 * `part.updated`, which repairs any client that loaded the transcript
 * between snapshots. Mirrors Čapek's stream handlers.
 */
export class StreamingTextWriter {
  private readonly open = new Map<string, StreamingText>();
  private readonly intervalMs: number;
  private readonly now: () => number;

  constructor(options: { intervalMs?: number; now?: () => number } = {}) {
    this.intervalMs = options.intervalMs ?? STREAM_PERSIST_INTERVAL_MS;
    this.now = options.now ?? Date.now;
  }

  /** Records the part's full streamed text; persists a snapshot once the interval has elapsed. */
  append(sessionId: string, part: TextPart, text: string): void {
    const now = this.now();
    let entry = this.open.get(part.id);
    if (!entry) {
      entry = { sessionId, part, text, persistedAt: Number.NEGATIVE_INFINITY };
      this.open.set(part.id, entry);
    }
    entry.text = text;
    if (now - entry.persistedAt < this.intervalMs) return;
    persistStreamingPartSnapshots([{ id: part.id, messageId: part.messageId, sessionId,
      type: 'text', createdAt: part.createdAt, text }]);
    entry.persistedAt = now;
  }

  /**
   * Ends throttling for the part and writes `finalText` (else the last
   * streamed text) with search indexing. Null when there is nothing to write.
   */
  settle(partId: string, finalText?: string): Part | null {
    const entry = this.open.get(partId);
    this.open.delete(partId);
    const text = finalText ?? entry?.text;
    if (text === undefined) return null;
    return updatePart(partId, { text });
  }

  /** Settles every open part, returning each stored part with its session. */
  settleAll(): Array<{ sessionId: string; part: Part }> {
    const settled: Array<{ sessionId: string; part: Part }> = [];
    for (const [partId, entry] of [...this.open]) {
      const part = this.settle(partId);
      if (part) settled.push({ sessionId: entry.sessionId, part });
    }
    return settled;
  }
}
