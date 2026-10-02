import { expect, test } from 'bun:test';
import type { Preconfig } from '@prokopai/sdk';
import { runHeadlessTurn, type HeadlessSessionRunInput } from '@/application/ports/headless-execution';
import type { SessionWirePorts } from '@/application/ports/delivery';

const input: HeadlessSessionRunInput = {
  harness: 'claude-cli',
  parentSessionId: 'parent-1',
  childSessionId: 'child-1',
  preconfig: { id: 'dev' } as Preconfig,
  prompt: 'Review the evidence',
  workspacePath: '/workspace',
  workspaceId: 'ws',
  modelId: 'claude-opus-4-6',
  providerId: '',
  resumeFromHistory: false,
};

// A headless turn drives a normal sendMessage with every delivery sink
// discarded; success maps to {} and a thrown error to { error }.
test('runs the turn with a discarded-delivery wire and maps success', async () => {
  const seen: Array<{ origin: string; sessionId: string; content: string }> = [];
  const sendMessage = async <Origin>(
    wire: SessionWirePorts<Origin>,
    origin: Origin,
    sessionId: string,
    content: string,
  ): Promise<void> => {
    // Every sink the harness execution touches must be callable without a client.
    wire.delivery.send(origin, { type: 'error', code: 'not_found', message: 'dropped' });
    wire.delivery.broadcast({ type: 'error', code: 'not_found', message: 'dropped' }, undefined);
    wire.delivery.broadcastToSession(sessionId, { type: 'error', code: 'not_found', message: 'dropped' }, undefined);
    wire.actor.attachOriginToSession(origin, sessionId);
    seen.push({ origin: String(origin), sessionId, content });
  };

  const result = await runHeadlessTurn(sendMessage, input);

  expect(result).toEqual({});
  expect(seen).toEqual([{ origin: 'headless:child-1', sessionId: 'child-1', content: 'Review the evidence' }]);
});

test('maps a thrown error to a failed headless result', async () => {
  const result = await runHeadlessTurn(async () => {
    throw new Error('CLI unavailable');
  }, input);

  expect(result).toEqual({ error: 'CLI unavailable' });
});

test('maps a non-error rejection to a generic message', async () => {
  const result = await runHeadlessTurn(async () => {
    throw 'broken';
  }, input);

  expect(result).toEqual({ error: 'Headless run failed' });
});
