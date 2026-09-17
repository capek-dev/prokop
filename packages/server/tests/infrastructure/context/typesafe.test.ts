import { afterEach, beforeEach, describe, expect, spyOn, test } from 'bun:test';
import type { ContextSelectionInput } from '@capekai/core/composition';
import type { ContextCandidate } from '@/application/context/selection';
import { RELEVANCE_LEVELS, scoreContext } from '@/infrastructure/context/typesafe';

const input: ContextSelectionInput = { sessionId: 'session', request: { messageId: 'request', text: 'task', truncated: false }, recentMessages: [], continuation: false };
const candidate: ContextCandidate = { id: 'id', revision: 'rev', name: 'entry', kind: 'memory', source: 'agent', content: 'original', rendered: 'original' };
const signal = new AbortController().signal;
const response = (body: unknown) => async () => Response.json(body);

describe('TypeSafe SDK relevance contract', () => {
  let logs: ReturnType<typeof spyOn<typeof console, 'info'>>;
  beforeEach(() => { logs = spyOn(console, 'info').mockImplementation(() => {}); });
  afterEach(() => { logs.mockRestore(); });

  test('logs actual questions, payload and mapped scores without credentials', async () => {
    let sent: unknown;
    await scoreContext(input, [candidate], signal, {
      apiKey: 'private-key', model: 'jev-latest', fetch: async (_url, init) => {
        sent = JSON.parse(init.body as string);
        return Response.json({ answers: { item_0: { type: 'score', score: 2.5 } } });
      },
    });
    const request = String(logs.mock.calls[0][0]);
    expect(request).toStartWith('[context-selection] request ');
    expect(JSON.parse(request.slice('[context-selection] request '.length)).details.payload).toEqual(sent);
    const scores = String(logs.mock.calls[1][0]);
    expect(JSON.parse(scores.slice('[context-selection] scores '.length)).details.items).toEqual([
      { question: 'item_0', id: 'id', name: 'entry', source: 'agent', kind: 'memory', score: 2.5 },
    ]);
    expect(JSON.stringify(logs.mock.calls)).not.toContain('private-key');
    expect(JSON.stringify(logs.mock.calls)).not.toContain('Authorization');
  });

  test('redacts the configured key even when echoed in candidate content', async () => {
    await scoreContext(input, [{ ...candidate, content: 'contains private-key' }], signal, {
      apiKey: 'private-key', model: 'jev-latest', fetch: response({ answers: { item_0: { type: 'score', score: 0 } } }),
    });
    expect(JSON.stringify(logs.mock.calls)).not.toContain('private-key');
    expect(JSON.stringify(logs.mock.calls)).toContain('[REDACTED]');
  });
  test('batches independent 0-3 scores with explicit candidate paths and no confidence gate', async () => {
    const counts: number[] = [];
    const fakeFetch = (async (url: string, options: RequestInit) => {
      expect(url).toBe('https://api.typesafe.ai/v1/systemone');
      expect(options.signal).toBeInstanceOf(AbortSignal);
      const headers = new Headers(options.headers);
      expect(headers.get('Authorization')).toBe('Bearer fake');
      expect(headers.get('Content-Type')).toBe('application/json');
      const body = JSON.parse(options.body as string);
      expect(body.model).toBe('jev-latest');
      expect(body.state.task).toEqual({ ...input, checkpoint: null });
      expect(body.questions.item_0.criteria).toEqual(RELEVANCE_LEVELS);
      expect(body.questions.item_0.instructions).toContain('candidates[0]');
      counts.push(body.state.candidates.length);
      return Response.json({ answers: Object.fromEntries(Object.keys(body.questions).map(key => [key, { type: 'score', score: 2.1, confidence: 0 }])) });
    });
    const result = await scoreContext(input, Array.from({ length: 17 }, () => candidate), signal, { apiKey: 'fake', model: 'jev-latest', fetch: fakeFetch });
    expect(counts).toEqual([16, 1]);
    expect(result).toEqual(Array(17).fill(2.1));
  });
  test('rejects malformed, out-of-range, missing and extra answers', async () => {
    for (const body of [{}, { answers: [] }, { answers: {} },
      { answers: { item_0: { type: 'noul', score: 2 } } },
      { answers: { item_0: { type: 'score', score: 4 } } },
      { answers: { item_0: { type: 'score', score: 2 }, extra: {} } },
    ]) await expect(scoreContext(input, [candidate], signal, { apiKey: 'fake', model: 'jev-latest', fetch: response(body) })).rejects.toThrow();
  });
  test('HTTP failures and oversized responses reject without exposing response text', async () => {
    for (const fakeFetch of [
      async () => new Response('private error detail', { status: 500 }),
      async () => new Response('x'.repeat(128001)),
    ]) await expect(scoreContext(input, [candidate], signal, { apiKey: 'fake', model: 'jev-latest', fetch: fakeFetch })).rejects.toThrow(/Context relevance/);
  });
  test('SDK retries stay disabled and upstream error bodies stay private', async () => {
    let calls = 0;
    await expect(scoreContext(input, [candidate], signal, {
      apiKey: 'fake', model: 'jev-latest', fetch: async () => {
        calls++;
        return new Response('private error detail', { status: 429 });
      },
    })).rejects.toThrow('Context relevance service unavailable');
    expect(calls).toBe(1);
    expect(JSON.stringify(logs.mock.calls)).toContain('request-failed');
    expect(JSON.stringify(logs.mock.calls)).not.toContain('private error detail');
  });
  test('SDK forwards cancellation during body reading and never starts the next batch', async () => {
    const controller = new AbortController();
    let calls = 0;
    let cancelled = false;
    const promise = scoreContext(input, Array.from({ length: 17 }, () => candidate), controller.signal, {
      apiKey: 'fake', model: 'jev-latest', fetch: async (_url, init) => {
        calls++;
        expect(init.signal?.aborted).toBe(false);
        return new Response(new ReadableStream({
          start() { setTimeout(() => controller.abort(new Error('user cancelled')), 5); },
          cancel() { cancelled = true; },
        }));
      },
    });
    await expect(promise).rejects.toThrow('user cancelled');
    expect(calls).toBe(1);
    expect(cancelled).toBe(true);
  });
  test('pre-aborted input never calls the transport', async () => {
    await expect(scoreContext(input, [candidate], AbortSignal.abort(new Error('cancelled')), {
      apiKey: 'fake', model: 'jev-latest', fetch: async () => { throw new Error('transport called'); },
    })).rejects.toThrow('cancelled');
  });
});
