import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import type { ToolContext, ToolResult } from '@prokopai/sdk';
import { execute, definition } from './tool';

type Ask = Parameters<ToolContext['ask']>[0];

let dir: string;

function makeContext(overrides: Partial<ToolContext> = {}): ToolContext {
  return {
    sessionId: 'test-session',
    workspacePath: dir,
    resolvePath: (p: string) => join(dir, p.replace(dir, '').replace(/^\//, '')),
    isWithinWorkspace: (p: string) => p.startsWith(dir),
    isSensitivePath: (p: string) => p.includes('.env') || p.includes('.pem') || p.includes('.key'),
    isBlockedPath: (p: string) => p.startsWith('/System') || p.startsWith('/usr') || p.startsWith('/etc'),
    fs: {
      exists: async (p: string) => p.startsWith(dir),
      readFile: async (_p: string) => Bun.file(_p).text(),
      writeFile: async (p: string, content: string) => { await Bun.write(p, content); },
      stat: async (_p: string) => ({ isDirectory: false, isFile: true, size: 0 }),
    },
    env: { get: (_k: string) => undefined },
    logger: { error: () => {}, warn: () => {}, info: () => {} },
    ask: async (_a: Ask) => true,
    ...overrides,
  } as ToolContext;
}

function revisionOf(content: string): string {
  const hash = createHash('sha256');
  hash.update(content);
  return `sha256:${hash.digest('hex')}`;
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'edit-tool-test-'));
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

const SAMPLE = ['line one', 'line two', 'line three', 'line four', 'line five'].join('\n') + '\n';

async function run(input: unknown, ctx = makeContext()): Promise<ToolResult> {
  return execute(input as never, ctx);
}

describe('edit tool (merged string + range modes)', () => {
  test('applies a single string-mode edit', async () => {
    const file = join(dir, 'a.txt');
    writeFileSync(file, SAMPLE);
    const result = await run({ path: file, edits: [{ oldString: 'line two', newString: 'LINE TWO' }] });
    expect(result.success).toBe(true);
    expect(await Bun.file(file).text()).toContain('LINE TWO');
  });

  test('applies multiple string-mode edits atomically in sequence', async () => {
    const file = join(dir, 'a.txt');
    writeFileSync(file, SAMPLE);
    const result = await run({
      path: file,
      edits: [
        { oldString: 'line one', newString: 'first' },
        { oldString: 'line five', newString: 'fifth' },
      ],
    });
    expect(result.success).toBe(true);
    const content = await Bun.file(file).text();
    expect(content).toContain('first');
    expect(content).toContain('fifth');
  });

  test('applies a range-mode edit by line numbers', async () => {
    const file = join(dir, 'a.txt');
    writeFileSync(file, SAMPLE);
    const result = await run({
      path: file,
      edits: [{ startLine: 2, endLine: 3, newString: 'replaced' }],
    });
    expect(result.success).toBe(true);
    const content = await Bun.file(file).text();
    expect(content).toBe('line one\nreplaced\nline four\nline five\n');
  });

  test('mixes string and range edits in one call, range lines referring to post-edit content', async () => {
    const file = join(dir, 'a.txt');
    writeFileSync(file, SAMPLE);
    const result = await run({
      path: file,
      edits: [
        { oldString: 'line one', newString: 'zero\none' },
        { startLine: 3, endLine: 3, newString: 'THREE' },
      ],
    });
    expect(result.success).toBe(true);
    const content = await Bun.file(file).text();
    // After edit 0: zero\none\nline two\nline three\n... so line 3 is 'line two'
    expect(content).toBe('zero\none\nTHREE\nline three\nline four\nline five\n');
  });

  test('rejects mixing oldString with startLine in one item', async () => {
    const file = join(dir, 'a.txt');
    writeFileSync(file, SAMPLE);
    const result = await run({
      path: file,
      edits: [{ oldString: 'line one', startLine: 1, endLine: 2, newString: 'x' }],
    });
    expect(result.success).toBe(false);
    expect(result.error).toContain('mixes oldString with startLine');
  });

  test('rejects range edits beyond the current line count', async () => {
    const file = join(dir, 'a.txt');
    writeFileSync(file, SAMPLE);
    const result = await run({
      path: file,
      edits: [{ startLine: 1, endLine: 99, newString: 'x' }],
    });
    expect(result.success).toBe(false);
    expect(result.error).toContain('exceeds the current line count');
  });

  test('checks the revision and rejects stale content', async () => {
    const file = join(dir, 'a.txt');
    writeFileSync(file, SAMPLE);
    const staleRevision = revisionOf('different content');
    const result = await run({
      path: file,
      revision: staleRevision,
      edits: [{ oldString: 'line one', newString: 'x' }],
    });
    expect(result.success).toBe(false);
    expect((result.result as { code?: string }).code).toBe('STALE_REVISION');
  });

  test('accepts the matching revision and applies the edit', async () => {
    const file = join(dir, 'a.txt');
    writeFileSync(file, SAMPLE);
    const result = await run({
      path: file,
      revision: revisionOf(SAMPLE),
      edits: [{ oldString: 'line one', newString: 'x' }],
    });
    expect(result.success).toBe(true);
  });

  test('an empty range newString deletes the range lines', async () => {
    const file = join(dir, 'a.txt');
    writeFileSync(file, SAMPLE);
    const result = await run({
      path: file,
      edits: [{ startLine: 2, endLine: 4, newString: '' }],
    });
    expect(result.success).toBe(true);
    expect(await Bun.file(file).text()).toBe('line one\nline five\n');
  });

  test('fails atomically when a later string edit has no match', async () => {
    const file = join(dir, 'a.txt');
    writeFileSync(file, SAMPLE);
    const result = await run({
      path: file,
      edits: [
        { oldString: 'line one', newString: 'first' },
        { oldString: 'nonexistent', newString: 'x' },
      ],
    });
    expect(result.success).toBe(false);
    expect((result.result as { editIndex?: number }).editIndex).toBe(1);
    expect(await Bun.file(file).text()).toBe(SAMPLE);
  });

  test('produces a diffs visualization covering every edit', async () => {
    const file = join(dir, 'a.txt');
    writeFileSync(file, SAMPLE);
    const result = await run({
      path: file,
      edits: [
        { oldString: 'line one', newString: 'first' },
        { startLine: 4, endLine: 5, newString: 'last' },
      ],
    });
    expect(result.success).toBe(true);
    const visualization = result.visualization as { type: string; items: unknown[] };
    expect(visualization.type).toBe('diffs');
    expect(visualization.items).toHaveLength(2);
  });

  test('rejects binary content', async () => {
    const file = join(dir, 'bin.dat');
    writeFileSync(file, 'text\x00binary');
    const result = await run({
      path: file,
      edits: [{ oldString: 'text', newString: 'x' }],
    });
    expect(result.success).toBe(false);
    expect(result.error).toContain('binary');
  });

  test('definition names the merged tool with the union schema', () => {
    expect(definition.name).toBe('edit');
    const schema = definition.inputSchema as { properties: Record<string, { properties?: Record<string, unknown> }> };
    const editItems = schema.properties.edits as { items: { properties: Record<string, unknown> } };
    expect(editItems.items.properties.oldString).toBeDefined();
    expect(editItems.items.properties.startLine).toBeDefined();
    expect(editItems.items.properties.endLine).toBeDefined();
    expect(schema.properties.revision).toBeDefined();
  });
});
