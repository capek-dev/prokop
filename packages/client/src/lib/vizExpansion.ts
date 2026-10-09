import { useCallback, useState } from 'react';

/**
 * Expansion state for chat visualizations (DiffViewer, CodeBlock) that
 * survives virtualizer row recycling and page reloads. Rows in the
 * transcript unmount when scrolled away; pure useState resets then, which
 * made user-opened diffs snap shut again. State lives in a module-level
 * map (recycling) mirrored to sessionStorage (reload).
 *
 * Keys should be stable per visualization instance; callers derive them
 * from path plus a content-shape discriminator.
 */

const KEY_PREFIX = 'viz-expansion:';
const memory = new Map<string, boolean>();

function readPersisted(key: string): boolean | null {
  if (memory.has(key)) return memory.get(key) ?? null;
  try {
    const raw = sessionStorage.getItem(KEY_PREFIX + key);
    if (raw === '1') return true;
    if (raw === '0') return false;
  } catch {
    // sessionStorage unavailable (private mode quirks); memory-only is fine.
  }
  return null;
}

function writePersisted(key: string, value: boolean): void {
  memory.set(key, value);
  try {
    sessionStorage.setItem(KEY_PREFIX + key, value ? '1' : '0');
  } catch {
    // Ignore; memory map still covers remounts.
  }
}

export function useVizExpanded(
  key: string,
  defaultExpanded: boolean,
): [boolean, (update: boolean | ((prev: boolean) => boolean)) => void] {
  const [expanded, setExpanded] = useState(() => readPersisted(key) ?? defaultExpanded);

  const setExpandedPersisted = useCallback(
    (update: boolean | ((prev: boolean) => boolean)) => {
      setExpanded((prev) => {
        const next = typeof update === 'function' ? update(prev) : update;
        if (next !== prev) writePersisted(key, next);
        return next;
      });
    },
    [key],
  );

  return [expanded, setExpandedPersisted];
}

/**
 * Like useVizExpanded, but the default may change while mounted (a tool
 * group opens while its tools run and folds once they finish). Only a
 * user toggle is persisted; until then the live default wins.
 */
export function useVizExpandedOverride(
  key: string,
  defaultExpanded: boolean,
): [boolean, (expanded: boolean) => void] {
  const [override, setOverride] = useState(() => readPersisted(key));

  const setExpanded = useCallback((expanded: boolean) => {
    writePersisted(key, expanded);
    setOverride(expanded);
  }, [key]);

  return [override ?? defaultExpanded, setExpanded];
}
