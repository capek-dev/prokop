import { describe, expect, test } from 'bun:test';
import type { Tool } from 'ai';
import {
  createInMemoryStorageBundle,
  getToolOutputArtifactPage,
  withStorage,
} from '@capekai/core/storage';
import {
  applyToolOutputPolicy,
  isToolOutputArtifactReference,
  RETRIEVE_TOOL_OUTPUT_NAME,
  TOOL_OUTPUT_PREVIEW_CHARS,
  TOOL_OUTPUT_THRESHOLD_CHARS,
  wrapToolsWithOutputPolicy,
} from '../src/tool-output/policy';

function policyContext(toolName = 'synthetic') {
  return {
    sessionId: 'session-1',
    workspaceId: 'workspace-1',
    toolCallId: 'call-1',
    toolName,
  };
}

describe('tool output artifact policy', () => {
  test('keeps the 50k threshold and returns a 10k persisted preview above it', async () => {
    const storage = createInMemoryStorageBundle();
    await withStorage(storage, async () => {
      const exact = 'x'.repeat(TOOL_OUTPUT_THRESHOLD_CHARS - 2);
      expect(await applyToolOutputPolicy(exact, policyContext())).toBe(exact);

      const output = await applyToolOutputPolicy('x'.repeat(TOOL_OUTPUT_THRESHOLD_CHARS), policyContext());
      expect(isToolOutputArtifactReference(output)).toBe(true);
      if (!isToolOutputArtifactReference(output)) throw new Error('Expected artifact reference');
      expect(output.preview).toHaveLength(TOOL_OUTPUT_PREVIEW_CHARS);
      expect(output.artifactId).not.toContain('/');
      expect((await getToolOutputArtifactPage('session-1', output.artifactId, 0, 20))?.content).toBe('x'.repeat(20));
      expect(await getToolOutputArtifactPage('other-session', output.artifactId)).toBeNull();
    });
  });

  test('fails open with bounded output for circular values and persistence failure', async () => {
    const circular: Record<string, unknown> = {};
    circular.self = circular;
    const memory = createInMemoryStorageBundle();
    await withStorage(memory, async () => {
      const output = await applyToolOutputPolicy(circular, policyContext()) as Record<string, unknown>;
      expect(output.type).toBe('tool-output-preview');
      expect(output).not.toHaveProperty('artifactId');
      expect((output.preview as string).length).toBeLessThanOrEqual(TOOL_OUTPUT_PREVIEW_CHARS);
    });

    const failing = createInMemoryStorageBundle();
    failing.toolOutputArtifacts = {
      create: async () => {
        throw new Error('persistence failed');
      },
      getPage: async () => null,
    };
    await withStorage(failing, async () => {
      const output = await applyToolOutputPolicy('x'.repeat(TOOL_OUTPUT_THRESHOLD_CHARS), policyContext()) as Record<string, unknown>;
      expect(output.type).toBe('tool-output-preview');
      expect(output).not.toHaveProperty('artifactId');
      expect(output.preview).toHaveLength(TOOL_OUTPUT_PREVIEW_CHARS);
    });
  });

  test('bounds oversized success data that contains an error field', async () => {
    const storage = createInMemoryStorageBundle();
    await withStorage(storage, async () => {
      const output = await applyToolOutputPolicy({
        success: true,
        error: null,
        content: 'x'.repeat(TOOL_OUTPUT_THRESHOLD_CHARS),
      }, policyContext()) as Record<string, unknown>;
      expect(output.type).toBe('tool-output-artifact');
      expect(output).toHaveProperty('artifactId');
    });
  });

  test('preserves serializable falsy results and fails open for undefined', async () => {
    const storage = createInMemoryStorageBundle();
    await withStorage(storage, async () => {
      expect(await applyToolOutputPolicy(null, policyContext())).toBeNull();
      expect(await applyToolOutputPolicy(false, policyContext())).toBe(false);
      expect(await applyToolOutputPolicy(0, policyContext())).toBe(0);
      const output = await applyToolOutputPolicy(undefined, policyContext()) as Record<string, unknown>;
      expect(output.type).toBe('tool-output-preview');
      expect(output.preview).toBe('undefined');
      expect(output).not.toHaveProperty('artifactId');
    });
  });

  test('preserves visualization metadata on artifact references', async () => {
    const storage = createInMemoryStorageBundle();
    await withStorage(storage, async () => {
      const output = await applyToolOutputPolicy({
        content: 'x'.repeat(TOOL_OUTPUT_THRESHOLD_CHARS),
        _visualization: { type: 'todo-list', items: [] },
      }, policyContext()) as Record<string, unknown>;
      expect(output.type).toBe('tool-output-artifact');
      expect(output._visualization).toEqual({ type: 'todo-list', items: [] });
      const page = await getToolOutputArtifactPage('session-1', output.artifactId as string);
      expect(page?.content).not.toContain('_visualization');
    });
  });

  test('preserves tool errors and thrown interruption semantics', async () => {
    const error = { error: 'Tool execution interrupted' };
    const tools = wrapToolsWithOutputPolicy({
      returnedError: {
        description: 'error',
        inputSchema: {} as never,
        execute: async () => error,
      } as Tool,
      thrownError: {
        description: 'throw',
        inputSchema: {} as never,
        execute: async () => {
          throw new Error('Tool execution interrupted');
        },
      } as Tool,
    }, { sessionId: 'session-1' });

    const returned = tools.returnedError.execute as (...args: unknown[]) => Promise<unknown>;
    expect(await returned({}, { toolCallId: 'call-error' })).toBe(error);
    const thrown = tools.thrownError.execute as (...args: unknown[]) => Promise<unknown>;
    await expect(thrown({}, { toolCallId: 'call-throw' })).rejects.toThrow('Tool execution interrupted');
  });

  test('wraps representative tools from every composed source once and skips retrieval', async () => {
    const names = ['registry', 'standard', 'task', 'workspace', 'mcp', 'agent'];
    const tools = Object.fromEntries(names.map((name) => [name, {
      description: name,
      inputSchema: {} as never,
      execute: async () => 'x'.repeat(TOOL_OUTPUT_THRESHOLD_CHARS),
    } as Tool]));
    tools[RETRIEVE_TOOL_OUTPUT_NAME] = {
      description: RETRIEVE_TOOL_OUTPUT_NAME,
      inputSchema: {} as never,
      execute: async () => 'x'.repeat(TOOL_OUTPUT_THRESHOLD_CHARS),
    } as Tool;
    const storage = createInMemoryStorageBundle();

    await withStorage(storage, async () => {
      const wrapped = wrapToolsWithOutputPolicy(tools, {
        sessionId: 'session-1',
        workspaceId: 'workspace-1',
      });
      const wrappedAgain = wrapToolsWithOutputPolicy(wrapped, {
        sessionId: 'session-1',
        workspaceId: 'workspace-1',
      });
      for (const name of names) {
        const execute = wrappedAgain[name].execute as (...args: unknown[]) => Promise<unknown>;
        const output = await execute({}, { toolCallId: `call-${name}` });
        expect(isToolOutputArtifactReference(output)).toBe(true);
      }
      const retrieve = wrappedAgain[RETRIEVE_TOOL_OUTPUT_NAME].execute as (...args: unknown[]) => Promise<unknown>;
      expect(await retrieve({}, { toolCallId: 'call-retrieve' })).toBe('x'.repeat(TOOL_OUTPUT_THRESHOLD_CHARS));
    });
  });
});
