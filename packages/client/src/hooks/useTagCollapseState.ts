import { useState, useCallback } from 'react';

const STORAGE_KEY = 'prokopai_collapsed_tags';

function loadCollapsedTags(): Set<string> {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as string[];
      return new Set(parsed);
    }
  } catch {
    // ignore
  }
  return new Set();
}

function saveCollapsedTags(tags: Set<string>): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify([...tags]));
  } catch {
    // ignore
  }
}

export function useTagCollapseState() {
  const [collapsedTags, setCollapsedTags] = useState<Set<string>>(loadCollapsedTags);

  const isTagOpen = useCallback(
    (tagName: string) => !collapsedTags.has(tagName),
    [collapsedTags],
  );

  const toggleTag = useCallback((tagName: string, open: boolean) => {
    setCollapsedTags(prev => {
      const next = new Set(prev);
      if (open) {
        next.delete(tagName);
      } else {
        next.add(tagName);
      }
      saveCollapsedTags(next);
      return next;
    });
  }, []);

  return { isTagOpen, toggleTag };
}
