import { describe, expect, test } from 'bun:test';
import type { MessageWithParts, ServerMessage, Session } from '@prokopai/sdk';
import type { SessionWirePorts } from '@/application/ports/delivery';
import type { TitleGenerationPort } from '@/application/ports/titles';
import { createSessionTitleRegeneration } from '@/application/sessions/title';

type Origin = string;
const origin: Origin = 'conn-1';

function makeSession(overrides: Partial<Session> = {}): Session {
  return {
    id: 'sess-1',
    workspaceId: 'ws-1',
    preconfigId: null,
    title: 'New Session',
    status: 'active',
    metadata: null,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    ...overrides,
  } as Session;
}

const pageMessages = [
  { message: { id: 'm-1', role: 'user' }, parts: [{ type: 'text', text: 'help me fix the login bug' }] },
  { message: { id: 'm-2', role: 'assistant' }, parts: [{ type: 'text', text: 'I will look into it' }] },
] as unknown as MessageWithParts[];

interface TitleHarness {
  regenerate: (wire: SessionWirePorts<Origin>, origin: Origin, sessionId: string, options?: { force?: boolean }) => Promise<void>;
  wire: SessionWirePorts<Origin>;
  state: {
    session: Session | null;
    updateCalls: Array<{ id: string; title?: string }>;
    generatedFrom: MessageWithParts[][] | null;
    titleResult: string | null;
    error: Error | null;
    sent: ServerMessage[];
    broadcasts: ServerMessage[];
  };
}

function makeTitleHarness(session: Session | null = makeSession()): TitleHarness {
  const state = {
    session,
    updateCalls: [] as Array<{ id: string; title?: string }>,
    generatedFrom: null as MessageWithParts[][] | null,
    titleResult: 'Login bug fix' as string | null,
    error: null as Error | null,
    sent: [] as ServerMessage[],
    broadcasts: [] as ServerMessage[],
  };
  const repository = {
    getSession: () => state.session,
    updateSession: (id: string, updates: { title?: string }) => {
      state.updateCalls.push({ id, title: updates.title });
      return state.session ? { ...state.session, title: updates.title ?? state.session.title } : null;
    },
    listLatestMessagesWithPartsPage: () => ({
      messages: pageMessages,
      pagination: { hasOlder: false, oldestSequence: 1, newestSequence: 2, limit: 100 },
    }),
  };
  const titles: TitleGenerationPort = {
    isDefaultSessionTitle: title => ['new session', 'new'].includes((title ?? '').trim().toLowerCase()),
    hasManualSessionTitle: metadata => metadata?.titleManuallyRenamed === true,
    async generateSessionTitle(messages) {
      state.generatedFrom = [...(state.generatedFrom ?? []), messages];
      if (state.error) throw state.error;
      return state.titleResult;
    },
  };
  const wire = {
    delivery: {
      send: (_o: Origin, message: ServerMessage) => { state.sent.push(message); },
      broadcastToSession: (_sessionId: string, message: ServerMessage) => { state.broadcasts.push(message); },
    },
    actor: { attachOriginToSession: () => {} },
  } as unknown as SessionWirePorts<Origin>;
  const regenerate = createSessionTitleRegeneration<Origin>({ repository, titles });
  return { regenerate, wire, state };
}

describe('universal server-side session title regeneration', () => {
  test('generates from the transcript page, persists, and broadcasts session.renamed', async () => {
    const { regenerate, wire, state } = makeTitleHarness();
    await regenerate(wire, origin, 'sess-1');
    expect(state.updateCalls).toEqual([{ id: 'sess-1', title: 'Login bug fix' }]);
    expect(state.broadcasts).toEqual([
      { type: 'session.renamed', session: expect.objectContaining({ id: 'sess-1', title: 'Login bug fix' }) },
    ]);
    expect(state.sent).toEqual([]);
    expect(state.generatedFrom).toEqual([pageMessages]);
  });

  test('skips non-default titles without force', async () => {
    const { regenerate, wire, state } = makeTitleHarness(makeSession({ title: 'Already titled' }));
    await regenerate(wire, origin, 'sess-1');
    expect(state.updateCalls).toEqual([]);
    expect(state.generatedFrom).toEqual(null);
    expect(state.broadcasts).toEqual([]);
  });

  test('skips manually renamed sessions without force and regenerates with force', async () => {
    const manual = makeSession({ metadata: { titleManuallyRenamed: true } });
    const skipped = makeTitleHarness(manual);
    await skipped.regenerate(skipped.wire, origin, 'sess-1');
    expect(skipped.state.updateCalls).toEqual([]);

    const forced = makeTitleHarness(manual);
    await forced.regenerate(forced.wire, origin, 'sess-1', { force: true });
    expect(forced.state.updateCalls).toEqual([{ id: 'sess-1', title: 'Login bug fix' }]);
  });

  test('reports title_generation_error to the origin when generation returns nothing', async () => {
    const { regenerate, wire, state } = makeTitleHarness();
    state.titleResult = null;
    await regenerate(wire, origin, 'sess-1');
    expect(state.updateCalls).toEqual([]);
    expect(state.broadcasts).toEqual([]);
    expect(state.sent).toEqual([
      { type: 'error', code: 'title_generation_error', message: 'Could not generate a title from the conversation.', sessionId: 'sess-1' },
    ]);
  });

  test('reports title_generation_error to the origin when generation throws', async () => {
    const { regenerate, wire, state } = makeTitleHarness();
    state.error = new Error('model unavailable');
    await regenerate(wire, origin, 'sess-1');
    expect(state.updateCalls).toEqual([]);
    expect(state.sent).toEqual([
      { type: 'error', code: 'title_generation_error', message: 'Title generation failed: model unavailable', sessionId: 'sess-1' },
    ]);
  });

  test('returns silently for missing sessions', async () => {
    const { regenerate, wire, state } = makeTitleHarness(null);
    await regenerate(wire, origin, 'missing');
    expect(state.sent).toEqual([]);
    expect(state.updateCalls).toEqual([]);
    expect(state.generatedFrom).toEqual(null);
  });
});
