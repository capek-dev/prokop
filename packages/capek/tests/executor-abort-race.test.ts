import { describe, expect, test } from 'bun:test';
import { executeTool } from '../src/tools/executor';
import type { LoadedTool, ToolContext, ToolResult } from '@capekai/tool';
import { createWorkspaceCapability } from '../src/workspace/policy';

// ---------------------------------------------------------------------------
// Regression: a tool that never settles (blocked on ctx.ask(), an external
// process, or simply ignoring its abort signal) must not block the executor
// after the session abort signal fires. Before the fix the race only
// included the execute promise and the timeout promise, so an aborting tool
// kept the AI SDK step hanging and the session stayed "running".
// ---------------------------------------------------------------------------

function neverSettlingTool(timeout?: number | null): LoadedTool {
  const execute = async (_input: unknown, ctx: ToolContext): Promise<ToolResult> => {
    ctx.abortSignal?.throwIfAborted();
    return await new Promise<ToolResult>(() => {});
  };
  return {
    definition: {
      name: 'never-settles',
      description: 'Tool that ignores its abort signal',
      inputSchema: { type: 'object', properties: {} },
      timeout,
    },
    execute,
    path: 'virtual://never-settles',
  };
}

describe('executeTool abort race', () => {
  const workspace = createWorkspaceCapability({
    root: '/tmp/capek-test',
    tempDir: '/tmp/capek-test/tmp',
    additionalRoots: [],
    allowedRoots: ['/tmp/capek-test'],
  });

  test('aborting the signal settles the race even when the tool never settles', async () => {
    const controller = new AbortController();

    const pending = executeTool({
      tool: neverSettlingTool(),
      args: {},
      workspace,
      sessionId: 'session',
      abortSignal: controller.signal,
      timeout: 10_000,
    });

    await Bun.sleep(20);
    controller.abort();

    const result = await Promise.race([
      pending,
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error('executor did not settle after abort')), 2000)),
    ]);

    expect(result.success).toBe(false);
    expect(result.error).toBe('Tool execution interrupted');
  });

  test('already-aborted signal settles the execute race immediately', async () => {
    const controller = new AbortController();
    controller.abort();

    const result = await executeTool({
      tool: neverSettlingTool(10_000),
      args: {},
      workspace,
      sessionId: 'session',
      abortSignal: controller.signal,
      timeout: 10_000,
    });

    expect(result.success).toBe(false);
    expect(result.error).toBe('Tool execution interrupted');
  });

  test('null timeout arms no deadline and a slow tool still completes', async () => {
    let resolved = false;
    const tool: LoadedTool = {
      definition: {
        name: 'slow-tool',
        description: 'Would exceed any short deadline',
        inputSchema: { type: 'object', properties: {} },
        timeout: null,
      },
      execute: async () => {
        await Bun.sleep(150);
        resolved = true;
        return { success: true, result: { ok: true } };
      },
      path: 'virtual://slow-tool',
    };

    const result = await executeTool({
      tool,
      args: {},
      workspace,
      sessionId: 'session',
    });

    expect(result.success).toBe(true);
    expect(resolved).toBe(true);
  });

  test('explicit null option timeout does not arm a zero-delay timer', async () => {
    // Old behavior: `setTimeout(fn, null)` fires immediately, so passing null
    // timed the tool out on the next tick. null must skip the timer entirely
    // and let the tool run to completion.
    let resolved = false;
    const tool: LoadedTool = {
      definition: {
        name: 'slow-tool',
        description: 'Completes after a delay',
        inputSchema: { type: 'object', properties: {} },
      },
      execute: async () => {
        await Bun.sleep(150);
        resolved = true;
        return { success: true, result: { ok: true } };
      },
      path: 'virtual://slow-tool',
    };

    const result = await executeTool({
      tool,
      args: {},
      workspace,
      sessionId: 'session',
      timeout: null,
    });

    expect(result.success).toBe(true);
    expect(resolved).toBe(true);
  });
});
