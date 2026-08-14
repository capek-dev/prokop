import { afterEach, describe, expect, test } from 'bun:test';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createAgent } from '@capekai/core';
import { facadeRuntimeIdentity } from '../src/facade/create-agent';
import { streamChatWithRetry } from '../src/core/retry';
import type { SandboxControlEvent, SandboxHistoryEntry } from '../src/sandbox/types';

const roots: string[] = [];

async function workspace(): Promise<string> {
  const path = await mkdtemp(join(tmpdir(), 'capek-facade-'));
  roots.push(path);
  return path;
}

afterEach(async () => {
  for (const path of roots.splice(0)) await rm(path, { recursive: true, force: true });
});

describe('createAgent facade', () => {
  test('runs the acceptance shape with package defaults', async () => {
    const root = await workspace();
    const agent = createAgent({
      model: 'openai/gpt-4o-mini',
      workspace: root,
      sandbox: true,
    });

    const result = await agent.run('Inspect this repository and explain it');

    expect(result.status).toBe('completed');
    expect(result.text).toBe('Sandbox response.');
    expect(result.sessionId).toBeTruthy();
    expect(result).not.toHaveProperty('runId');
    expect(Object.getOwnPropertyNames(Object.getPrototypeOf(agent)).filter((name) => name !== 'constructor')).toEqual([
      'run',
      'stream',
      'resume',
      'retrieveToolOutput',
      'interrupt',
      'close',
    ]);
    await agent.close();
  });

  test('orders the useful default prompt before project and workspace context', async () => {
    const root = await workspace();
    await writeFile(join(root, 'AGENTS.md'), 'PROJECT_CONTEXT_MARKER');
    let history: SandboxHistoryEntry[] = [];
    const agent = createAgent({
      model: 'openai/gpt-4o-mini',
      workspace: root,
      sandbox: {
        onEvent: (event: SandboxControlEvent) => {
          if (event.type === 'sandbox.history') history = event.entries;
        },
      },
    });

    await agent.run('inspect');
    const systemPrompt = history[0]?.context.systemPrompt ?? '';

    expect(systemPrompt).toContain('practical coding and research agent');
    expect(systemPrompt.indexOf('practical coding and research agent')).toBeLessThan(systemPrompt.indexOf('PROJECT_CONTEXT_MARKER'));
    expect(systemPrompt.indexOf('PROJECT_CONTEXT_MARKER')).toBeLessThan(systemPrompt.indexOf('<workspace>'));
    await agent.close();
  });

  test('uses the same retry runtime as the compatibility facade', () => {
    expect(facadeRuntimeIdentity).toBe(streamChatWithRetry);
  });

  test('streams structured events without a transport', async () => {
    const root = await workspace();
    const agent = createAgent({ model: 'openai/gpt-4o-mini', workspace: root, sandbox: true });
    const events = [];
    for await (const event of agent.stream('hello')) events.push(event);

    const initialText = events
      .filter((event) => event.type === 'part' && event.part.type === 'text')
      .map((event) => event.type === 'part' && event.part.type === 'text' ? event.part.text : '')
      .join('');
    const appendedText = events
      .filter((event) => event.type === 'part.append' && event.field === 'text')
      .map((event) => event.type === 'part.append' ? event.delta : '')
      .join('');
    const result = events.at(-1);

    expect(events[0]?.type).toBe('session.started');
    expect(result?.type).toBe('result');
    expect(events.some((event) => event.type === 'part.append')).toBe(true);
    if (result?.type === 'result') expect(initialText + appendedText).toBe(result.result.text);
    await agent.close();
  });

  test('continues an existing conversation with resume', async () => {
    const root = await workspace();
    const agent = createAgent({
      model: 'openai/gpt-4o-mini',
      workspace: root,
      sandbox: {
        rules: [
          { match: { mode: 'stream' }, response: { type: 'text', content: 'first' }, maxUses: 1 },
          { match: { mode: 'stream' }, response: { type: 'text', content: 'second' }, maxUses: 1 },
        ],
      },
    });

    const first = await agent.run('one');
    const second = await agent.resume(first.sessionId, 'two');

    expect(second.status).toBe('completed');
    expect(second.text).toBe('second');
    expect(second.sessionId).toBe(first.sessionId);
    await agent.close();
  });

  test('maps cancellation to interrupted', async () => {
    const root = await workspace();
    const agent = createAgent({
      model: 'openai/gpt-4o-mini',
      workspace: root,
      sandbox: {
        rules: [{
          match: { mode: 'stream' },
          response: { type: 'error', error: 'wait for interruption', errorType: 'server' },
        }],
      },
    });

    const running = agent.run('wait for interruption');
    await Bun.sleep(10);
    await agent.interrupt();
    const result = await running;

    expect(result.status).toBe('interrupted');
    expect(result).not.toHaveProperty('runId');
    await agent.close();
  });

  test('maps AbortSignal cancellation to interrupted', async () => {
    const root = await workspace();
    const controller = new AbortController();
    const agent = createAgent({
      model: 'openai/gpt-4o-mini',
      workspace: root,
      sandbox: {
        rules: [{
          match: { mode: 'stream' },
          response: { type: 'error', error: 'wait for signal', errorType: 'server' },
        }],
      },
    });

    const running = agent.run('wait for signal', { signal: controller.signal });
    await Bun.sleep(10);
    controller.abort();
    const result = await running;

    expect(result.status).toBe('interrupted');
    await agent.close();
  });

  test('does not block when terminal interaction is configured but unused', async () => {
    const root = await workspace();
    const agent = createAgent({
      model: 'openai/gpt-4o-mini',
      workspace: root,
      interaction: 'terminal',
    });

    await agent.close();
  });

  test('denies unsafe tool permissions without an interaction handler', async () => {
    const root = await workspace();
    const agent = createAgent({
      model: 'openai/gpt-4o-mini',
      workspace: root,
      sandbox: {
        rules: [
          {
            match: { mode: 'stream', hasToolResults: false },
            response: { type: 'tool-call', toolName: 'shell', args: { command: 'rm forbidden.txt' } },
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
    const shellPart = result.parts.find((part) => part.type === 'tool' && part.name === 'shell');

    expect(result.status).toBe('completed');
    expect(shellPart?.type).toBe('tool');
    if (shellPart?.type === 'tool' && shellPart.state.status === 'completed') {
      expect(shellPart.state.output).toEqual({ error: 'USER_REJECTION' });
    }
    await agent.close();
  });

  test('denies malformed permission responses', async () => {
    const root = await workspace();
    const agent = createAgent({
      model: 'openai/gpt-4o-mini',
      workspace: root,
      interaction: async () => ({ type: 'permission', grant: 'unknown' }),
      sandbox: {
        rules: [
          {
            match: { mode: 'stream', hasToolResults: false },
            response: { type: 'tool-call', toolName: 'shell', args: { command: 'chmod 777 missing.txt' } },
            maxUses: 1,
          },
          {
            match: { mode: 'stream', hasToolResults: true },
            response: { type: 'text', content: 'malformed denied' },
            maxUses: 1,
          },
        ],
      },
    });

    const result = await agent.run('try a dangerous command');
    const shellPart = result.parts.find((part) => part.type === 'tool' && part.name === 'shell');

    expect(result.text).toBe('malformed denied');
    expect(shellPart?.type).toBe('tool');
    if (shellPart?.type === 'tool' && shellPart.state.status === 'error') {
      expect(shellPart.state.error).toBe('USER_REJECTION');
    } else {
      throw new Error('Expected denied shell tool part');
    }
    await agent.close();
  });

  test('does not advertise question without interaction', async () => {
    const root = await workspace();
    let history: SandboxHistoryEntry[] = [];
    const agent = createAgent({
      model: 'openai/gpt-4o-mini',
      workspace: root,
      sandbox: {
        onEvent: (event: SandboxControlEvent) => {
          if (event.type === 'sandbox.history') history = event.entries;
        },
      },
    });

    const result = await agent.run('inspect available tools');

    expect(result.status).toBe('completed');
    expect(history[0]?.context.tools.map((tool) => tool.name)).not.toContain('question');
    await agent.close();
  });

  test('close interrupts and waits for the active run', async () => {
    const root = await workspace();
    const agent = createAgent({
      model: 'openai/gpt-4o-mini',
      workspace: root,
      sandbox: {
        rules: [{
          match: { mode: 'stream' },
          response: { type: 'error', error: 'wait for close', errorType: 'server' },
        }],
      },
    });

    const running = agent.run('wait for close');
    await Bun.sleep(10);
    await Promise.all([agent.close(), agent.close()]);
    const result = await running;

    expect(result.status).toBe('interrupted');
    await expect(agent.run('closed')).rejects.toThrow('Agent is closed');
  });

  test('cancels an abandoned stream', async () => {
    const root = await workspace();
    const agent = createAgent({
      model: 'openai/gpt-4o-mini',
      workspace: root,
      sandbox: {
        rules: [{
          match: { mode: 'stream' },
          response: { type: 'error', error: 'wait for stream cancellation', errorType: 'server' },
        }],
      },
    });
    const iterator = agent.stream('wait')[Symbol.asyncIterator]();

    expect((await iterator.next()).value?.type).toBe('session.started');
    await iterator.return?.();
    await agent.close();
  });

  test('maps retry backoff interruption to interrupted', async () => {
    const root = await workspace();
    let completedCall!: () => void;
    const callCompleted = new Promise<void>((resolve) => {
      completedCall = resolve;
    });
    const agent = createAgent({
      model: 'openai/gpt-4o-mini',
      workspace: root,
      sandbox: {
        rules: [{
          match: { mode: 'stream' },
          response: { type: 'error', error: 'retry me', errorType: 'server' },
          maxUses: 1,
        }],
        onEvent: (event: SandboxControlEvent) => {
          if (event.type === 'sandbox.history' && event.entries.some((entry) => entry.response?.type === 'error')) {
            completedCall();
          }
        },
      },
    });

    const running = agent.run('retry');
    await callCompleted;
    await agent.interrupt();
    const result = await running;

    expect(result.status).toBe('interrupted');
    await agent.close();
  });

  test('rejects failed custom interaction without fabricating an answer', async () => {
    const root = await workspace();
    const agent = createAgent({
      model: 'openai/gpt-4o-mini',
      workspace: root,
      interaction: async () => {
        throw new Error('interaction failed');
      },
      sandbox: {
        rules: [
          {
            match: { mode: 'stream', hasToolResults: false },
            response: {
              type: 'tool-call',
              toolName: 'question',
              args: { title: 'Choose', questions: [{ type: 'confirm', question: 'Continue?' }] },
            },
            maxUses: 1,
          },
          {
            match: { mode: 'stream', hasToolResults: true },
            response: { type: 'text', content: 'handled failure' },
            maxUses: 1,
          },
        ],
      },
    });

    const result = await agent.run('ask');
    const questionPart = result.parts.find((part) => part.type === 'tool' && part.name === 'question');

    expect(result.text).toBe('handled failure');
    if (questionPart?.type === 'tool' && questionPart.state.status === 'error') {
      expect(questionPart.state.error).toBe('interaction failed');
    } else {
      throw new Error('Expected failed question tool part');
    }
    await agent.close();
  });

  test('closes terminal interaction when interrupted', async () => {
    const root = await workspace();
    let requested!: () => void;
    const requestStarted = new Promise<void>((resolve) => {
      requested = resolve;
    });
    let closeCount = 0;
    const agent = createAgent({
      model: 'openai/gpt-4o-mini',
      workspace: root,
      interaction: 'terminal',
      terminal: {
        request: async (_message, signal) => {
          requested();
          await new Promise<void>((_resolve, reject) => {
            signal.addEventListener('abort', () => reject(signal.reason), { once: true });
          });
        },
        close: () => {
          closeCount += 1;
        },
      },
      sandbox: {
        rules: [{
          match: { mode: 'stream', hasToolResults: false },
          response: {
            type: 'tool-call',
            toolName: 'question',
            args: { title: 'Choose', questions: [{ type: 'confirm', question: 'Continue?' }] },
          },
          maxUses: 1,
        }],
      },
    });

    const running = agent.run('ask');
    await requestStarted;
    await agent.interrupt();
    const result = await running;

    expect(result.status).toBe('interrupted');
    expect(closeCount).toBeGreaterThan(0);
    await agent.close();
  });

  test('close completes cleanup when an active resume rejects', async () => {
    const root = await workspace();
    const agent = createAgent({ model: 'openai/gpt-4o-mini', workspace: root, sandbox: true });
    const running = agent.resume('missing-session', 'resume');
    const rejected = expect(running).rejects.toThrow('Session not found: missing-session');

    await expect(Promise.all([agent.close(), agent.close()])).resolves.toEqual([undefined, undefined]);
    await rejected;
  });

  test('aborts the captured terminal signal when a run settles', async () => {
    const root = await workspace();
    let capturedSignal: AbortSignal | undefined;
    const agent = createAgent({
      model: 'openai/gpt-4o-mini',
      workspace: root,
      interaction: 'terminal',
      terminal: {
        request: async (_message, signal) => {
          capturedSignal = signal;
          return { type: 'form', answers: [{ answer: true }] };
        },
        close: () => {},
      },
      sandbox: {
        rules: [{
          match: { mode: 'stream', hasToolResults: false },
          response: {
            type: 'tool-call',
            toolName: 'question',
            args: { title: 'Choose', questions: [{ type: 'confirm', question: 'Continue?' }] },
          },
          maxUses: 1,
        }],
      },
    });

    const result = await agent.run('ask');

    expect(result.status).toBe('completed');
    expect(capturedSignal?.aborted).toBe(true);
    await agent.close();
  });

  test('persists large tool results as scoped artifacts retrievable through the Agent API', async () => {
    const root = await workspace();
    await writeFile(join(root, 'large.txt'), `${'x'.repeat(60_000)}\n`);
    const agent = createAgent({
      model: 'openai/gpt-4o-mini',
      workspace: root,
      sandbox: {
        rules: [{
          match: { mode: 'stream', hasToolResults: false },
          response: { type: 'tool-call', toolName: 'grep', args: { pattern: 'x', path: root } },
          maxUses: 1,
        }],
      },
    });

    const result = await agent.run('search large output', { maxSteps: 3 });
    const toolPart = result.parts.find((part) => part.type === 'tool' && part.name === 'grep');
    if (!toolPart || toolPart.type !== 'tool' || toolPart.state.status !== 'completed') {
      throw new Error('Expected completed grep tool part');
    }
    const output = toolPart.state.output as { artifactId: string; preview: string; totalChars: number };

    expect(output.artifactId).toMatch(/^[0-9a-f-]{36}$/);
    expect(output.preview).toHaveLength(10_000);
    expect(JSON.stringify(output)).not.toContain(root);
    const page = await agent.retrieveToolOutput(result.sessionId, output.artifactId, { limit: 20_000 });
    expect(page?.content).toContain('large.txt');
    expect(page?.totalChars).toBe(output.totalChars);
    expect(await agent.retrieveToolOutput('other-session', output.artifactId)).toBeNull();
    await agent.close();
  });

  test('falls back after caller sandbox rules are exhausted', async () => {
    const root = await workspace();
    const agent = createAgent({
      model: 'openai/gpt-4o-mini',
      workspace: root,
      sandbox: {
        rules: [{
          match: { mode: 'stream' },
          response: { type: 'text', content: 'specific' },
          maxUses: 1,
        }],
      },
    });

    const first = await agent.run('first');
    const second = await agent.resume(first.sessionId, 'second');

    expect(first.text).toBe('specific');
    expect(second.text).toBe('Sandbox response.');
    await agent.close();
  });

  test('runs bundled read and search tools across multiple steps', async () => {
    const root = await workspace();
    await writeFile(join(root, 'example.txt'), 'alpha\nneedle\nomega\n');
    const agent = createAgent({
      model: 'openai/gpt-4o-mini',
      workspace: root,
      sandbox: {
        rules: [
          {
            match: { mode: 'stream', hasToolResults: false },
            response: { type: 'tool-call', toolName: 'read-file', args: { path: join(root, 'example.txt') } },
            maxUses: 1,
          },
          {
            match: { mode: 'stream', hasToolResults: true },
            response: { type: 'tool-call', toolName: 'grep', args: { pattern: 'needle', path: root } },
            maxUses: 1,
          },
          {
            match: { mode: 'stream', hasToolResults: true },
            response: { type: 'text', content: 'found needle' },
            maxUses: 1,
          },
        ],
      },
    });

    const result = await agent.run('Read and search the workspace', { maxSteps: 4 });

    expect(result.status).toBe('completed');
    expect(result.text).toBe('found needle');
    expect(result.parts.filter((part) => part.type === 'tool').map((part) => part.name)).toEqual(['read-file', 'grep']);
    await agent.close();
  });
});
