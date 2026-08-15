import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import { mkdtempSync, rmSync, readFileSync, writeFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

import {
  parseEntries,
  entriesToContent,
  loadMemoryFile,
  formatMemorySection,
  loadMemoryInstructions,
  addEntry,
  replaceEntry,
  removeEntry,
  USER_CHAR_LIMIT,
  MEMORY_CHAR_LIMIT,
} from '@capekai/core/compat/jean2';

describe('memory registry', () => {
  let testDir: string;

  beforeEach(() => {
    testDir = mkdtempSync(join(tmpdir(), 'jean2-memory-test-'));
  });

  afterEach(() => {
    rmSync(testDir, { recursive: true, force: true });
  });

  function userPath() {
    return join(testDir, 'USER.md');
  }

  function memoryPath() {
    return join(testDir, 'MEMORY.md');
  }

  function writeMemoryFile(target: 'user' | 'memory', content: string) {
    const file = target === 'user' ? userPath() : memoryPath();
    writeFileSync(file, content, 'utf-8');
  }

  // ── parseEntries ──────────────────────────────────────────────

  describe('parseEntries', () => {
    test('parses bullet entries from content', () => {
      const content = '- First entry\n- Second entry\n- Third entry';
      const entries = parseEntries(content);
      expect(entries).toEqual(['- First entry', '- Second entry', '- Third entry']);
    });

    test('ignores blank lines and non-bullet lines', () => {
      const content = '- Entry one\n\nSome text\n- Entry two\n';
      const entries = parseEntries(content);
      expect(entries).toEqual(['- Entry one', '- Entry two']);
    });

    test('returns empty array for empty content', () => {
      expect(parseEntries('')).toEqual([]);
      expect(parseEntries('   ')).toEqual([]);
      expect(parseEntries('no bullets here')).toEqual([]);
    });
  });

  // ── entriesToContent ──────────────────────────────────────────

  describe('entriesToContent', () => {
    test('joins entries with newlines', () => {
      const entries = ['- A', '- B'];
      expect(entriesToContent(entries)).toBe('- A\n- B');
    });

    test('returns empty string for empty array', () => {
      expect(entriesToContent([])).toBe('');
    });
  });

  // ── loadMemoryFile ────────────────────────────────────────────

  describe('loadMemoryFile', () => {
    test('returns null when file does not exist', async () => {
      const result = await loadMemoryFile(testDir, 'user');
      expect(result).toBeNull();
    });

    test('returns null when file is empty', async () => {
      writeMemoryFile('user', '');
      const result = await loadMemoryFile(testDir, 'user');
      expect(result).toBeNull();
    });

    test('returns parsed file for user target', async () => {
      writeMemoryFile('user', '- Prefers concise answers.');
      const result = await loadMemoryFile(testDir, 'user');

      expect(result).not.toBeNull();
      expect(result!.path).toBe('USER.md');
      expect(result!.content).toBe('- Prefers concise answers.');
      expect(result!.entries).toEqual(['- Prefers concise answers.']);
      expect(result!.charCount).toBe('- Prefers concise answers.'.length);
      expect(result!.charLimit).toBe(USER_CHAR_LIMIT);
    });

    test('returns parsed file for memory target', async () => {
      writeMemoryFile('memory', '- Uses Bun/TypeScript.');
      const result = await loadMemoryFile(testDir, 'memory');

      expect(result).not.toBeNull();
      expect(result!.path).toBe('MEMORY.md');
      expect(result!.charLimit).toBe(MEMORY_CHAR_LIMIT);
    });
  });

  // ── formatMemorySection ──────────────────────────────────────

  describe('formatMemorySection', () => {
    test('formats user memory section', () => {
      const result = formatMemorySection('user_memory', '.jean2/USER.md', '- Test', 6, 1500);
      expect(result).toBe(
        '<user_memory path=".jean2/USER.md" usage="6/1500">\n- Test\n</user_memory>',
      );
    });

    test('formats workspace memory section', () => {
      const result = formatMemorySection('workspace_memory', '.jean2/MEMORY.md', '- Fact', 6, 2500);
      expect(result).toBe(
        '<workspace_memory path=".jean2/MEMORY.md" usage="6/2500">\n- Fact\n</workspace_memory>',
      );
    });
  });

  // ── addEntry ─────────────────────────────────────────────────

  describe('addEntry', () => {
    test('creates new file and adds entry', async () => {
      const result = await addEntry(testDir, 'user', 'Prefers concise answers.');

      expect(result.success).toBe(true);
      expect(result.result!.action).toBe('add');
      expect(result.result!.target).toBe('user');
      expect(result.result!.entry).toBe('Prefers concise answers.');

      const content = readFileSync(userPath(), 'utf-8');
      expect(content).toBe('- Prefers concise answers.');
    });

    test('appends to existing file', async () => {
      writeMemoryFile('user', '- First entry');
      const result = await addEntry(testDir, 'user', 'Second entry');

      expect(result.success).toBe(true);
      const content = readFileSync(userPath(), 'utf-8');
      expect(content).toBe('- First entry\n- Second entry');
    });

    test('rejects empty content', async () => {
      const result = await addEntry(testDir, 'user', '');
      expect(result.success).toBe(false);
      expect(result.error).toContain('empty');
    });

    test('rejects whitespace-only content', async () => {
      const result = await addEntry(testDir, 'user', '   ');
      expect(result.success).toBe(false);
    });

    test('rejects exact duplicate', async () => {
      writeMemoryFile('user', '- Prefers concise answers.');
      const result = await addEntry(testDir, 'user', 'Prefers concise answers.');

      expect(result.success).toBe(false);
      expect(result.error).toContain('duplicate');
    });

    test('rejects when char limit exceeded', async () => {
      const longContent = 'x'.repeat(USER_CHAR_LIMIT + 1);
      const result = await addEntry(testDir, 'user', longContent);

      expect(result.success).toBe(false);
      expect(result.error).toContain('full');
    });

    test('trims content whitespace', async () => {
      const result = await addEntry(testDir, 'user', '  Trimmed entry  ');

      expect(result.success).toBe(true);
      expect(result.result!.entry).toBe('Trimmed entry');
    });
  });

  // ── replaceEntry ─────────────────────────────────────────────

  describe('replaceEntry', () => {
    test('replaces matching entry', async () => {
      writeMemoryFile('memory', '- Old fact\n- Other fact');
      const result = await replaceEntry(testDir, 'memory', 'Old fact', 'New fact');

      expect(result.success).toBe(true);
      expect(result.result!.action).toBe('replace');
      expect(result.result!.entry).toBe('New fact');

      const content = readFileSync(memoryPath(), 'utf-8');
      expect(content).toBe('- New fact\n- Other fact');
    });

    test('rejects when no match found', async () => {
      writeMemoryFile('memory', '- Some fact');
      const result = await replaceEntry(testDir, 'memory', 'nonexistent', 'New fact');

      expect(result.success).toBe(false);
      expect(result.error).toContain('No entry found');
    });

    test('rejects when multiple matches found', async () => {
      writeMemoryFile('memory', '- Common prefix A\n- Common prefix B');
      const result = await replaceEntry(testDir, 'memory', 'Common prefix', 'New');

      expect(result.success).toBe(false);
      expect(result.error).toContain('Multiple entries match');
    });

    test('rejects empty new content', async () => {
      writeMemoryFile('memory', '- Old fact');
      const result = await replaceEntry(testDir, 'memory', 'Old fact', '');

      expect(result.success).toBe(false);
      expect(result.error).toContain('empty');
    });

    test('rejects when file does not exist', async () => {
      const result = await replaceEntry(testDir, 'memory', 'Old', 'New');

      expect(result.success).toBe(false);
      expect(result.error).toContain('does not exist');
    });

    test('rejects when replacement exceeds char limit', async () => {
      writeMemoryFile('user', `- short`);
      const result = await replaceEntry(testDir, 'user', 'short', 'y'.repeat(USER_CHAR_LIMIT + 1));

      expect(result.success).toBe(false);
      expect(result.error).toContain('full');
    });

    test('rejects empty oldText since it matches all entries', async () => {
      writeMemoryFile('memory', '- Fact A\n- Fact B');
      const result = await replaceEntry(testDir, 'memory', '', 'New');
      expect(result.success).toBe(false);
      expect(result.error).toContain('Multiple');
    });
  });

  // ── removeEntry ──────────────────────────────────────────────

  describe('removeEntry', () => {
    test('removes matching entry', async () => {
      writeMemoryFile('memory', '- Keep this\n- Remove this\n- Keep that');
      const result = await removeEntry(testDir, 'memory', 'Remove this');

      expect(result.success).toBe(true);
      expect(result.result!.action).toBe('remove');

      const content = readFileSync(memoryPath(), 'utf-8');
      expect(content).toBe('- Keep this\n- Keep that');
    });

    test('removes the only entry leaving empty content', async () => {
      writeMemoryFile('memory', '- Only entry');
      const result = await removeEntry(testDir, 'memory', 'Only entry');

      expect(result.success).toBe(true);
      const content = readFileSync(memoryPath(), 'utf-8');
      expect(content).toBe('');
    });

    test('rejects when no match found', async () => {
      writeMemoryFile('memory', '- Some fact');
      const result = await removeEntry(testDir, 'memory', 'nonexistent');

      expect(result.success).toBe(false);
      expect(result.error).toContain('No entry found');
    });

    test('rejects when multiple matches found', async () => {
      writeMemoryFile('memory', '- Shared text A\n- Shared text B');
      const result = await removeEntry(testDir, 'memory', 'Shared text');

      expect(result.success).toBe(false);
      expect(result.error).toContain('Multiple entries match');
    });

    test('rejects when file does not exist', async () => {
      const result = await removeEntry(testDir, 'memory', 'something');

      expect(result.success).toBe(false);
      expect(result.error).toContain('does not exist');
    });
  });

  // ── loadMemoryInstructions ───────────────────────────────────

  describe('loadMemoryInstructions', () => {
    test('returns null when no memory files exist', async () => {
      const result = await loadMemoryInstructions(testDir);
      expect(result).toBeNull();
    });

    test('returns only user section when only user file exists', async () => {
      writeMemoryFile('user', '- User pref');
      const result = await loadMemoryInstructions(testDir);

      expect(result).not.toBeNull();
      expect(result!).toContain('<user_memory');
      expect(result!).not.toContain('<workspace_memory');
    });

    test('returns only workspace section when only memory file exists', async () => {
      writeMemoryFile('memory', '- Workspace fact');
      const result = await loadMemoryInstructions(testDir);

      expect(result).not.toBeNull();
      expect(result!).not.toContain('<user_memory');
      expect(result!).toContain('<workspace_memory');
    });

    test('returns both sections when both files exist', async () => {
      writeMemoryFile('user', '- User pref');
      writeMemoryFile('memory', '- Workspace fact');
      const result = await loadMemoryInstructions(testDir);

      expect(result).not.toBeNull();
      expect(result!).toContain('<user_memory');
      expect(result!).toContain('<workspace_memory');
    });

    test('includes usage info in sections', async () => {
      writeMemoryFile('user', '- Short');
      const result = await loadMemoryInstructions(testDir);

      expect(result).toContain('usage="');
      expect(result).toContain('/1500');
    });
  });

  // ── formatEntriesForDisplay ──────────────────────────────────

  describe('formatEntriesForDisplay', () => {
    test('formats entries with numeric indices', () => {
      const { formatEntriesForDisplay } = require('@capekai/core/compat/jean2');
      const result = formatEntriesForDisplay(['- Alpha', '- Beta', '- Gamma']);
      expect(result).toEqual(['[0] Alpha', '[1] Beta', '[2] Gamma']);
    });

    test('returns empty array for no entries', () => {
      const { formatEntriesForDisplay } = require('@capekai/core/compat/jean2');
      const result = formatEntriesForDisplay([]);
      expect(result).toEqual([]);
    });
  });

  // ── listEntries ──────────────────────────────────────────────

  describe('listEntries', () => {
    test('returns empty entries for non-existent file', async () => {
      const { listEntries } = require('@capekai/core/compat/jean2');
      const result = await listEntries(testDir, 'memory');
      expect(result.success).toBe(true);
      expect(result.result.entries).toEqual([]);
      expect(result.result.usage.chars).toBe(0);
      expect(result.result.usage.limit).toBe(MEMORY_CHAR_LIMIT);
    });

    test('returns formatted entries with usage', async () => {
      const { listEntries } = require('@capekai/core/compat/jean2');
      writeMemoryFile('memory', '- First\n- Second');
      const result = await listEntries(testDir, 'memory');
      expect(result.success).toBe(true);
      expect(result.result.entries).toEqual(['[0] First', '[1] Second']);
      expect(result.result.usage.chars).toBeGreaterThan(0);
    });
  });
});
