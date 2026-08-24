import { describe, expect, test } from 'bun:test';
import type { ServerMessage, Session } from '@prokopai/sdk';
import {
  createSessionApplication,
  type SessionApplicationDeps,
} from '@/application/sessions';
import { createSessionChatApplication } from '@/application/sessions/chat';
import { createSessionLifecycleApplication } from '@/application/sessions/lifecycle';
import { createSessionTranscriptApplication } from '@/application/sessions/transcript';
import { createSessionQueueApplication } from '@/application/sessions/queue';
import type { SessionWirePorts } from '@/application/ports/delivery';
import type { SessionRepositoryPort, PendingAskPort, AskAuthorityPort, PendingAskRecord } from '@/application/ports/session';
import type { SessionExecutionPort } from '@/application/ports/execution';
import type { ControllerGatePort, ControllerGateRejection, SessionControlPort } from '@/application/ports/control';

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

interface DeliverySpy {
  sent: ServerMessage[];
  broadcast: Array<{ message: ServerMessage; exclude?: Origin }>;
  broadcastToSession: Array<{ sessionId: string; message: ServerMessage; exclude?: Origin }>;
  sendToController: Array<{ sessionId: string; message: ServerMessage }>;
  sendToAskTargets: Array<{ sessionId: string; message: ServerMessage }>;
  attached: Array<{ origin: Origin; sessionId: string }>;
}

function makeWire(spy: DeliverySpy): SessionWirePorts<Origin> {
  return {
    delivery: {
      send: (o, message) => {
        expect(o).toBe(origin);
        spy.sent.push(message);
      },
      broadcast: (message, exclude) => spy.broadcast.push({ message, exclude }),
      broadcastToSession: (sessionId, message, exclude) => spy.broadcastToSession.push({ sessionId, message, exclude }),
      sendToController: (sessionId, message) => spy.sendToController.push({ sessionId, message }),
      sendToAskTargets: (sessionId, _authority, message) => spy.sendToAskTargets.push({ sessionId, message }),
    },
    actor: {
      attachOriginToSession: (o, sessionId) => spy.attached.push({ origin: o, sessionId }),
    },
  };
}

function makeSpy(): DeliverySpy {
  return {
    sent: [],
    broadcast: [],
    broadcastToSession: [],
    sendToController: [],
    sendToAskTargets: [],
    attached: [],
  };
}

function noGate(): ControllerGatePort<Origin> {
  return { checkControllerGate: () => null };
}

function rejectGate(rejection: Partial<ControllerGateRejection> = {}): ControllerGatePort<Origin> {
  return {
    checkControllerGate: (sessionId, action) => ({
      sessionId,
      action,
      code: 'not_controller',
      message: 'Only the current controller can perform this action',
      control: {
        sessionId,
        controllerClientId: 'other',
        controllerConnectionId: 'other-conn',
        acquiredAt: null,
        lastHeartbeatAt: null,
        leaseExpiresAt: null,
        status: 'controlled',
        pendingTakeover: null,
      },
      ...rejection,
    }),
  };
}

function makeExecution(overrides: Partial<SessionExecutionPort> = {}): SessionExecutionPort {
  return {
    sendMessage: async () => {},
    editMessage: async () => {},
    regenerateTitle: async () => {},
    interruptSession: async () => ({ sessionId: 'sess-1', success: true, cascadedTo: [], interruptedTools: [], rejectedAsks: [] }),
    isSessionActive: () => false,
    compact: async () => ({ ok: false, error: 'empty', skipped: true }),
    revert: async () => ({ revertedTo: { messageId: null, messageCount: 0 }, removed: { messageIds: [], partCount: 0 } }),
    fork: async () => ({ forkedSession: makeSession({ id: 'fork-1' }), messages: [] }),
    ...overrides,
  };
}

