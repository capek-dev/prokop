import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import type { PermissionAsk } from '@jean2/sdk';
import { mkdtempSync, rmSync, readFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

import { executeMemoryTool } from '@capekai/core/internal/hosts';

describe('memory tool', () => {
  let testDir: string;

  beforeEach(() => {
    testDir = mkdtempSync(join(tmpdir(), 'jean2-memory-tool-test-'));
  });

  afterEach(() => {
    rmSync(testDir, { recursive: true, force: true });
  });

  // ── Validation ───────────────────────────────────────────────

  describe('input validation', () => {
    test('rejects invalid action', async () => {
      const result = await executeMemoryTool(
        { action: 'invalid', target: 'user', content: 'test' },
        testDir,
        'none',
      );
      expect(result.success).toBe(false);
      expect(result.error).toContain('Invalid action');
    });

    test('rejects invalid target', async () => {
      const result = await executeMemoryTool(
        { action: 'add', target: 'invalid', content: 'test' },
        testDir,
        'none',
      );
      expect(result.success).toBe(false);
      expect(result.error).toContain('Invalid target');
    });

    test('rejects missing action', async () => {
      const result = await executeMemoryTool(
        { target: 'user', content: 'test' },
        testDir,
        'none',
      );
      expect(result.success).toBe(false);
    });

    test('rejects missing target', async () => {
      const result = await executeMemoryTool(
        { action: 'add', content: 'test' },
        testDir,
        'none',
      );
      expect(result.success).toBe(false);
    });
  });

  // ── List action ──────────────────────────────────────────────

  describe('list', () => {
    test('returns empty list when no entries exist', async () => {
      const result = await executeMemoryTool(
        { action: 'list', target: 'memory' },
        testDir,
        'none',
      );
      expect(result.success).toBe(true);
      expect(result.result!.action).toBe('list');
      expect(result.result!.entries).toEqual([]);
      expect(result.result!.usage!.chars).toBe(0);
    });

    test('returns formatted entries with usage', async () => {
      await executeMemoryTool(
        { action: 'add', target: 'memory', content: 'First fact' },
        testDir,
        'none',
      );
      await executeMemoryTool(
        { action: 'add', target: 'memory', content: 'Second fact' },
        testDir,
        'none',
      );

      const result = await executeMemoryTool(
        { action: 'list', target: 'memory' },
        testDir,
        'none',
      );
      expect(result.success).toBe(true);
      expect(result.result!.entries).toHaveLength(2);
      expect(result.result!.entries![0]).toBe('[0] First fact');
      expect(result.result!.entries![1]).toBe('[1] Second fact');
      expect(result.result!.usage!.chars).toBeGreaterThan(0);
      expect(result.result!.usage!.limit).toBe(2500);
    });

    test('list is read-only and does not trigger permission ask', async () => {
      let askCalled = false;
      const askFn = async () => { askCalled = true; return true; };

      await executeMemoryTool(
        { action: 'list', target: 'memory' },
        testDir,
        'high',
        askFn,
      );
      expect(askCalled).toBe(false);
    });

    test('list works for both targets', async () => {
      await executeMemoryTool(
        { action: 'add', target: 'user', content: 'User pref' },
        testDir,
        'none',
      );

      const userResult = await executeMemoryTool(
        { action: 'list', target: 'user' },
        testDir,
        'none',
      );
      expect(userResult.success).toBe(true);
      expect(userResult.result!.entries).toHaveLength(1);
      expect(userResult.result!.usage!.limit).toBe(1500);
    });
  });

  // ── Add action ───────────────────────────────────────────────

  describe('add', () => {
    test('adds entry successfully', async () => {
      const result = await executeMemoryTool(
        { action: 'add', target: 'memory', content: 'Test fact' },
        testDir,
        'none',
      );

      expect(result.success).toBe(true);
      expect(result.result!.action).toBe('add');
      expect(result.result!.entry).toBe('Test fact');
    });

    test('rejects add without content', async () => {
      const result = await executeMemoryTool(
        { action: 'add', target: 'memory' },
        testDir,
        'none',
      );

      expect(result.success).toBe(false);
      expect(result.error).toContain('required');
    });
  });

  // ── Replace action ───────────────────────────────────────────

  describe('replace', () => {
    test('replaces entry successfully', async () => {
      await executeMemoryTool(
        { action: 'add', target: 'memory', content: 'Old fact' },
        testDir,
        'none',
      );

      const result = await executeMemoryTool(
        { action: 'replace', target: 'memory', oldText: 'Old fact', content: 'New fact' },
        testDir,
        'none',
      );

      expect(result.success).toBe(true);
      expect(result.result!.action).toBe('replace');
      expect(result.result!.entry).toBe('New fact');
    });

    test('rejects replace without oldText', async () => {
      const result = await executeMemoryTool(
        { action: 'replace', target: 'memory', content: 'New' },
        testDir,
        'none',
      );

      expect(result.success).toBe(false);
      expect(result.error).toContain('oldText');
    });

    test('no-match error returns numbered entries and list hint', async () => {
      await executeMemoryTool(
        { action: 'add', target: 'memory', content: 'Alpha fact' },
        testDir,
        'none',
      );
      await executeMemoryTool(
        { action: 'add', target: 'memory', content: 'Beta fact' },
        testDir,
        'none',
      );

      const result = await executeMemoryTool(
        { action: 'replace', target: 'memory', oldText: 'nonexistent', content: 'New' },
        testDir,
        'none',
      );

      expect(result.success).toBe(false);
      expect(result.error).toContain('list action');
      expect(result.entries).toContain('[0] Alpha fact');
      expect(result.entries).toContain('[1] Beta fact');
    });

    test('rejects replace without content', async () => {
      await executeMemoryTool(
        { action: 'add', target: 'memory', content: 'Fact' },
        testDir,
        'none',
      );

      const result = await executeMemoryTool(
        { action: 'replace', target: 'memory', oldText: 'Fact' },
        testDir,
        'none',
      );

      expect(result.success).toBe(false);
      expect(result.error).toContain('required');
    });
  });

  // ── Remove action ────────────────────────────────────────────

  describe('remove', () => {
    test('removes entry successfully', async () => {
      await executeMemoryTool(
        { action: 'add', target: 'memory', content: 'To remove' },
        testDir,
        'none',
      );

      const result = await executeMemoryTool(
        { action: 'remove', target: 'memory', oldText: 'To remove' },
        testDir,
        'none',
      );

      expect(result.success).toBe(true);
      expect(result.result!.action).toBe('remove');
    });

    test('rejects remove without oldText', async () => {
      const result = await executeMemoryTool(
        { action: 'remove', target: 'memory' },
        testDir,
        'none',
      );

      expect(result.success).toBe(false);
      expect(result.error).toContain('oldText');
    });

    test('no-match error includes consolidation hint and numbered entries', async () => {
      await executeMemoryTool(
        { action: 'add', target: 'memory', content: 'Fact one' },
        testDir,
        'none',
      );

      const result = await executeMemoryTool(
        { action: 'remove', target: 'memory', oldText: 'nonexistent' },
        testDir,
        'none',
      );

      expect(result.success).toBe(false);
      expect(result.error).toContain('list action');
      expect(result.entries).toContain('[0] Fact one');
    });
  });

  // ── Char limit / consolidation ───────────────────────────────

  describe('char limits and consolidation hints', () => {
    test('add overflow includes char usage and consolidation hint', async () => {
      const longContent = 'x'.repeat(2501);
      const result = await executeMemoryTool(
        { action: 'add', target: 'memory', content: longContent },
        testDir,
        'none',
      );

      expect(result.success).toBe(false);
      expect(result.error).toContain('full');
      expect(result.error).toContain('merging');
      expect(result.usage!.limit).toBe(2500);
    });
  });

  // ── Permission flow ──────────────────────────────────────────

  describe('permissions', () => {
    test('skips permission ask when risk is none', async () => {
      let askCalled = false;
      const askFn = async () => { askCalled = true; return true; };

      const result = await executeMemoryTool(
        { action: 'add', target: 'memory', content: 'Fact' },
        testDir,
        'none',
        askFn,
      );

      expect(result.success).toBe(true);
      expect(askCalled).toBe(false);
    });

    test('calls askFn when risk is set', async () => {
      let askCalled = false;
      const askFn = async () => { askCalled = true; return true; };

      const result = await executeMemoryTool(
        { action: 'add', target: 'memory', content: 'Fact' },
        testDir,
        'medium',
        askFn,
      );

      expect(result.success).toBe(true);
      expect(askCalled).toBe(true);
    });

    test('rejects when askFn returns false', async () => {
      const askFn = async () => false;

      const result = await executeMemoryTool(
        { action: 'add', target: 'memory', content: 'Fact' },
        testDir,
        'high',
        askFn,
      );

      expect(result.success).toBe(false);
      expect(result.error).toBe('USER_REJECTION');
    });

    test('passes correct permission ask structure', async () => {
      let capturedAsk: PermissionAsk | undefined;
      const askFn = async (ask: PermissionAsk) => { capturedAsk = ask; return true; };

      await executeMemoryTool(
        { action: 'add', target: 'user', content: 'Pref' },
        testDir,
        'medium',
        askFn,
      );

      expect(capturedAsk).toBeDefined();
      expect(capturedAsk?.type).toBe('permission');
      expect(capturedAsk?.risk).toBe('medium');
      expect(capturedAsk?.resource).toBe('file');
      expect(capturedAsk?.action).toBe('write');
    });
  });

  // ── File operations ──────────────────────────────────────────

  describe('file operations', () => {
    test('creates directory if missing', async () => {
      const result = await executeMemoryTool(
        { action: 'add', target: 'memory', content: 'Fact' },
        testDir,
        'none',
      );

      expect(result.success).toBe(true);
      const { existsSync } = await import('fs');
      expect(existsSync(join(testDir, 'MEMORY.md'))).toBe(true);
    });

    test('writes to user file for user target', async () => {
      await executeMemoryTool(
        { action: 'add', target: 'user', content: 'User pref' },
        testDir,
        'none',
      );

      const content = readFileSync(join(testDir, 'USER.md'), 'utf-8');
      expect(content).toBe('- User pref');
    });

    test('writes to memory file for memory target', async () => {
      await executeMemoryTool(
        { action: 'add', target: 'memory', content: 'Workspace fact' },
        testDir,
        'none',
      );

      const content = readFileSync(join(testDir, 'MEMORY.md'), 'utf-8');
      expect(content).toBe('- Workspace fact');
    });
  });
});
