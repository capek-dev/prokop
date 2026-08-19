/**
 * Composition end-to-end tests: the public composition path (scopes +
 * plugins + the run loop a user writes) really runs a turn. Replaces the
 * facade e2e suite.
 */

import { afterEach, describe, expect, test } from 'bun:test';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import type { LoadedTool } from '@capekai/tool';
import type { SandboxHistoryEntry } from '../src/sandbox/types';
import { StandaloneAgent } from './helpers/standalone-agent';

const roots: string[] = [];

async function workspace(): Promise<string> {
  const path = await mkdtemp(join(tmpdir(), 'capek-composition-e2e-'));
  roots.push(path);
  return path;
}

afterEach(async () => {
  for (const path of roots.splice(0)) await rm(path, { recursive: true, force: true });
});

/** A permission-asking wrapper: denies produce USER_REJECTION without
 * interaction, for the headless-deny test. */
function askingGrepTool(): LoadedTool {
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
    execute: async (input, context) => {
      const approved = await context.ask({
        type: 'permission',
        question: `Allow grep on ${input.path}?`,
        risk: 'medium',
        resource: 'file',
        action: 'read',
        paths: [String(input.path)],
      });
      if (!approved) return { success: false, error: 'USER_REJECTION' };
      return { success: true, result: { content: 'ok', truncated: false } };
    },
    path: 'builtin:test',
  };
}

/** A permission-free grep tool (no ctx.ask), for the artifact flow test. */
function plainGrepTool(): LoadedTool {
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

function captureHistory(history: SandboxHistoryEntry[]) {
  return (event: { type: string; entries?: SandboxHistoryEntry[] }): void => {
    if (event.type === 'sandbox.history' && event.entries) {
      history.splice(0, history.length, ...event.entries);
    }
  };
}

describe('composition end-to-end', () => {
  test('runs a full turn through the public composition path with sandboxed model calls', async () => {
    const root = await workspace();
    const history: SandboxHistoryEntry[] = [];
    const agent = new StandaloneAgent({
      model: 'openai/gpt-4o-mini',
      workspace: root,
      sandbox: { onEvent: captureHistory(history) },
    });

    const result = await agent.run('inspect');

    expect(result.status).toBe('completed');
    expect(result.text).toBe('Sandbox response.');
    const entry = history.at(-1)!;
    expect(entry.context.providerId).toBe('sandbox');
    expect(entry.context.modelId).toBe('gpt-4o-mini');
    expect(entry.context.mode).toBe('stream');
    expect(entry.context.depth).toBe(0);
    expect(entry.context.sessionId).toBe(result.sessionId);
    expect(entry.context.tools.map((tool: { name: string }) => tool.name)).toEqual(['retrieve-tool-output']);

    await agent.close();
  });

  test('custom prompt flows into the sandbox system prompt through the ordered assembler', async () => {
    const root = await workspace();
    const history: SandboxHistoryEntry[] = [];
    const agent = new StandaloneAgent({
      model: 'openai/gpt-4o-mini',
      workspace: root,
      prompt: 'CUSTOM-PROMPT',
      sandbox: { onEvent: captureHistory(history) },
    });

    const result = await agent.run('inspect');
    expect(result.status).toBe('completed');

    const entry = history.at(-1)!;
    expect(entry.context.systemPrompt).toContain('CUSTOM-PROMPT');
    expect(entry.context.systemPrompt).toContain('<workspace>');

    await agent.close();
  });

  test('denies unsafe tool permissions without an interaction handler', async () => {
    const root = await workspace();
    const agent = new StandaloneAgent({
      model: 'openai/gpt-4o-mini',
      workspace: root,
      tools: [askingGrepTool()],
      sandbox: {
        rules: [
          {
            match: { mode: 'stream', hasToolResults: false },
            response: { type: 'tool-call', toolName: 'grep', args: { pattern: 'x', path: root } },
            maxUses: 1,
          },
          {
            match: { mode: 'stream', hasToolResults: true },
            response: { type: 'text', content: 'denied safely' },
            maxUses: 1,
          },
        ],
      },
    });

    const result = await agent.run('run an unsafe command');
    const toolPart = result.parts.find((part) => part.type === 'tool' && part.name === 'grep');

    expect(result.status).toBe('completed');
    expect(result.text).toBe('denied safely');
    expect(toolPart?.type).toBe('tool');
    if (toolPart?.type === 'tool' && toolPart.state.status === 'completed') {
      expect(toolPart.state.output).toEqual({ error: 'USER_REJECTION' });
    }

    await agent.close();
  });

  test('reopens SQLite storage and retrieves the persisted artifact through a fresh composition', async () => {
    const root = await workspace();
    const dbPath = join(root, 'agent.db');
    await writeFile(join(root, 'large.txt'), `${'x'.repeat(60_000)}\n`);
    const first = new StandaloneAgent({
      model: 'openai/gpt-4o-mini',
      workspace: root,
      tools: [plainGrepTool()],
      storage: { type: 'sqlite', path: dbPath },
      sandbox: {
        rules: [{
          match: { mode: 'stream', hasToolResults: false },
          response: { type: 'tool-call', toolName: 'grep', args: { pattern: 'x', path: root } },
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

    const reopened = new StandaloneAgent({
      model: 'openai/gpt-4o-mini',
      workspace: root,
      storage: { type: 'sqlite', path: dbPath },
      sandbox: { rules: [{ match: { mode: 'stream' }, response: { type: 'text', content: 'resumed' } }] },
    });
    const page = await reopened.retrieveToolOutput(initial.sessionId, artifactId);
    expect(page?.content).toContain('large.txt');
    await reopened.close();
  });
});