function makeRepository(overrides: Partial<SessionRepositoryPort> = {}): SessionRepositoryPort {
  return {
    createSession: () => makeSession(),
    getSession: () => makeSession(),
    updateSession: () => makeSession(),
    deleteSession: () => true,
    listSessions: () => [],
    listSessionsByWorkspace: () => [],
    listSessionsByAgent: () => [],
    listSessionsGrouped: () => ({}),
    listSessionPageGrouped: () => ({ sessions: {}, pagination: {} }),
    listTagsByWorkspace: () => [],
    listMessages: () => [],
    listLatestMessagesWithPartsPage: () => ({ messages: [], pagination: { hasOlder: false, oldestSequence: null, newestSequence: null, limit: 50 } }),
    listMessagesWithPartsBeforeSequence: () => ({ messages: [], pagination: { hasOlder: false, oldestSequence: null, newestSequence: null, limit: 50 } }),
    getToolPart: () => null,
    reconcileCompaction: async () => 0,
    reconcileOrphanedToolCalls: () => 0,
    listQueuedMessages: () => [],
    addMessageToQueue: () => ({ id: 'q-1', sessionId: 'sess-1', content: 'queued', position: 0, createdAt: 1 }),
    getQueuedMessage: () => null,
    deleteQueuedMessage: () => true,
    markManualSessionTitle: (metadata) => ({ ...(metadata ?? {}), titleManuallyRenamed: true }),
    getWorkspaceAutoApproveSeverity: () => 'low',
    getPreconfigOrAgent: async () => null,
    isAgentSync: () => false,
    toolOutput: {
      defaultPageChars: 100,
      maxPageChars: 200,
      isArtifactId: () => true,
      getPage: () => null,
    },
    attachments: {
      maxSize: 100,
      determineKind: () => 'file',
      validateImageMime: () => true,
      getByKey: () => null,
      listForSession: () => [],
      create: () => { throw new Error('not used'); },
      readFileBuffer: () => null,
    },
    ...overrides,
  };
}

function makePendingAsks(): PendingAskPort {
  return {
    listAllPendingAsks: () => [],
    listPendingRequestsByRootSession: () => [],
    cleanupAllPendingAsks: () => 0,
  };
}

function makeAskAuthority(): AskAuthorityPort {
  return { timeoutMs: 300_000, getAuthorityForPendingAsk: () => undefined };
}

function makeControl(): SessionControlPort<Origin> {
  const uncontrolled = { sessionId: 'sess-1', controllerClientId: null, controllerConnectionId: null, acquiredAt: null, status: 'uncontrolled' as const };
  return {
    claim: () => ({ success: false, error: 'nope', code: 'already_controlled', controlState: uncontrolled }),
    release: () => ({ success: false, error: 'nope', code: 'already_controlled', controlState: uncontrolled }),
    resumeControl: () => ({ controlState: uncontrolled, transitionReason: null }),
    buildControlUpdatedMessage: () => ({ type: 'session.control.updated', control: uncontrolled, reason: 'claimed' }),
  };
}

function makeDeps(overrides: Partial<SessionApplicationDeps<Origin>> = {}): SessionApplicationDeps<Origin> {
  return {
    repository: makeRepository(),
    execution: makeExecution(),
    gate: noGate(),
    control: makeControl(),
    pendingAsks: makePendingAsks(),
    askAuthority: makeAskAuthority(),
    ...overrides,
  };
}

