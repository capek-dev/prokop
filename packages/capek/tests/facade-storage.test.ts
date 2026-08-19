import { afterEach, describe, expect, test } from 'bun:test';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createAgent } from '@capekai/core';
import { createInMemoryConversationStore } from '@capekai/core/storage';
import type { LoadedTool } from '@capekai/tool';

const roots: string[] = [];

async function root(): Promise<string> {
  const path = await mkdtemp(join(tmpdir(), 'capek-storage-option-'));
  roots.push(path);
  return path;
}

/** A local grep tool for the scripted sandbox response. */
function localGrepTool(): LoadedTool {
  return {
    definition: {
      name: 'grep',
      description: 'Local test grep.',
      inputSchema: {
        type: 'object',
        properties: { pattern: { type: 'string' }, path: { type: 'string' } },
        required: ['pattern', 'path'],
      },
      timeout: 5000,
    },
    execute: async (input) => {
      const { readFile, readdir } = await import('node:fs/promises');
      const { join: joinPath } = await import('node:path');
      const dir = String(input.path);
      const files = (await readdir(dir)).filter((name) => name.endsWith('.txt'));
      const lines: string[] = [];
      for (const name of files) {
        const content = await readFile(joinPath(dir, name), 'utf-8');
        for (const line of content.split('\n')) {
          if (line.includes(String(input.pattern))) lines.push(`${name}:${line}`);
        }
      }
      return { success: true, result: { content: lines.join('\n'), truncated: false } };
    },
    path: 'builtin:test',
  };
}

afterEach(async () => {
  for (const path of roots.splice(0)) await rm(path, { recursive: true, force: true });
});

describe('createAgent storage options', () => {
  test('omission and memory descriptors create fresh stores', async () => {
    const workspace = await root();
    const first = createAgent({ model: 'openai/gpt-4o-mini', workspace, sandbox: true });
    const second = createAgent({
      model: 'openai/gpt-4o-mini',
      workspace,
      storage: { type: 'memory' },
      sandbox: true,
    });

    const firstResult = await first.run('first');
    await expect(second.resume(firstResult.sessionId, 'second')).rejects.toThrow('Session not found');

    await first.close();
    await second.close();
  });

  test('accepts a custom conversation store', async () => {
    const workspace = await root();
    const conversation = createInMemoryConversationStore();
    const agent = createAgent({
      model: 'openai/gpt-4o-mini',
      workspace,
      storage: conversation,
      sandbox: true,
    });

    const result = await agent.run('custom');

    expect(conversation.getSession(result.sessionId)).not.toBeNull();
    await agent.close();
  });

  test('treats stores with another type field as custom and does not close caller storage', async () => {
    const workspace = await root();
    let closeCount = 0;
    const conversation = Object.assign(createInMemoryConversationStore(), {
      type: 'custom-store',
      close: () => {
        closeCount += 1;
      },
    });
    const agent = createAgent({
      model: 'openai/gpt-4o-mini',
      workspace,
      storage: conversation,
      sandbox: true,
    });

    const result = await agent.run('custom type');
    await Promise.all([agent.close(), agent.close()]);

    expect(conversation.getSession(result.sessionId)).not.toBeNull();
    expect(closeCount).toBe(0);
  });

  test('reopens SQLite and resumes the same session with retrievable artifacts', async () => {
    const workspace = await root();
    const path = join(workspace, 'agent.db');
    await writeFile(join(workspace, 'large.txt'), `${'x'.repeat(60_000)}\n`);
    const first = createAgent({
      model: 'openai/gpt-4o-mini',
      workspace,
      tools: [localGrepTool()],
      storage: { type: 'sqlite', path },
      sandbox: {
        rules: [{
          match: { mode: 'stream', hasToolResults: false },
          response: { type: 'tool-call', toolName: 'grep', args: { pattern: 'x', path: workspace } },
          maxUses: 1,
        }],
      },
    });
    const initial = await first.run('persist this', { maxSteps: 3 });
    const toolPart = initial.parts.find((part) => part.type === 'tool' && part.name === 'grep');
    if (!toolPart || toolPart.type !== 'tool' || toolPart.state.status !== 'completed') {
      throw new Error('Expected completed grep tool part');
    }
    const artifactId = (toolPart.state.output as { artifactId: string }).artifactId;
    await first.close();

    const reopened = createAgent({
      model: 'openai/gpt-4o-mini',
      workspace,
      storage: { type: 'sqlite', path },
      sandbox: { rules: [{ match: { mode: 'stream' }, response: { type: 'text', content: 'resumed' } }] },
    });
    expect((await reopened.retrieveToolOutput(initial.sessionId, artifactId))?.content).toContain('large.txt');
    const resumed = await reopened.resume(initial.sessionId, 'continue');

    expect(resumed.status).toBe('completed');
    expect(resumed.text).toBe('resumed');
    expect(resumed.sessionId).toBe(initial.sessionId);
    expect((await reopened.retrieveToolOutput(initial.sessionId, artifactId))?.content).toContain('large.txt');
    await reopened.close();
  });

  test('keeps concurrent facade state scoped by instance', async () => {
    const workspace = await root();
    const left = createAgent({
      model: 'openai/gpt-4o-mini',
      workspace,
      sandbox: { rules: [{ match: { mode: 'stream' }, response: { type: 'text', content: 'left' } }] },
    });
    const right = createAgent({
      model: 'openai/gpt-4o-mini',
      workspace,
      sandbox: { rules: [{ match: { mode: 'stream' }, response: { type: 'text', content: 'right' } }] },
    });

    const [leftResult, rightResult] = await Promise.all([left.run('left'), right.run('right')]);

    expect(leftResult.text).toBe('left');
    expect(rightResult.text).toBe('right');
    expect(leftResult.sessionId).not.toBe(rightResult.sessionId);
    await left.close();
    await right.close();
  });
});
