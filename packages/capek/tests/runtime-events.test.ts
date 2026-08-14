import { describe, expect, test } from 'bun:test';
import type { RuntimeHost } from '../src/runtime/host';
import { withRuntimeHost } from '../src/runtime/host';
import { emitRuntimeEvent } from '../src/runtime/host-dependencies';
import type { RuntimeDelivery } from '../src/runtime/events';

function runtimeHost(deliveries: string[]): RuntimeHost {
  return {
    interaction: {} as RuntimeHost['interaction'],
    delivery: {
      observe: ({ event }) => deliveries.push(`observe:${event.kind}`),
      emit: ({ event }) => deliveries.push(`emit:${event.kind}`),
    },
    titles: {} as RuntimeHost['titles'],
    workspace: {} as RuntimeHost['workspace'],
    sandbox: {} as RuntimeHost['sandbox'],
  };
}

describe('generic runtime events', () => {
  test('observes each structured event before host delivery without a transport', () => {
    const deliveries: string[] = [];

    withRuntimeHost(runtimeHost(deliveries), () => {
      emitRuntimeEvent(
        {
          kind: 'usage',
          sessionId: 'session-1',
          usage: {
            promptTokens: 2,
            completionTokens: 3,
            totalTokens: 5,
            cacheReadTokens: 0,
            cacheWriteTokens: 0,
            noCacheTokens: 5,
          },
          model: 'model-1',
        },
        { scope: 'session', sessionId: 'session-1' },
      );
    });

    expect(deliveries).toEqual(['observe:usage', 'emit:usage']);
  });

  test('represents origin, session, global, controller, ask-target, and host audiences generically', () => {
    const deliveries: RuntimeDelivery[] = [
      { audience: { scope: 'origin', origin: 'request-1' }, event: { kind: 'failure', category: 'generic', code: 'bad_request', message: 'Bad request' } },
      { audience: { scope: 'session', sessionId: 'session-1' }, event: { kind: 'queue', action: 'sending', sessionId: 'session-1', queueId: 'queue-1' } },
      { audience: { scope: 'global' }, event: { kind: 'session', action: 'updated', session: { id: 'session-1' } as never } },
      { audience: { scope: 'controller', sessionId: 'session-1' }, event: { kind: 'ask', action: 'timed_out', sessionId: 'session-1', toolCallId: 'call-1' } },
      {
        audience: {
          scope: 'ask_targets',
          sessionId: 'session-1',
          authority: { visibilityScope: 'controller_only', resolutionMode: 'controller_only' },
        },
        event: {
          kind: 'ask',
          action: 'requested',
          sessionId: 'session-1',
          toolCallId: 'call-1',
          toolName: 'question',
          ask: { type: 'text', target: 'human', question: 'Continue?' },
        },
      },
      { audience: { scope: 'host' }, event: { kind: 'terminal', sessionId: 'session-1', message: { role: 'assistant' } as never } },
    ];

    expect(deliveries.map(({ audience }) => audience.scope)).toEqual([
      'origin',
      'session',
      'global',
      'controller',
      'ask_targets',
      'host',
    ]);
    expect(deliveries.every(({ event }) => !('type' in event))).toBe(true);
  });
});
