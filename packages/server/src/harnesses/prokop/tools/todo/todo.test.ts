import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { resolveToolSummary, type ToolContext, type ToolResult } from '@prokopai/sdk';
import { execute, definition } from './tool';

type Ask = Parameters<ToolContext['ask']>[0];

let dir: string;
let dbPath: string;

function makeContext(): ToolContext {
  return {
    sessionId: 'test-session',
    workspacePath: dir,
    resolvePath: (p: string) => p,
    isWithinWorkspace: (_p: string) => true,
    isSensitivePath: () => false,
    isBlockedPath: () => false,
    fs: {
      exists: async () => true,
      readFile: async () => '',
      writeFile: async () => {},
      stat: async () => ({ isDirectory: false, isFile: true, size: 0 }),
    },
    env: { get: (k: string) => (k === 'TODOS_DB_PATH' ? dbPath : undefined) },
    logger: { error: () => {}, warn: () => {}, info: () => {} },
    ask: async (_a: Ask) => true,
  } as unknown as ToolContext;
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'todo-tool-test-'));
  dbPath = join(dir, 'todos.db');
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

async function run(input: unknown): Promise<ToolResult> {
  return execute(input as never, makeContext());
}

describe('todo tool (merged read + write)', () => {
  test('reads an empty list when called without todos', async () => {
    const result = await run({});
    expect(result.success).toBe(true);
    expect((result.result as { todos: unknown[] }).todos).toEqual([]);
  });

  test('writes a list and returns the persisted state', async () => {
    const result = await run({
      todos: [
        { content: 'Task A', status: 'pending', priority: 'high' },
        { content: 'Task B', status: 'in_progress' },
      ],
    });
    expect(result.success).toBe(true);
    const state = result.result as { todos: Array<{ content: string; status: string; priority: string }>; written: number };
    expect(state.written).toBe(2);
    expect(state.todos).toHaveLength(2);
    expect(state.todos[0]).toMatchObject({ content: 'Task A', status: 'pending', priority: 'high' });
    expect(state.todos[1]).toMatchObject({ content: 'Task B', status: 'in_progress', priority: 'medium' });
  });

  test('a subsequent read returns the written list', async () => {
    await run({ todos: [{ content: 'Only task', status: 'pending' }] });
    const read = await run({});
    const state = read.result as { todos: Array<{ content: string }> };
    expect(state.todos).toHaveLength(1);
    expect(state.todos[0].content).toBe('Only task');
  });

  test('writing again replaces the list', async () => {
    await run({ todos: [{ content: 'Old', status: 'completed' }] });
    await run({ todos: [{ content: 'New', status: 'pending' }] });
    const read = await run({});
    const state = read.result as { todos: Array<{ content: string }> };
    expect(state.todos).toHaveLength(1);
    expect(state.todos[0].content).toBe('New');
  });

  test('validates item status and priority', async () => {
    const badStatus = await run({ todos: [{ content: 'X', status: 'bogus' }] });
    expect(badStatus.success).toBe(false);
    expect(badStatus.error).toContain('status');

    const badPriority = await run({ todos: [{ content: 'X', status: 'pending', priority: 'urgent' }] });
    expect(badPriority.success).toBe(false);
    expect(badPriority.error).toContain('priority');
  });

  test('produces a todo-list visualization in both modes', async () => {
    const read = await run({});
    expect((read.visualization as { type: string }).type).toBe('todo-list');

    const write = await run({ todos: [{ content: 'X', status: 'pending' }] });
    expect((write.visualization as { type: string }).type).toBe('todo-list');
  });

  test('definition names the merged tool with optional todos', () => {
    expect(definition.name).toBe('todo');
    const schema = definition.inputSchema as { properties: Record<string, unknown>; required?: string[] };
    expect(schema.properties.todos).toBeDefined();
    expect(schema.required).toBeUndefined();
  });

  test('display summary resolves for both read and write calls', () => {
    const template = definition.display?.summary;
    expect(resolveToolSummary({}, template)).toBe('todos');
    expect(resolveToolSummary({ todos: [{ content: 'a', status: 'pending' }, { content: 'b', status: 'pending' }] }, template))
      .toBe('2 todos');
  });
});
