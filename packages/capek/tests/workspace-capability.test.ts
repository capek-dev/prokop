import { afterEach, describe, expect, test } from 'bun:test';
import { mkdtempSync, rmSync } from 'fs';
import { homedir, tmpdir } from 'os';
import { join, resolve } from 'path';
import type { LoadedTool, ToolContext, ToolResult } from '@jean2/sdk';
import { executeTool } from '../src/tools/executor';
import {
  createWorkspaceCapability,
  isLexicallyContained,
} from '../src/workspace/policy';
import type { WorkspaceCapabilityHost } from '../src/workspace/contracts';

const createdDirectories: string[] = [];

function tempRoot(prefix: string): string {
  const path = mkdtempSync(join(tmpdir(), prefix));
  createdDirectories.push(path);
  return path;
}

function host(overrides: Partial<WorkspaceCapabilityHost> = {}): WorkspaceCapabilityHost {
  return {
    root: '/workspace/project',
    additionalRoots: ['/workspace/shared'],
    allowedRoots: ['/uploads'],
    tempDir: tempRoot('capek-workspace-'),
    ...overrides,
  };
}

function loadedTool(execute: (ctx: ToolContext) => Promise<ToolResult>): LoadedTool {
  return {
    definition: {
      name: 'fixture',
      description: 'Fixture tool',
      inputSchema: { type: 'object' },
    },
    execute: async (_input, ctx) => execute(ctx),
    path: '/tools/fixture',
  };
}

afterEach(() => {
  for (const path of createdDirectories.splice(0)) {
    rmSync(path, { recursive: true, force: true });
  }
});

describe('workspace capability policy', () => {
  test('resolves the effective root and additional roots lexically', () => {
    const workspace = createWorkspaceCapability(host());

    expect(workspace.effectiveRoot).toBe(resolve('/workspace/project'));
    expect(workspace.additionalRoots).toEqual([resolve('/workspace/shared')]);
    expect(workspace.resolvePath('src/index.ts')).toBe(resolve('/workspace/project/src/index.ts'));
    expect(workspace.resolvePath('~/file.txt')).toBe(join(homedir(), 'file.txt'));
    expect(workspace.resolvePath('~user/file.txt')).toBe(resolve('/workspace/project/~user/file.txt'));
    expect(workspace.isWithinWorkspace('/workspace/project/src/index.ts')).toBe(true);
    expect(workspace.isWithinWorkspace('/workspace/shared/file.txt')).toBe(true);
    expect(workspace.isWithinWorkspace('/uploads/file.txt')).toBe(false);
  });

  test('falls back to process.cwd when no root is supplied', () => {
    const workspace = createWorkspaceCapability(host({ root: undefined }));

    expect(workspace.effectiveRoot).toBe(resolve(process.cwd()));
    expect(workspace.resolvePath('file.txt')).toBe(resolve(process.cwd(), 'file.txt'));
  });

  test('rejects sibling-prefix paths with separator-aware containment', () => {
    expect(isLexicallyContained('/workspace/project/file.txt', '/workspace/project')).toBe(true);
    expect(isLexicallyContained('/workspace/project-other/file.txt', '/workspace/project')).toBe(false);

    const workspace = createWorkspaceCapability(host());
    expect(workspace.isWithinWorkspace('/workspace/project-other/file.txt')).toBe(false);
    expect(workspace.isWithinWorkspace('/workspace/shared-other/file.txt')).toBe(false);
  });

  test('preserves sensitive and case-sensitive blocked classification', () => {
    const workspace = createWorkspaceCapability(host());

    expect(workspace.isSensitivePath('/workspace/project/.ENV.local')).toBe(true);
    expect(workspace.isSensitivePath('/workspace/project/public.txt')).toBe(false);
    expect(workspace.isBlockedPath('/etc/passwd')).toBe(true);
    expect(workspace.isBlockedPath('/ETC/passwd')).toBe(false);
  });

  test('preserves environment overlay precedence and process fallback', () => {
    const key = 'CAPEK_PHASE3_ENV_TEST';
    const previous = process.env[key];
    process.env[key] = 'process';

    try {
      const overlay = createWorkspaceCapability(host({
        getEnvironmentValue: (candidate) => candidate === key ? 'overlay' : undefined,
      }));
      const fallback = createWorkspaceCapability(host());

      expect(overlay.getEnvironmentValue(key)).toBe('overlay');
      expect(fallback.getEnvironmentValue(key)).toBe('process');
    } finally {
      if (previous === undefined) delete process.env[key];
      else process.env[key] = previous;
    }
  });

  test('normalizes add and remove callback paths and denies absent mutation rights', async () => {
    const calls: string[] = [];
    const workspace = createWorkspaceCapability(host({
      addAdditionalRoot: (path) => {
        calls.push(`add:${path}`);
        return true;
      },
      removeAdditionalRoot: (path) => {
        calls.push(`remove:${path}`);
        return true;
      },
    }));

    expect(await workspace.addWorkspacePath('./additional')).toBe(true);
    expect(await workspace.removeWorkspacePath('./additional')).toBe(true);
    expect(calls).toEqual([
      `add:${resolve('./additional')}`,
      `remove:${resolve('./additional')}`,
    ]);

    const immutable = createWorkspaceCapability(host());
    expect(await immutable.addWorkspacePath('/other')).toBe(false);
    expect(await immutable.removeWorkspacePath('/other')).toBe(false);
  });
});

