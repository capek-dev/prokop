import { afterEach, describe, expect, test } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createAgent } from '@capekai/core';
import { createInMemoryStorageBundle } from '@capekai/core/storage';
import type { SandboxControlEvent, SandboxHistoryEntry } from '../src/sandbox/types';

const roots: string[] = [];

async function workspace(): Promise<string> {
  const path = await mkdtemp(join(tmpdir(), 'capek-facade-inventory-'));
  roots.push(path);
  return path;
}

function captureHistory(onEvent: (event: SandboxControlEvent) => void, history: SandboxHistoryEntry[]) {
  return (event: SandboxControlEvent): void => {
    if (event.type === 'sandbox.history') {
      history.splice(0, history.length, ...event.entries);
    }
    onEvent(event);
  };
}

const STANDARD_WITHOUT_QUESTION = [
  'retrieve-tool-output',
];

const STANDARD_WITH_QUESTION = [
  'retrieve-tool-output',
];

afterEach(async () => {
  for (const path of roots.splice(0)) await rm(path, { recursive: true, force: true });
});

describe('createAgent composition inventory', () => {
  test('composes the effective standard tools without interaction and routes models through sandbox', async () => {
    const root = await workspace();
    const bundle = createInMemoryStorageBundle();
    const history: SandboxHistoryEntry[] = [];
    const agent = createAgent({
      model: 'openai/gpt-4o-mini',
      workspace: root,
      storage: bundle.conversation,
      sandbox: {
        onEvent: captureHistory(() => {}, history),
      },
    });

    const result = await agent.run('inspect');

    expect(result.status).toBe('completed');
    const entry = history.at(-1)!;
    expect(entry.context.tools.map((tool) => tool.name)).toEqual(STANDARD_WITHOUT_QUESTION);
    expect(entry.context.providerId).toBe('sandbox');
    expect(entry.context.modelId).toBe('gpt-4o-mini');
    expect(entry.context.mode).toBe('stream');
    expect(entry.context.depth).toBe(0);
    expect(entry.context.sessionId).toBe(result.sessionId);

    const session = await bundle.conversation.getSession(result.sessionId);
    expect(session).not.toBeNull();
    expect(session).toMatchObject({
      preconfigId: 'capek-default',
      selectedModel: 'gpt-4o-mini',
      selectedProvider: 'openai',
      status: 'active',
      parentId: null,
      agentName: null,
      title: 'Agent session',
    });
    expect(session?.workspaceId).toBe(root);
    await agent.close();
  });

  test('advertises question when interaction is configured', async () => {
    const root = await workspace();
    const history: SandboxHistoryEntry[] = [];
    const agent = createAgent({
      model: 'openai/gpt-4o-mini',
      workspace: root,
      interaction: 'terminal',
      terminal: {
        request: async () => ({ type: 'form', answers: [] }),
        close: () => {},
      },
      sandbox: {
        onEvent: captureHistory(() => {}, history),
      },
    });

    const result = await agent.run('inspect');

    expect(result.status).toBe('completed');
    const entry = history.at(-1)!;
    expect(entry.context.tools.map((tool) => tool.name)).toEqual(STANDARD_WITH_QUESTION);
    expect(entry.context.providerId).toBe('sandbox');
    await agent.close();
  });
});
