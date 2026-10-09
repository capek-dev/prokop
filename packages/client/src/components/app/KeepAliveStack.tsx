import { useState } from 'react';
import type { CSSProperties, ReactNode } from 'react';

export interface KeepAliveEntry<T> {
  key: string;
  value: T;
}

interface RetainedEntry<T> extends KeepAliveEntry<T> {
  usedAt: number;
}

// Same hiding as WorkspaceViewHost: layout and size stay intact, so hidden
// subtrees never measure a 0x0 box and revealing one only repaints.
const HIDDEN: CSSProperties = { visibility: 'hidden', opacity: 0, pointerEvents: 'none' };

/**
 * Marks `active` as most recently used and evicts the least recently used
 * entries past `limit`. Entries keep their first-seen order.
 */
export function retainKeepAliveEntries<T>(
  entries: readonly RetainedEntry<T>[],
  active: KeepAliveEntry<T>,
  limit: number,
): RetainedEntry<T>[] {
  const usedAt = entries.reduce((max, entry) => Math.max(max, entry.usedAt), 0) + 1;
  const next = entries.some((entry) => entry.key === active.key)
    ? entries.map((entry) => entry.key === active.key ? { ...active, usedAt } : entry)
    : [...entries, { ...active, usedAt }];
  if (next.length <= limit) return next;
  const evicted = new Set(next
    .filter((entry) => entry.key !== active.key)
    .sort((a, b) => a.usedAt - b.usedAt)
    .slice(0, next.length - limit)
    .map((entry) => entry.key));
  return next.filter((entry) => !evicted.has(entry.key));
}

interface KeepAliveStackProps<T> {
  /** The entry to show; null hides every retained entry. */
  active: KeepAliveEntry<T> | null;
  limit?: number;
  /** Renders one entry; the active one gets the live value, hidden ones their last value. */
  children: (value: T, active: boolean) => ReactNode;
}

/**
 * Keeps the last `limit` keyed subtrees mounted and hides the inactive ones,
 * so switching back to a recent workspace reuses its DOM, models, and
 * connections instead of rebuilding them. Entries never reorder: moving a DOM
 * subtree resets its scroll and reconnects custom elements.
 */
export function KeepAliveStack<T>({ active, limit = 3, children }: KeepAliveStackProps<T>) {
  const [entries, setEntries] = useState<RetainedEntry<T>[]>(() => active ? [{ ...active, usedAt: 1 }] : []);
  const latest = entries.reduce((max, entry) => Math.max(max, entry.usedAt), 0);
  const current = active ? entries.find((entry) => entry.key === active.key) : undefined;
  if (active && current?.usedAt !== latest) {
    setEntries(retainKeepAliveEntries(entries, active, limit));
  }

  return (
    <div className="relative flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
      {entries.map((entry) => {
        const isActive = entry.key === active?.key;
        return (
          <div
            key={entry.key}
            data-keep-alive-entry={isActive ? 'active' : 'hidden'}
            inert={!isActive}
            aria-hidden={isActive ? undefined : true}
            className="absolute inset-0 flex min-h-0 min-w-0 flex-col overflow-hidden"
            style={isActive ? undefined : HIDDEN}
          >
            {children(isActive && active ? active.value : entry.value, isActive)}
          </div>
        );
      })}
    </div>
  );
}