describe('tool executor workspace behavior', () => {
  test('passes allowed upload roots and per-session temporary output', async () => {
    const sessionId = 'session-output';
    const tempDir = join(tmpdir(), 'jean2', sessionId);
    createdDirectories.push(tempDir);
    let captured: ToolContext | undefined;
    const workspace = createWorkspaceCapability(host({
      allowedRoots: ['/upload-root'],
      tempDir,
    }));

    const result = await executeTool({
      tool: loadedTool(async (ctx) => {
        captured = ctx;
        return { success: true };
      }),
      args: {},
      workspace,
      sessionId,
    });

    expect(result.success).toBe(true);
    expect(captured?.allowedPaths).toEqual([resolve('/upload-root')]);
    expect(captured?.fs.tempDir).toBe(tempDir);
  });

  test('returns timeout failure and aborts the tool context', async () => {
    let contextAborted = false;
    const workspace = createWorkspaceCapability(host());
    const result = await executeTool({
      tool: loadedTool((ctx) => new Promise((resolveResult) => {
        ctx.abortSignal.addEventListener('abort', () => {
          contextAborted = true;
          resolveResult({ success: false, error: 'aborted' });
        }, { once: true });
      })),
      args: {},
      workspace,
      sessionId: 'timeout-session',
      timeout: 5,
    });

    expect(result).toEqual({ success: false, error: 'Tool execution timed out after 5ms' });
    expect(contextAborted).toBe(true);
  });

  test('uses the tool definition timeout when no override is supplied', async () => {
    const workspace = createWorkspaceCapability(host());
    const tool = loadedTool((ctx) => new Promise((resolveResult) => {
      ctx.abortSignal.addEventListener('abort', () => {
        resolveResult({ success: false, error: 'aborted' });
      }, { once: true });
    }));
    tool.definition.timeout = 5;

    const result = await executeTool({
      tool,
      args: {},
      workspace,
      sessionId: 'definition-timeout-session',
    });

    expect(result).toEqual({ success: false, error: 'Tool execution timed out after 5ms' });
  });

  test('normalizes a signal aborted before execution starts', async () => {
    const controller = new AbortController();
    controller.abort(new Error('stop'));
    const workspace = createWorkspaceCapability(host());

    const result = await executeTool({
      tool: loadedTool(async (ctx) => {
        if (ctx.abortSignal.aborted) {
          throw ctx.abortSignal.reason;
        }
        return { success: true };
      }),
      args: {},
      workspace,
      sessionId: 'pre-abort-session',
      abortSignal: controller.signal,
    });

    expect(result).toEqual({ success: false, error: 'Tool execution interrupted' });
  });

  test('forwards caller abort and normalizes interruption', async () => {
    const controller = new AbortController();
    const workspace = createWorkspaceCapability(host());
    const execution = executeTool({
      tool: loadedTool((ctx) => new Promise((_, reject) => {
        ctx.abortSignal.addEventListener('abort', () => reject(ctx.abortSignal.reason), { once: true });
      })),
      args: {},
      workspace,
      sessionId: 'abort-session',
      abortSignal: controller.signal,
    });

    controller.abort(new Error('stop'));

    expect(await execution).toEqual({ success: false, error: 'Tool execution interrupted' });
  });
});
