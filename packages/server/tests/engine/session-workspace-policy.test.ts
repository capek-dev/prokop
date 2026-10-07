import { describe, expect, test } from 'bun:test';
import type { ToolDefinition } from '@prokopai/sdk/tool';
import type { RuntimeHost, SessionWorkspaceContext, ToolPolicyHost } from '@/infrastructure/runtime/host';
import { buildExternalTools } from '@/harnesses/prokop/execution/tool-builders/external-tools';
import { withToolRegistryResolver } from '@/infrastructure/tools/registry';
import type { RuntimeHost as InternalRuntimeHost } from '@/infrastructure/runtime/host';
import { withRuntimeHost } from '@/infrastructure/runtime/host';
import {
  resolveSessionWorkspace,
  resolveToolDefinition,
} from '@/infrastructure/runtime/host-dependencies';

function host(overrides: Partial<InternalRuntimeHost>): InternalRuntimeHost {
  return {
    interaction: {} as InternalRuntimeHost['interaction'],
    delivery: { emit: () => {} },
    titles: {} as InternalRuntimeHost['titles'],
    workspace: {
      createToolWorkspaceHost: () => ({ tempDir: '/tmp/capek-test' }),
    },
    sandbox: { isSandboxActive: () => false },
    ...overrides,
  };
}

describe('session workspace host policy', () => {
  test('keeps the supplied workspace context when the host has no resolver', async () => {
    const result = await withRuntimeHost(host({}), () => resolveSessionWorkspace({
      sessionId: 'session-1',
      workspaceId: 'workspace-1',
      workspacePath: '/workspace',
      additionalPaths: ['/shared'],
    }));

    expect(result).toEqual({
      workspacePath: '/workspace',
      additionalPaths: ['/shared'],
    });
  });

  test('fails closed when an opaque root has no host resolver', async () => {
    await expect(withRuntimeHost(host({}), () => resolveSessionWorkspace({
      sessionId: 'session-1',
      workspaceRootId: 'root-1',
      workspacePath: '/workspace',
    }))).rejects.toThrow('Session workspace root requires a host resolver');
  });

  test('lets the host resolve an opaque session root without exposing sibling roots', async () => {
    const result = await withRuntimeHost(host({
      workspace: {
        resolveSessionWorkspace: async ({ workspaceRootId }) => ({
          workspacePath: `/managed/${workspaceRootId}`,
          additionalPaths: [],
        }),
        createToolWorkspaceHost: () => ({ tempDir: '/tmp/capek-test' }),
      },
    }), () => resolveSessionWorkspace({
      sessionId: 'session-1',
      workspaceId: 'workspace-1',
      workspaceRootId: 'root-1',
      workspacePath: '/workspace',
      additionalPaths: ['/sibling'],
    }));

    expect(result).toEqual({
      workspacePath: '/managed/root-1',
      additionalPaths: [],
    });
  });

  test('lets the host hide or narrow a model-visible tool definition', async () => {
    const definition = {
      name: 'git-worktree',
      description: 'Manage worktrees',
      inputSchema: { type: 'object' },
    } as const;
    const restricted = host({
      toolPolicy: {
        resolveDefinition: ({ workspaceRootId, definition: candidate }) => (
          workspaceRootId ? null : { ...candidate, description: 'Create a managed worktree' }
        ),
      },
    });

    const hidden = await withRuntimeHost(restricted, () => resolveToolDefinition({
      sessionId: 'session-1',
      workspaceRootId: 'root-1',
      definition,
    }));
    const narrowed = await withRuntimeHost(restricted, () => resolveToolDefinition({
      sessionId: 'session-2',
      definition,
    }));

    expect(hidden).toBeNull();
    expect(narrowed?.description).toBe('Create a managed worktree');
  });

  test('applies host tool policy while building registry tools', async () => {
    const definition: ToolDefinition = {
      name: 'git-worktree',
      description: 'Manage worktrees',
      inputSchema: { type: 'object' },
    };
    const loadedTool = {
      definition,
      path: 'builtin:test',
      execute: async () => ({ success: true, result: {} }),
    };
    const tools = await withRuntimeHost(host({
      toolPolicy: {
        resolveDefinition: ({ workspaceRootId, definition: candidate }) => (
          workspaceRootId ? null : candidate
        ),
      },
    }), () => withToolRegistryResolver({
      get: (name) => name === definition.name ? loadedTool : null,
      list: () => [loadedTool],
    }, () => buildExternalTools({
      toolNames: [definition.name],
      broadcast: () => {},
      sessionId: 'session-1',
      workspaceId: 'workspace-1',
      workspacePath: '/managed/root-1',
      workspaceRootId: 'root-1',
      rootSessionId: 'session-1',
      executionScopes: new Set(),
    })));

    expect(tools[definition.name]).toBeUndefined();
  });
});

const publicHostTypeCheck: RuntimeHost | SessionWorkspaceContext | ToolPolicyHost | null = null;
void publicHostTypeCheck;
