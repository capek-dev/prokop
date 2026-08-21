import { useState, useCallback } from 'react';
import type { FileEntry } from '@prokopai/sdk';

interface UseFileSearchOptions {
  workspaceId: string;
  debounceMs?: number;
}

interface FileMention {
  type: 'file';
  path: string;
  display: string;
}

export function useFileSearch({ workspaceId: _workspaceId, debounceMs: _debounceMs = 150 }: UseFileSearchOptions) {
  const [query, setQuery] = useState('');
  const [showAutocomplete, setShowAutocomplete] = useState(false);

  const handleFileSelect = useCallback((file: FileEntry): FileMention => {
    return {
      type: 'file',
      path: file.path,
      display: file.name,
    };
  }, []);

  const insertMention = useCallback((text: string, cursorPos: number, mention: FileMention) => {
    const beforeMention = text.lastIndexOf('@', cursorPos);
    if (beforeMention === -1) return { text, cursorPos };

    const newText =
      text.slice(0, beforeMention) +
      `@${mention.path}` +
      text.slice(cursorPos);

    const newCursorPos = beforeMention + mention.path.length + 1;

    return { text: newText, cursorPos: newCursorPos };
  }, []);

  return {
    query,
    setQuery,
    showAutocomplete,
    setShowAutocomplete,
    handleFileSelect,
    insertMention,
  };
}

export function extractMentionsFromText(text: string): FileMention[] {
  const mentionRegex = /@([^\s@]+)/g;
  const seen = new Set<string>();
  const mentions: FileMention[] = [];
  let match;

  while ((match = mentionRegex.exec(text)) !== null) {
    const path = match[1];
    if (!seen.has(path)) {
      seen.add(path);
      mentions.push({ type: 'file', path, display: path.split('/').pop() || path });
    }
  }

  return mentions;
}

export type { FileMention };
