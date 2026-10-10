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
    updateCalls: Array<{ id: string; title?: string; metadata?: Record<string, unknown> | null }>;
    generatedFrom: MessageWithParts[][] | null;
    titleResult: string | null;
    error: Error | null;
    harnessResult: string | null;
    harnessCalls: string[];
    fallbackResult: string | null;
    /** Runs while the model generates, to simulate concurrent changes. */
    duringGeneration: (() => void) | null;
    sent: ServerMessage[];
    broadcasts: ServerMessage[];
  };
}

function makeTitleHarness(session: Session | null = makeSession(), options: { harness?: boolean } = {}): TitleHarness {
  const state: TitleHarness['state'] = {
    session,
    updateCalls: [],
    generatedFrom: null,
    titleResult: 'Login bug fix',
    error: null,
    harnessResult: null,
    harnessCalls: [],
    fallbackResult: 'help me fix the login',
    duringGeneration: null,
    sent: [],
    broadcasts: [],
  };
  const repository = {
    getSession: () => state.session,
    updateSession: (id: string, updates: { title?: string; metadata?: Record<string, unknown> | null }) => {
      state.updateCalls.push({ id, ...updates });
      if (!state.session) return null;
      state.session = { ...state.session, ...updates } as Session;
      return state.session;
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
      state.duringGeneration?.();
      if (state.error) throw state.error;
      return state.titleResult;
    },
    fallbackSessionTitle: () => state.fallbackResult,
  };
  const wire = {
    delivery: {
      send: (_o: Origin, message: ServerMessage) => { state.sent.push(message); },
      // Renames go to every client: session lists show titles.
      broadcast: (message: ServerMessage) => { state.broadcasts.push(message); },
    },
    actor: { attachOriginToSession: () => {} },
  } as unknown as SessionWirePorts<Origin>;
  const harnessTitle = options.harness
    ? async (sessionId: string) => { state.harnessCalls.push(sessionId); return state.harnessResult; }
    : undefined;
  const regenerate = createSessionTitleRegeneration<Origin>({ repository, titles, harnessTitle });
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

  test('without a Prokop model, uses the harness CLI title', async () => {
    const { regenerate, wire, state } = makeTitleHarness(makeSession(), { harness: true });
    state.error = new Error('No model configured');
    state.harnessResult = 'Login bug investigation';
    await regenerate(wire, origin, 'sess-1');
    expect(state.harnessCalls).toEqual(['sess-1']);
    expect(state.updateCalls).toEqual([{ id: 'sess-1', title: 'Login bug investigation' }]);
    expect(state.sent).toEqual([]);
  });

  test('prefers the Prokop model over the harness CLI title', async () => {
    const { regenerate, wire, state } = makeTitleHarness(makeSession(), { harness: true });
    state.harnessResult = 'Login bug investigation';
    await regenerate(wire, origin, 'sess-1');
    expect(state.harnessCalls).toEqual([]);
    expect(state.updateCalls).toEqual([{ id: 'sess-1', title: 'Login bug fix' }]);
  });

  test('without any title source, uses the first prompt and marks it replaceable, quietly', async () => {
    const { regenerate, wire, state } = makeTitleHarness(makeSession({ metadata: { claudeGoal: null } }), { harness: true });
    state.error = new Error('No model configured');
    await regenerate(wire, origin, 'sess-1');
    expect(state.updateCalls).toEqual([
      { id: 'sess-1', title: 'help me fix the login', metadata: { claudeGoal: null, titleFallback: true } },
    ]);
    expect(state.broadcasts).toHaveLength(1);
    expect(state.sent).toEqual([]);
  });

  test('a later turn replaces a first-prompt title and clears the mark', async () => {
    const { regenerate, wire, state } = makeTitleHarness(makeSession(), { harness: true });
    state.error = new Error('No model configured');
    await regenerate(wire, origin, 'sess-1');
    // Same first-prompt title again: nothing to persist or broadcast.
    await regenerate(wire, origin, 'sess-1');
    expect(state.updateCalls).toHaveLength(1);
    expect(state.broadcasts).toHaveLength(1);

    state.harnessResult = 'Login bug investigation';
    await regenerate(wire, origin, 'sess-1');
    expect(state.updateCalls.at(-1)).toEqual({ id: 'sess-1', title: 'Login bug investigation', metadata: {} });
    expect(state.session?.metadata).toEqual({});

    // A real title is final: later turns leave it alone.
    state.harnessResult = 'Something else';
    await regenerate(wire, origin, 'sess-1');
    expect(state.session?.title).toBe('Login bug investigation');
  });

  test('a manual rename during generation wins', async () => {
    const { regenerate, wire, state } = makeTitleHarness();
    state.duringGeneration = () => {
      state.session = { ...state.session!, title: 'My title', metadata: { titleManuallyRenamed: true } };
    };
    await regenerate(wire, origin, 'sess-1');
    expect(state.updateCalls).toEqual([]);
    expect(state.session?.title).toBe('My title');
  });

  test('automatic titling stays quiet when no title can be made', async () => {
    const { regenerate, wire, state } = makeTitleHarness();
    state.titleResult = null;
    state.fallbackResult = null;
    await regenerate(wire, origin, 'sess-1');
    expect(state.updateCalls).toEqual([]);
    expect(state.broadcasts).toEqual([]);
    expect(state.sent).toEqual([]);
  });

  test('a requested regeneration reports title_generation_error when no title can be made', async () => {
    const { regenerate, wire, state } = makeTitleHarness();
    state.error = new Error('model unavailable');
    state.fallbackResult = null;
    await regenerate(wire, origin, 'sess-1', { force: true });
    expect(state.updateCalls).toEqual([]);
    expect(state.broadcasts).toEqual([]);
    expect(state.sent).toEqual([
      { type: 'error', code: 'title_generation_error', message: 'Could not generate a title from the conversation.', sessionId: 'sess-1' },
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