describe('application session use cases', () => {
  describe('chat', () => {
    test('send passes the gate and delegates to execution with the same arguments', async () => {
      const calls: unknown[] = [];
      const execution = makeExecution({
        sendMessage: async (...args: unknown[]) => {
          calls.push(args);
        },
      });
      const app = createSessionChatApplication({ repository: makeRepository(), execution, gate: noGate() });
      const spy = makeSpy();
      const wire = makeWire(spy);

      await app.sendMessage(wire, origin, 'sess-1', 'hello', [{ id: 'a', kind: 'image' }], 'fmt-1', 'goal', 3);

      expect(calls).toHaveLength(1);
      const call = calls[0] as unknown[];
      expect(call[0]).toBe(wire);
      expect(call[1]).toBe(origin);
      expect(call[2]).toBe('sess-1');
      expect(call[3]).toBe('hello');
      expect(call[4]).toEqual([{ id: 'a', kind: 'image' }]);
      expect(call[5]).toBe('fmt-1');
      expect(call[6]).toBe('goal');
      expect(call[7]).toBe(3);
    });

    test('send delivers the exact gate rejection and does not execute', async () => {
      const execution = makeExecution({ sendMessage: async () => { throw new Error('must not run'); } });
      const app = createSessionChatApplication({ repository: makeRepository(), execution, gate: rejectGate() });
      const spy = makeSpy();
      const wire = makeWire(spy);

      await app.sendMessage(wire, origin, 'sess-1', 'hello');

      expect(spy.sent).toEqual([{
        type: 'session.action_rejected',
        sessionId: 'sess-1',
        action: 'chat.message',
        code: 'not_controller',
        message: 'Only the current controller can perform this action',
        control: {
          sessionId: 'sess-1',
          controllerClientId: 'other',
          controllerConnectionId: 'other-conn',
          acquiredAt: null,
          lastHeartbeatAt: null,
          leaseExpiresAt: null,
          status: 'controlled',
          pendingTakeover: null,
        },
      }]);
    });

    test('edit gates with the chat.message action', async () => {
      const gateCalls: Array<{ sessionId: string; action: string }> = [];
      const gate: ControllerGatePort<Origin> = {
        checkControllerGate: (sessionId, action) => {
          gateCalls.push({ sessionId, action });
          return null;
        },
      };
      const calls: unknown[] = [];
      const execution = makeExecution({ editMessage: async (...args: unknown[]) => { calls.push(args); } });
      const app = createSessionChatApplication({ repository: makeRepository(), execution, gate });
      const wire = makeWire(makeSpy());

      await app.editMessage(wire, origin, { sessionId: 'sess-1', messageId: 'm-1', content: 'edited' });

      expect(gateCalls).toEqual([{ sessionId: 'sess-1', action: 'chat.message' }]);
      expect(calls).toHaveLength(1);
    });

    test('generateTitle fires and forgets the regeneration after the existence check', () => {
      const regenerateCalls: Array<{ sessionId: string; options?: { force?: boolean } }> = [];
      const execution = makeExecution({
        regenerateTitle: async (_wire, _origin, sessionId: string, options?: { force?: boolean }) => {
          regenerateCalls.push({ sessionId, options });
        },
      });
      const app = createSessionChatApplication({ repository: makeRepository(), execution, gate: noGate() });
      const spy = makeSpy();
      const wire = makeWire(spy);

      app.generateTitle(wire, origin, 'sess-1', true);

      expect(regenerateCalls).toEqual([{ sessionId: 'sess-1', options: { force: true } }]);
      expect(spy.sent).toEqual([]);
    });

    test('generateTitle reports not_found for a missing session', () => {
      const execution = makeExecution({ regenerateTitle: async () => { throw new Error('must not run'); } });
      const app = createSessionChatApplication({
        repository: makeRepository({ getSession: () => null }),
        execution,
        gate: noGate(),
      });
      const spy = makeSpy();
      const wire = makeWire(spy);

      app.generateTitle(wire, origin, 'missing', true);

      expect(spy.sent).toEqual([{ type: 'error', code: 'not_found', message: 'Session not found', sessionId: 'missing' }]);
    });
  });

  describe('transcript', () => {
    test('compact maps ok results to compaction.complete', async () => {
      const execution = makeExecution({
        compact: async () => ({ ok: true, result: { tokensUsed: { prompt: 10, completion: 20 } } }),
      });
      const app = createSessionTranscriptApplication({ repository: makeRepository(), execution, gate: noGate() });
      const spy = makeSpy();
      const wire = makeWire(spy);

      await app.compact(wire, origin, 'sess-1');

      expect(spy.sent).toEqual([{ type: 'compaction.complete', sessionId: 'sess-1', tokensUsed: { prompt: 10, completion: 20 } }]);
    });

    test('compact delivers the gate rejection and does not execute', async () => {
      const execution = makeExecution({ compact: async () => { throw new Error('must not run'); } });
      const app = createSessionTranscriptApplication({ repository: makeRepository(), execution, gate: rejectGate() });
      const spy = makeSpy();
      const wire = makeWire(spy);

      await app.compact(wire, origin, 'sess-1');

      expect(spy.sent[0]).toMatchObject({ type: 'session.action_rejected', sessionId: 'sess-1', action: 'session.compact', code: 'not_controller' });
    });

    test('compact maps skipped failures to invalid_session', async () => {
      const execution = makeExecution({ compact: async () => ({ ok: false, error: 'Compaction is only available for main sessions', skipped: true }) });
      const app = createSessionTranscriptApplication({ repository: makeRepository(), execution, gate: noGate() });
      const spy = makeSpy();
      const wire = makeWire(spy);

      await app.compact(wire, origin, 'sess-1');

      expect(spy.sent).toEqual([{ type: 'error', code: 'invalid_session', message: 'Compaction is only available for main sessions', sessionId: 'sess-1' }]);
    });

    test('compact maps non-skipped failures to compaction_error and missing sessions to not_found', async () => {
      const execution = makeExecution({ compact: async () => ({ ok: false, error: 'boom' }) });
      const app = createSessionTranscriptApplication({ repository: makeRepository(), execution, gate: noGate() });
      const spy = makeSpy();
      const wire = makeWire(spy);

      await app.compact(wire, origin, 'sess-1');
      expect(spy.sent).toEqual([{ type: 'error', code: 'compaction_error', message: 'boom', sessionId: 'sess-1' }]);

      spy.sent.length = 0;
      const missingApp = createSessionTranscriptApplication({
        repository: makeRepository({ getSession: () => null }),
        execution,
        gate: noGate(),
      });
      await missingApp.compact(wire, origin, 'sess-1');
      expect(spy.sent).toEqual([{ type: 'error', code: 'not_found', message: 'Session not found', sessionId: 'sess-1' }]);
    });

    test('revert broadcasts session.reverted then session.state in order', async () => {
      const page = { messages: [{ message: { id: 'm-1' }, parts: [] }], pagination: { hasOlder: false, oldestSequence: null, newestSequence: null, limit: 50 } };
      const execution = makeExecution({
        revert: async () => ({ revertedTo: { messageId: 'm-2', messageCount: 2 }, removed: { messageIds: ['m-3'], partCount: 1 } }),
      });
      const repository = makeRepository({
        listLatestMessagesWithPartsPage: () => page as never,
      });
      const app = createSessionTranscriptApplication({ repository, execution, gate: noGate() });
      const spy = makeSpy();
      const wire = makeWire(spy);

      await app.revert(wire, origin, { sessionId: 'sess-1', messageId: 'm-2' });

      expect(spy.broadcastToSession.map(({ message }) => message.type)).toEqual(['session.reverted', 'session.state']);
      expect(spy.broadcastToSession[0].message).toMatchObject({ type: 'session.reverted', revertedTo: { messageId: 'm-2' } });
    });

    test('revert delivers the gate rejection and does not execute', async () => {
      const execution = makeExecution({ revert: async () => { throw new Error('must not run'); } });
      const app = createSessionTranscriptApplication({ repository: makeRepository(), execution, gate: rejectGate() });
      const spy = makeSpy();
      const wire = makeWire(spy);

      await app.revert(wire, origin, { sessionId: 'sess-1', messageId: 'm-2' });

      expect(spy.sent[0]).toMatchObject({ type: 'session.action_rejected', sessionId: 'sess-1', action: 'session.revert', code: 'not_controller' });
    });

    test('revert maps thrown errors to revert_error', async () => {
      const execution = makeExecution({ revert: async () => { throw new Error('Target message not found'); } });
      const app = createSessionTranscriptApplication({ repository: makeRepository(), execution, gate: noGate() });
      const spy = makeSpy();
      const wire = makeWire(spy);

      await app.revert(wire, origin, { sessionId: 'sess-1', messageId: 'nope' });

      expect(spy.sent).toEqual([{ type: 'error', code: 'revert_error', message: 'Target message not found', sessionId: 'sess-1' }]);
    });

    test('fork broadcasts session.forked with the forked transcript page', async () => {
      const forkedSession = makeSession({ id: 'fork-1', title: 'My Fork' });
      const page = { messages: [{ message: { id: 'fm-1' }, parts: [] }], pagination: { hasOlder: false, oldestSequence: null, newestSequence: null, limit: 50 } };
      const execution = makeExecution({ fork: async () => ({ forkedSession, messages: [] }) });
      const repository = makeRepository({ listLatestMessagesWithPartsPage: () => page as never });
      const app = createSessionTranscriptApplication({ repository, execution, gate: noGate() });
      const spy = makeSpy();
      const wire = makeWire(spy);

      await app.fork(wire, origin, { sessionId: 'sess-1', messageId: 'm-1', title: 'My Fork' });

      expect(spy.broadcastToSession).toHaveLength(1);
      expect(spy.broadcastToSession[0].message).toMatchObject({
        type: 'session.forked',
        originalSessionId: 'sess-1',
        forkedSession,
      });
    });

    test('fork maps thrown errors to fork_error', async () => {
      const execution = makeExecution({ fork: async () => { throw new Error('Source session not found'); } });
      const app = createSessionTranscriptApplication({ repository: makeRepository(), execution, gate: noGate() });
      const spy = makeSpy();
      const wire = makeWire(spy);

      await app.fork(wire, origin, { sessionId: 'sess-1', messageId: 'x' });

      expect(spy.sent).toEqual([{ type: 'error', code: 'fork_error', message: 'Source session not found', sessionId: 'sess-1' }]);
    });

    test('fork delivers the gate rejection and does not execute', async () => {
      const execution = makeExecution({ fork: async () => { throw new Error('must not run'); } });
      const app = createSessionTranscriptApplication({ repository: makeRepository(), execution, gate: rejectGate() });
      const spy = makeSpy();
      const wire = makeWire(spy);

      await app.fork(wire, origin, { sessionId: 'sess-1', messageId: 'm-1' });

      expect(spy.sent[0]).toMatchObject({ type: 'session.action_rejected', sessionId: 'sess-1', action: 'session.fork', code: 'not_controller' });
    });

    test('interrupt gates, executes with the reason default, and broadcasts session.interrupted', async () => {
      const interruptCalls: unknown[] = [];
      const execution = makeExecution({
        interruptSession: async (sessionId: string, reason?: string) => {
          interruptCalls.push([sessionId, reason]);
          return { sessionId, success: true, cascadedTo: [], interruptedTools: ['t-1'], rejectedAsks: [] };
        },
      });
      const app = createSessionTranscriptApplication({ repository: makeRepository(), execution, gate: noGate() });
      const spy = makeSpy();
      const wire = makeWire(spy);

      await app.interrupt(wire, origin, { sessionId: 'sess-1' });

      expect(interruptCalls).toEqual([['sess-1', 'user_request']]);
      expect(spy.broadcastToSession).toHaveLength(1);
      expect(spy.broadcastToSession[0].message).toMatchObject({ type: 'session.interrupted', sessionId: 'sess-1' });
    });

    test('interrupt delivers the gate rejection before executing', async () => {
      const execution = makeExecution({ interruptSession: async () => { throw new Error('must not run'); } });
      const app = createSessionTranscriptApplication({ repository: makeRepository(), execution, gate: rejectGate() });
      const spy = makeSpy();
      const wire = makeWire(spy);

      await app.interrupt(wire, origin, { sessionId: 'sess-1' });

      expect(spy.sent).toEqual([expect.objectContaining({ type: 'session.action_rejected', action: 'session.interrupt' })]);
    });

    test('interrupt maps thrown errors to interrupt_error without a sessionId', async () => {
      const execution = makeExecution({ interruptSession: async () => { throw new Error('boom'); } });
      const app = createSessionTranscriptApplication({ repository: makeRepository(), execution, gate: noGate() });
      const spy = makeSpy();
      const wire = makeWire(spy);

      await app.interrupt(wire, origin, { sessionId: 'sess-1' });

      expect(spy.sent).toEqual([{ type: 'error', code: 'interrupt_error', message: 'boom' }]);
    });
  });

  describe('queue', () => {
    test('add checks session, gate, and content before enqueueing and attaches the origin', () => {
      const calls: unknown[] = [];
      const repository = makeRepository({
        addMessageToQueue: (sessionId: string, content: string, attachments?: Array<{ id: string; kind: string }>) => {
          calls.push([sessionId, content, attachments]);
          return { id: 'q-1', sessionId, content, position: 0, createdAt: 1 };
        },
      });
      const app = createSessionQueueApplication({ repository, gate: noGate() });
      const spy = makeSpy();
      const wire = makeWire(spy);

      app.add(wire, origin, { sessionId: 'sess-1', content: '  queued  ', attachments: [{ id: 'a', kind: 'image' }] });

      expect(calls).toEqual([['sess-1', '  queued  ', [{ id: 'a', kind: 'image' }]]]);
      expect(spy.attached).toEqual([{ origin, sessionId: 'sess-1' }]);
      expect(spy.sent).toEqual([expect.objectContaining({ type: 'queue.added', sessionId: 'sess-1' })]);
    });

    test('add rejects empty content with invalid_content before enqueueing', () => {
      const repository = makeRepository({ addMessageToQueue: () => { throw new Error('must not run'); } });
      const app = createSessionQueueApplication({ repository, gate: noGate() });
      const spy = makeSpy();
      const wire = makeWire(spy);

      app.add(wire, origin, { sessionId: 'sess-1', content: '   ' });

      expect(spy.sent).toEqual([{ type: 'error', code: 'invalid_content', message: 'Content cannot be empty' }]);
    });

    test('remove gates on the queued message session and reports the removed session', () => {
      const gateCalls: Array<{ sessionId: string; action: string }> = [];
      const gate: ControllerGatePort<Origin> = {
        checkControllerGate: (sessionId, action) => {
          gateCalls.push({ sessionId, action });
          return null;
        },
      };
      const repository = makeRepository({
        getQueuedMessage: () => ({ id: 'q-1', sessionId: 'other-session', content: 'x', position: 0, createdAt: 1 }),
      });
      const app = createSessionQueueApplication({ repository, gate });
      const spy = makeSpy();
      const wire = makeWire(spy);

      app.remove(wire, origin, 'q-1');

      expect(gateCalls).toEqual([{ sessionId: 'other-session', action: 'queue.remove' }]);
      expect(spy.sent).toEqual([{ type: 'queue.removed', sessionId: 'other-session', queueId: 'q-1' }]);
    });

    test('remove reports not_found for unknown queue ids', () => {
      const app = createSessionQueueApplication({ repository: makeRepository({ getQueuedMessage: () => null }), gate: noGate() });
      const spy = makeSpy();
      const wire = makeWire(spy);

      app.remove(wire, origin, 'missing');

      expect(spy.sent).toEqual([{ type: 'error', code: 'not_found', message: 'Queued message not found' }]);
    });
  });

  describe('lifecycle', () => {
    test('create uses the workspace auto-approve severity, attaches the origin, and sends then broadcasts', async () => {
      const session = makeSession({ id: 'created-1' });
      const autoApproveCalls: string[] = [];
      const createInputs: unknown[] = [];
      const repository = makeRepository({
        getWorkspaceAutoApproveSeverity: (workspaceId: string) => {
          autoApproveCalls.push(workspaceId);
          return 'medium';
        },
        createSession: (input) => {
          createInputs.push(input);
          return session;
        },
      });
      const app = createSessionLifecycleApplication({ ...makeDeps({ repository }) });
      const spy = makeSpy();
      const wire = makeWire(spy);

      await app.create(wire, origin, { workspaceId: 'ws-9', preconfigId: undefined, title: 'Custom' });

      expect(autoApproveCalls).toEqual(['ws-9']);
      expect(createInputs[0]).toMatchObject({ workspaceId: 'ws-9', title: 'Custom', autoApproveSeverity: 'medium', status: 'active' });
      expect(spy.attached).toEqual([{ origin, sessionId: 'created-1' }]);
      expect(spy.sent).toEqual([{ type: 'session.created', session }]);
      expect(spy.broadcast).toEqual([{ message: { type: 'session.created', session }, exclude: origin }]);
    });

    test('create enriches the session from the preconfig and delivers the updated session', async () => {
      const preconfig = { id: 'pre-1', name: 'P', model: 'gpt-4o', provider: 'openai', variant: 'v1' };
      const updated = makeSession({ id: 'created-1', preconfigId: 'pre-1' });
      const repository = makeRepository({
        getPreconfigOrAgent: async () => preconfig as never,
        isAgentSync: () => false,
        updateSession: () => updated,
      });
      const app = createSessionLifecycleApplication({ ...makeDeps({ repository }) });
      const spy = makeSpy();
      const wire = makeWire(spy);

      await app.create(wire, origin, { workspaceId: 'ws-9', preconfigId: 'pre-1' });

      expect(spy.sent).toEqual([{ type: 'session.created', session: updated }]);
      expect(spy.broadcast).toEqual([{ message: { type: 'session.created', session: updated }, exclude: origin }]);
    });

    test('resume delivers resumed, control transition, queue list, and pending ask sync in order', async () => {
      const order: string[] = [];
      const resumeSession = makeSession();
      const queued = { id: 'q-1', sessionId: 'sess-1', content: 'queued', position: 0, createdAt: 1 };
      const pendingAsk = {
        id: 'pa-1',
        requestId: 'r-1',
        sessionId: 'sess-1',
        toolCallId: 'tc-1',
        toolName: 'ask-tool',
        ask: { type: 'text', question: 'Q?', target: 'human' } as const,
        status: 'pending' as const,
        isPermission: false,
        createdAt: 1,
      } as PendingAskRecord;
      const transcriptPage = {
        messages: [],
        pagination: { hasOlder: false, oldestSequence: null, newestSequence: null, limit: 50 },
      };
      const repository = makeRepository({
        getSession: () => resumeSession,
        listLatestMessagesWithPartsPage: () => transcriptPage as never,
        listQueuedMessages: () => [queued],
        reconcileCompaction: async () => { order.push('reconcile-compaction'); return 0; },
        reconcileOrphanedToolCalls: () => { order.push('reconcile-tools'); return 0; },
      });
      const pendingAsks: PendingAskPort = {
        cleanupAllPendingAsks: () => { order.push('cleanup-asks'); return 0; },
        listPendingRequestsByRootSession: () => { order.push('list-root-asks'); return [pendingAsk]; },
        listAllPendingAsks: () => { order.push('list-all-asks'); return []; },
      };
      const control = makeControl();
      const controlResult = {
        controlState: {
          sessionId: 'sess-1',
          controllerClientId: 'me',
          controllerConnectionId: origin,
          acquiredAt: null,
          lastHeartbeatAt: null,
          leaseExpiresAt: null,
          status: 'controlled' as const,
          pendingTakeover: null,
        },
        transitionReason: 'auto_claimed' as const,
      };
      const deps = makeDeps({
        repository,
        pendingAsks,
        control: {
          ...control,
          resumeControl: () => controlResult,
          buildControlUpdatedMessage: () => ({ type: 'session.control.updated', control: controlResult.controlState, reason: 'auto_claimed' }),
        },
      });
      const app = createSessionLifecycleApplication(deps);
      const spy = makeSpy();
      const wire = makeWire(spy);
      const wire2: SessionWirePorts<Origin> = {
        ...wire,
        delivery: {
          ...wire.delivery,
          send: (o, message) => {
            expect(o).toBe(origin);
            spy.sent.push(message);
            if (message.type === 'session.resumed') order.push('resumed');
            if (message.type === 'queue.list') order.push('queue-list');
            if (message.type === 'ask.pending_sync') order.push('ask-sync');
          },
          broadcastToSession: (sessionId, message, exclude) => {
            spy.broadcastToSession.push({ sessionId, message, exclude });
            if (message.type === 'session.control.updated') order.push('control-updated');
          },
        },
      };

      await app.resume(wire2, origin, 'sess-1');

      expect(order).toEqual([
        'reconcile-compaction',
        'reconcile-tools',
        'resumed',
        'control-updated',
        'queue-list',
        'cleanup-asks',
        'list-root-asks',
        'list-all-asks',
        'ask-sync',
      ]);
      const resumed = spy.sent.find((m) => m.type === 'session.resumed');
      expect(resumed).toMatchObject({ isRunning: false, control: controlResult.controlState });
      const sync = spy.sent.find((m) => m.type === 'ask.pending_sync');
      expect(sync).toMatchObject({
        sessionId: 'sess-1',
        requests: [{
          sessionId: 'sess-1',
          toolCallId: 'tc-1',
          toolName: 'ask-tool',
          authority: { visibilityScope: 'controller_only', resolutionMode: 'controller_only' },
        }],
      });
    });

    test('update enriches preconfig selection and sends session.updated', async () => {
      const preconfig = { id: 'pre-1', name: 'P', model: null, provider: null, variant: 'v2' };
      const updated = makeSession({ preconfigId: 'pre-1' });
      const repository = makeRepository({
        getPreconfigOrAgent: async () => preconfig as never,
        isAgentSync: () => true,
        updateSession: () => updated,
      });
      const app = createSessionLifecycleApplication({ ...makeDeps({ repository }) });
      const spy = makeSpy();
      const wire = makeWire(spy);

      await app.update(wire, origin, { sessionId: 'sess-1', preconfigId: 'pre-1' });

      expect(spy.sent).toEqual([{ type: 'session.updated', session: updated }]);
    });

    test('update maps an empty preconfig variant to null, preserving the pre-S3 truthy check', async () => {
      const updateInputs: unknown[] = [];
      const repository = makeRepository({
        getPreconfigOrAgent: async () => ({ id: 'pre-1', name: 'P', model: null, provider: null, variant: '' }) as never,
        isAgentSync: () => false,
        updateSession: (_id, updates) => {
          updateInputs.push(updates);
          return makeSession();
        },
      });
      const app = createSessionLifecycleApplication({ ...makeDeps({ repository }) });
      const wire = makeWire(makeSpy());

      await app.update(wire, origin, { sessionId: 'sess-1', preconfigId: 'pre-1' });

      expect(updateInputs).toEqual([{ preconfigId: 'pre-1', selectedVariant: null, agentId: null }]);
    });

    test('updateModel sends session.updated with the exact selection', () => {
      const updateInputs: unknown[] = [];
      const repository = makeRepository({
        updateSession: (_id, updates) => {
          updateInputs.push(updates);
          return makeSession();
        },
      });
      const app = createSessionLifecycleApplication({ ...makeDeps({ repository }) });
      const spy = makeSpy();
      const wire = makeWire(spy);

      app.updateModel(wire, origin, { sessionId: 'sess-1', modelId: 'm', providerId: 'p', variant: undefined });

      expect(updateInputs).toEqual([{ selectedModel: 'm', selectedProvider: 'p', selectedVariant: null }]);
      expect(spy.sent[0].type).toBe('session.updated');
    });

    test('close updates without an existence check and always sends session.closed', () => {
      const updateInputs: unknown[] = [];
      const repository = makeRepository({
        getSession: () => null,
        updateSession: (_id, updates) => {
          updateInputs.push(updates);
          return null;
        },
      });
      const app = createSessionLifecycleApplication({ ...makeDeps({ repository }) });
      const spy = makeSpy();
      const wire = makeWire(spy);

      app.close(wire, origin, 'sess-1');

      expect(updateInputs).toEqual([{ status: 'closed' }]);
      expect(spy.sent).toEqual([{ type: 'session.closed', sessionId: 'sess-1' }]);
    });

    test('reopen requires the session and sends session.reopened', () => {
      const app = createSessionLifecycleApplication({ ...makeDeps({}) });
      const spy = makeSpy();
      const wire = makeWire(spy);

      app.reopen(wire, origin, 'sess-1');
      expect(spy.sent).toEqual([expect.objectContaining({ type: 'session.reopened' })]);

      spy.sent.length = 0;
      const missingApp = createSessionLifecycleApplication({
        ...makeDeps({ repository: makeRepository({ getSession: () => null }) }),
      });
      missingApp.reopen(wire, origin, 'sess-1');
      expect(spy.sent).toEqual([{ type: 'error', code: 'not_found', message: 'Session not found' }]);
    });

    test('remove deletes and sends session.deleted, mapping failures to delete_error', () => {
      const app = createSessionLifecycleApplication({ ...makeDeps({}) });
      const spy = makeSpy();
      const wire = makeWire(spy);

      app.remove(wire, origin, 'sess-1');
      expect(spy.sent).toEqual([{ type: 'session.deleted', sessionId: 'sess-1' }]);

      spy.sent.length = 0;
      const failingApp = createSessionLifecycleApplication({
        ...makeDeps({ repository: makeRepository({ deleteSession: () => { throw new Error('db down'); } }) }),
      });
      failingApp.remove(wire, origin, 'sess-1');
      expect(spy.sent).toEqual([{ type: 'error', code: 'delete_error', message: 'db down', sessionId: 'sess-1' }]);
    });

    test('rename trims, marks the manual title, and broadcasts session.renamed', () => {
      const updateInputs: unknown[] = [];
      const repository = makeRepository({
        getSession: () => makeSession({ metadata: { existing: true } }),
        updateSession: (_id, updates) => {
          updateInputs.push(updates);
          return makeSession();
        },
      });
      const app = createSessionLifecycleApplication({ ...makeDeps({ repository }) });
      const spy = makeSpy();
      const wire = makeWire(spy);

      app.rename(wire, origin, { sessionId: 'sess-1', title: '  Fresh  ' });

      expect(updateInputs).toEqual([{ title: 'Fresh', metadata: { existing: true, titleManuallyRenamed: true } }]);
      expect(spy.broadcastToSession).toEqual([expect.objectContaining({ sessionId: 'sess-1', message: expect.objectContaining({ type: 'session.renamed' }) })]);
    });

    test('rename rejects empty titles with invalid_title', () => {
      const app = createSessionLifecycleApplication({ ...makeDeps({}) });
      const spy = makeSpy();
      const wire = makeWire(spy);

      app.rename(wire, origin, { sessionId: 'sess-1', title: '   ' });

      expect(spy.sent).toEqual([{ type: 'error', code: 'invalid_title', message: 'Title cannot be empty', sessionId: 'sess-1' }]);
    });

    test('update and updateModel deliver gate rejections with the exact actions', async () => {
      const gateCalls: string[] = [];
      const gate: ControllerGatePort<Origin> = {
        checkControllerGate: (_sessionId, action) => {
          gateCalls.push(action);
          return {
            sessionId: 'sess-1',
            action,
            code: 'not_controller',
            message: 'Only the current controller can perform this action',
            control: {
              sessionId: 'sess-1',
              controllerClientId: 'other',
              controllerConnectionId: 'other-conn',
              acquiredAt: null,
              lastHeartbeatAt: null,
              leaseExpiresAt: null,
              status: 'controlled',
              pendingTakeover: null,
            },
          };
        },
      };
      const app = createSessionLifecycleApplication({ ...makeDeps({ gate }) });
      const spy = makeSpy();
      const wire = makeWire(spy);

      await app.update(wire, origin, { sessionId: 'sess-1', preconfigId: 'pre-1' });
      app.updateModel(wire, origin, { sessionId: 'sess-1', modelId: 'm', providerId: 'p' });

      expect(gateCalls).toEqual(['session.update', 'session.update_model']);
      expect(spy.sent.map((m) => m.type)).toEqual(['session.action_rejected', 'session.action_rejected']);
    });
  });

  describe('composition', () => {
    test('createSessionApplication composes chat, lifecycle, transcript, and queue over one port set', async () => {
      const execution = makeExecution({
        sendMessage: async (_wire, _origin, _sessionId, content: string) => {
          expect(content).toBe('hi');
        },
      });
      const app = createSessionApplication(makeDeps({ execution }));
      expect(app.chat).toBeDefined();
      expect(app.lifecycle).toBeDefined();
      expect(app.transcript).toBeDefined();
      expect(app.queue).toBeDefined();

      const wire = makeWire(makeSpy());
      await app.chat.sendMessage(wire, origin, 'sess-1', 'hi');
    });
  });
});
