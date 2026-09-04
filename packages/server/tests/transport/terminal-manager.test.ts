import { afterEach, describe, expect, mock, test } from 'bun:test';
import { mkdtempSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import type { ServerWebSocket } from 'bun';
import { TerminalManager } from '@/transport/terminal/manager';
import { TerminalEventManager } from '@/transport/terminal/event-manager';
import {
  decodeFrame,
  getTerminalEventManager,
  getTerminalManager,
  installTerminalSessionStore,
  OPCODES,
} from '@/transport/terminal';
import type {
  CreateTerminalSessionInput,
  TerminalSessionRow,
  TerminalSessionStorePort,
} from '@/application/ports/terminal';

// ---------------------------------------------------------------------------
// Fake PTY over mock.module('bun-pty'): the manager keeps PTY/transport
// ownership; only the spawn boundary is simulated so frame/event ordering,
// lifecycle, and persistence calls stay deterministic.
// ---------------------------------------------------------------------------

interface SpawnOptions {
  name: string;
  cols: number;
  rows: number;
  cwd: string;
  env: Record<string, string>;
}

class FakePty {
  pid = 0;
  writeCalls: string[] = [];
  resizeCalls: Array<{ cols: number; rows: number }> = [];
  killed = false;
  spawnCall: { shell: string; args: string[]; options: SpawnOptions } | null = null;
  private dataHandlers: Array<(data: string) => void> = [];
  private exitHandlers: Array<(event: { exitCode: number }) => void> = [];

  onData(handler: (data: string) => void): void {
    this.dataHandlers.push(handler);
  }

  onExit(handler: (event: { exitCode: number }) => void): void {
    this.exitHandlers.push(handler);
  }

  write(data: string): void {
    this.writeCalls.push(data);
  }

  resize(cols: number, rows: number): void {
    this.resizeCalls.push({ cols, rows });
  }

  kill(): void {
    this.killed = true;
  }

  emitData(data: string): void {
    for (const handler of this.dataHandlers) handler(data);
  }

  emitExit(exitCode: number): void {
    for (const handler of this.exitHandlers) handler({ exitCode });
  }
}

const ptyState = {
  instances: [] as FakePty[],
  failNextSpawn: false,
};

mock.module('bun-pty', () => ({
  spawn: (shell: string, args: string[], options: SpawnOptions): FakePty => {
    if (ptyState.failNextSpawn) {
      ptyState.failNextSpawn = false;
      throw new Error('simulated spawn failure');
    }
    const pty = new FakePty();
    pty.pid = 4242 + ptyState.instances.length;
    pty.spawnCall = { shell, args, options };
    ptyState.instances.push(pty);
    return pty;
  },
}));

// ---------------------------------------------------------------------------
// Fakes: terminal client sockets, recording store port, and event capture.
// ---------------------------------------------------------------------------

const OPCODE_NAMES: Record<number, string> = {
  [OPCODES.INPUT]: 'INPUT',
  [OPCODES.RESIZE]: 'RESIZE',
  [OPCODES.CLOSE]: 'CLOSE',
  [OPCODES.OUTPUT]: 'OUTPUT',
  [OPCODES.EXIT]: 'EXIT',
  [OPCODES.ERROR]: 'ERROR',
  [OPCODES.INIT_ACK]: 'INIT_ACK',
  [OPCODES.TITLE]: 'TITLE',
  [OPCODES.REPLAY_COMPLETE]: 'REPLAY_COMPLETE',
};

function makeClientSocket(order?: string[]) {
  const sent: Uint8Array[] = [];
  const closed: boolean[] = [];
  const socket = {
    send(data: string | Uint8Array) {
      const frame = typeof data === 'string' ? new TextEncoder().encode(data) : data;
      sent.push(frame);
      if (order) {
        order.push(`frame:${OPCODE_NAMES[decodeFrame(frame).opcode] ?? decodeFrame(frame).opcode}`);
      }
    },
    close() {
      closed.push(true);
    },
  } as unknown as ServerWebSocket<unknown>;
  return { socket, sent, closed };
}

function subscribeEvents(
  eventManager: TerminalEventManager,
  workspaceId: string,
  order?: string[],
) {
  const events: Array<Record<string, unknown>> = [];
  const socket = {
    send(data: string) {
      const event = JSON.parse(data) as Record<string, unknown>;
      if (order) order.push(`event:${String(event.type)}`);
      events.push(event);
    },
  } as unknown as ServerWebSocket<unknown>;
  eventManager.subscribe(workspaceId, socket);
  return events;
}

class RecordingStore implements TerminalSessionStorePort {
  order: string[] = [];
  created: CreateTerminalSessionInput[] = [];
  exited: Array<{ id: string; exitCode: number }> = [];
  destroyed: string[] = [];

  createTerminalSession(session: CreateTerminalSessionInput): void {
    this.order.push('store:createTerminalSession');
    this.created.push(session);
  }

  updateTerminalSessionTitle(): void {}

  updateTerminalSessionActivity(): void {}

  markTerminalSessionExited(id: string, exitCode: number): void {
    this.order.push('store:markTerminalSessionExited');
    this.exited.push({ id, exitCode });
  }

  markTerminalSessionDestroyed(id: string): void {
    this.order.push('store:markTerminalSessionDestroyed');
    this.destroyed.push(id);
  }

  getTerminalSession(): TerminalSessionRow | null {
    return null;
  }

  listTerminalSessions(): TerminalSessionRow[] {
    return [];
  }

  listActiveTerminalSessions(): TerminalSessionRow[] {
    return [];
  }

  cleanupStaleTerminalSessions(): number {
    return 0;
  }

  cleanupRunningSessionsOnStartup(): number {
    return 0;
  }

  clearedWorktreeReferences: string[] = [];

  clearManagedWorktreeReferences(worktreeId: string): void {
    this.clearedWorktreeReferences.push(worktreeId);
  }
}

function makeManager(store?: TerminalSessionStorePort) {
  const manager = new TerminalManager(store);
  const eventManager = new TerminalEventManager();
  manager.setEventManagerGetter(() => eventManager);
  return { manager, eventManager };
}

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const tempPaths: string[] = [];

function makeTempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'jean2-term-manager-'));
  tempPaths.push(dir);
  return dir;
}

afterEach(() => {
  ptyState.instances.length = 0;
  ptyState.failNextSpawn = false;
  for (const path of tempPaths.splice(0)) {
    rmSync(path, { recursive: true, force: true });
  }
  delete process.env.JEAN2_TERMINAL_MAX_SESSIONS;
  delete process.env.JEAN2_TERMINAL_BUFFER_BYTES;
});

describe('terminal manager (PTY/transport ownership)', () => {
  test('createSession rejects a missing cwd with the exact ERROR frame and close', () => {
    const store = new RecordingStore();
    const { manager } = makeManager(store);
    const { socket, sent, closed } = makeClientSocket();

    const id = manager.createSession(socket, {
      cwd: join(tmpdir(), 'definitely-missing-cwd'),
      workspaceId: 'w1',
    });

    expect(id).toBe('');
    expect(sent).toHaveLength(1);
    expect(sent[0][0]).toBe(OPCODES.ERROR);
    expect(new TextDecoder().decode(sent[0].slice(1))).toBe('{"message":"Invalid or missing working directory"}');
    expect(closed).toEqual([true]);
    expect(ptyState.instances).toHaveLength(0);
    expect(store.created).toHaveLength(0);
  });

  test('createSession rejects a non-directory cwd with the exact ERROR frame', () => {
    const dir = makeTempDir();
    const filePath = join(dir, 'plain-file');
    writeFileSync(filePath, 'not a directory');

    const store = new RecordingStore();
    const { manager } = makeManager(store);
    const { socket, sent, closed } = makeClientSocket();

    const id = manager.createSession(socket, { cwd: filePath, workspaceId: 'w1' });

    expect(id).toBe('');
    expect(new TextDecoder().decode(sent[0].slice(1))).toBe('{"message":"Path is not a directory"}');
    expect(closed).toEqual([true]);
    expect(store.created).toHaveLength(0);
  });

  test('createSession enforces the per-workspace session limit with the exact ERROR frame', () => {
    process.env.JEAN2_TERMINAL_MAX_SESSIONS = '1';
    const cwd = makeTempDir();
    const store = new RecordingStore();
    const { manager } = makeManager(store);

    const firstId = manager.createSessionDetached({ cwd, workspaceId: 'w1' });
    expect(firstId).toBeTypeOf('string');

    const { socket, sent, closed } = makeClientSocket();
    const id = manager.createSession(socket, { cwd, workspaceId: 'w1' });

    expect(id).toBe('');
    expect(new TextDecoder().decode(sent[0].slice(1))).toBe(
      '{"message":"Maximum terminal sessions reached for this workspace"}',
    );
    expect(closed).toEqual([true]);
    expect(manager.createSessionDetached({ cwd, workspaceId: 'w1' })).toBeNull();
    expect(store.created).toHaveLength(1);
  });

  test('createSession reports a spawn failure with the exact ERROR frame', () => {
    const originalError = console.error;
    console.error = () => {};
    try {
      ptyState.failNextSpawn = true;
      const cwd = makeTempDir();
      const store = new RecordingStore();
      const { manager } = makeManager(store);
      const { socket, sent, closed } = makeClientSocket();

      const id = manager.createSession(socket, { cwd, workspaceId: 'w1' });

      expect(id).toBe('');
      expect(new TextDecoder().decode(sent[0].slice(1))).toBe('{"message":"Failed to create terminal session"}');
      expect(closed).toEqual([true]);
      expect(store.created).toHaveLength(0);
    } finally {
      console.error = originalError;
    }
  });

  test('spawns via bun-pty with the exact options and persists the exact create input', () => {
    const cwd = makeTempDir();
    const store = new RecordingStore();
    const { manager, eventManager } = makeManager(store);
    const events = subscribeEvents(eventManager, 'w1');

    const id = manager.createSessionDetached({
      cwd,
      workspaceId: 'w1',
      shell: '/bin/zsh',
      cols: 100,
      rows: 30,
    }) as string;

    expect(id).toBeTypeOf('string');
    const pty = ptyState.instances[0];
    expect(pty.spawnCall).toMatchObject({
      shell: '/bin/zsh',
      args: [],
      options: {
        name: 'xterm-256color',
        cols: 100,
        rows: 30,
        cwd,
        env: { TERM: 'xterm-256color' },
      },
    });

    expect(store.created).toEqual([
      {
        id,
        workspaceId: 'w1',
        cwd,
        shell: '/bin/zsh',
        pid: pty.pid,
        cols: 100,
        rows: 30,
      },
    ]);
    expect(events.map((event) => event.type)).toEqual(['created']);
    expect(manager.getSession(id as string)).toMatchObject({
      id,
      pid: pty.pid,
      shell: '/bin/zsh',
      cwd,
      cols: 100,
      rows: 30,
      title: 'main',
      status: 'running',
      exitCode: null,
      inAlternateScreen: false,
      activeClientCount: 0,
    });
  });

  test('disables interactive pagers only for agent-created sessions', () => {
    const cwd = makeTempDir();
    const store = new RecordingStore();
    const { manager } = makeManager(store);
    const originalPager = process.env.PAGER;
    const originalGitPager = process.env.GIT_PAGER;
    const originalGhPager = process.env.GH_PAGER;

    try {
      process.env.PAGER = 'less';
      process.env.GIT_PAGER = 'delta';
      process.env.GH_PAGER = 'more';

      manager.createSessionDetached({ cwd, workspaceId: 'w1', origin: 'user' });
      manager.createSessionDetached({ cwd, workspaceId: 'w1', origin: 'agent' });

      expect(ptyState.instances[0].spawnCall?.options.env).toMatchObject({
        PAGER: 'less',
        GIT_PAGER: 'delta',
        GH_PAGER: 'more',
      });
      expect(ptyState.instances[1].spawnCall?.options.env).toMatchObject({
        PAGER: 'cat',
        GIT_PAGER: 'cat',
        GH_PAGER: 'cat',
      });
    } finally {
      if (originalPager === undefined) delete process.env.PAGER;
      else process.env.PAGER = originalPager;
      if (originalGitPager === undefined) delete process.env.GIT_PAGER;
      else process.env.GIT_PAGER = originalGitPager;
      if (originalGhPager === undefined) delete process.env.GH_PAGER;
      else process.env.GH_PAGER = originalGhPager;
    }
  });

  test('PTY output reaches connected clients as OUTPUT frames and is buffered', () => {
    const cwd = makeTempDir();
    const store = new RecordingStore();
    const { manager } = makeManager(store);
    const { socket, sent } = makeClientSocket();

    manager.createSession(socket, { cwd, workspaceId: 'w1' });
    ptyState.instances[0].emitData('hello world');

    expect(sent).toHaveLength(1);
    expect(sent[0][0]).toBe(OPCODES.OUTPUT);
    expect(new TextDecoder().decode(sent[0].slice(1))).toBe('hello world');
  });

  test('alternate screen sequences flip inAlternateScreen and broadcast status_changed', () => {
    const cwd = makeTempDir();
    const store = new RecordingStore();
    const { manager, eventManager } = makeManager(store);
    const events = subscribeEvents(eventManager, 'w1');

    const id = manager.createSessionDetached({ cwd, workspaceId: 'w1' }) as string;
    ptyState.instances[0].emitData('\x1b[?1049h');
    expect(manager.getSession(id)?.inAlternateScreen).toBe(true);

    ptyState.instances[0].emitData('\x1b[?1049l');
    expect(manager.getSession(id)?.inAlternateScreen).toBe(false);

    expect(events.filter((event) => event.type === 'status_changed')).toHaveLength(2);
  });

  test('exit ordering is exact: store markExited, then exited event, then EXIT frame', () => {
    const cwd = makeTempDir();
    const order: string[] = [];
    const store = new RecordingStore();
    store.order = order;
    const { manager, eventManager } = makeManager(store);
    subscribeEvents(eventManager, 'w1', order);
    const { socket, sent } = makeClientSocket(order);

    const id = manager.createSession(socket, { cwd, workspaceId: 'w1' });
    expect(id).toBeTypeOf('string');
    order.length = 0;

    ptyState.instances[0].emitExit(3);

    expect(order).toEqual(['store:markTerminalSessionExited', 'event:exited', 'frame:EXIT']);
    expect(store.exited).toEqual([{ id, exitCode: 3 }]);
    const exitFrame = sent.find((frame) => decodeFrame(frame).opcode === OPCODES.EXIT);
    expect(new TextDecoder().decode(exitFrame!.slice(1))).toBe('{"exitCode":3}');
    expect(manager.getSession(id)?.status).toBe('exited');
    expect(manager.getSession(id)?.exitCode).toBe(3);
  });

  test('reconnect validates the workspace id and replay keeps OUTPUT then REPLAY_COMPLETE order', () => {
    const cwd = makeTempDir();
    const store = new RecordingStore();
    const { manager } = makeManager(store);

    const id = manager.createSessionDetached({ cwd, workspaceId: 'w1' }) as string;
    ptyState.instances[0].emitData('chunk-one');
    ptyState.instances[0].emitData('chunk-two');

    const other = makeClientSocket();
    expect(manager.reconnectSession(other.socket, id, 'w2')).toBe('workspace_mismatch');
    expect(manager.reconnectSession(other.socket, 'missing-id', 'w1')).toBe('not_found');
    expect(manager.getActiveClientCount(id)).toBe(0);

    const { socket, sent } = makeClientSocket();
    expect(manager.reconnectSession(socket, id, 'w1')).toBe('connected');
    expect(manager.getActiveClientCount(id)).toBe(1);

    manager.replaySession(socket);
    expect(sent.map((frame) => OPCODE_NAMES[decodeFrame(frame).opcode])).toEqual([
      'OUTPUT',
      'OUTPUT',
      'REPLAY_COMPLETE',
    ]);
    expect(sent.map((frame) => new TextDecoder().decode(decodeFrame(frame).payload))).toEqual([
      'chunk-one',
      'chunk-two',
      '',
    ]);
  });

  test('replaying an exited session appends the EXIT frame after REPLAY_COMPLETE', () => {
    const cwd = makeTempDir();
    const store = new RecordingStore();
    const { manager } = makeManager(store);

    const id = manager.createSessionDetached({ cwd, workspaceId: 'w1' }) as string;
    ptyState.instances[0].emitData('tail');
    ptyState.instances[0].emitExit(7);

    const { socket, sent } = makeClientSocket();
    expect(manager.reconnectSession(socket, id, 'w1')).toBe('connected');
    manager.replaySession(socket);

    expect(sent.map((frame) => OPCODE_NAMES[decodeFrame(frame).opcode])).toEqual([
      'OUTPUT',
      'REPLAY_COMPLETE',
      'EXIT',
    ]);
    expect(new TextDecoder().decode(decodeFrame(sent[2]).payload)).toBe('{"exitCode":7}');
  });

  test('the buffer respects the env byte cap, keeping the newest chunks', () => {
    process.env.JEAN2_TERMINAL_BUFFER_BYTES = '4';
    const cwd = makeTempDir();
    const store = new RecordingStore();
    const { manager } = makeManager(store);

    const id = manager.createSessionDetached({ cwd, workspaceId: 'w1' }) as string;
    ptyState.instances[0].emitData('AAAA');
    ptyState.instances[0].emitData('BBBB');

    const { socket, sent } = makeClientSocket();
    expect(manager.reconnectSession(socket, id, 'w1')).toBe('connected');
    manager.replaySession(socket);

    const outputs = sent.filter((frame) => decodeFrame(frame).opcode === OPCODES.OUTPUT);
    expect(outputs.map((frame) => new TextDecoder().decode(decodeFrame(frame).payload))).toEqual(['BBBB']);
  });

  test('input and resize reach the PTY and resize updates the session size', () => {
    const cwd = makeTempDir();
    const store = new RecordingStore();
    const { manager } = makeManager(store);
    const { socket } = makeClientSocket();

    const id = manager.createSession(socket, { cwd, workspaceId: 'w1', cols: 80, rows: 24 });
    const pty = ptyState.instances[0];

    manager.handleInput(socket, 'ls -la\n');
    expect(pty.writeCalls).toEqual(['ls -la\n']);

    manager.handleResize(socket, 120, 40);
    expect(pty.resizeCalls).toEqual([{ cols: 120, rows: 40 }]);
    expect(manager.getSession(id)).toMatchObject({ cols: 120, rows: 40 });
  });

  test('setTitle broadcasts title_changed and sends a TITLE frame to clients', () => {
    const cwd = makeTempDir();
    const store = new RecordingStore();
    const { manager, eventManager } = makeManager(store);
    const events = subscribeEvents(eventManager, 'w1');
    const { socket, sent } = makeClientSocket();

    const id = manager.createSession(socket, { cwd, workspaceId: 'w1' });
    manager.setTitle(id, 'renamed');

    expect(events.filter((event) => event.type === 'title_changed')).toHaveLength(1);
    const titleFrame = sent.find((frame) => decodeFrame(frame).opcode === OPCODES.TITLE);
    expect(new TextDecoder().decode(decodeFrame(titleFrame!).payload)).toBe('{"title":"renamed"}');
    expect(manager.getSession(id)?.title).toBe('renamed');
  });

  test('destroy ordering is exact and a double destroy is idempotent', () => {
    const cwd = makeTempDir();
    const order: string[] = [];
    const store = new RecordingStore();
    store.order = order;
    const { manager, eventManager } = makeManager(store);
    subscribeEvents(eventManager, 'w1', order);
    const { socket, closed } = makeClientSocket();

    const id = manager.createSession(socket, { cwd, workspaceId: 'w1' });
    const pty = ptyState.instances[0];
    order.length = 0;

    manager.destroySessionById(id);
    const firstSnapshot = [...order];
    expect(firstSnapshot).toEqual(['event:destroyed', 'store:markTerminalSessionDestroyed']);
    expect(pty.killed).toBe(true);
    expect(closed).toEqual([true]);
    expect(manager.getSession(id)).toBeNull();
    expect(manager.getActiveClientCount(id)).toBe(0);

    manager.destroySessionById(id);
    expect(order).toEqual(firstSnapshot);
    expect(store.destroyed).toEqual([id]);
    expect(manager.listSessionsForWorkspace(cwd)).toEqual([]);
  });

  test('destroyAllSessions destroys every session exactly once', () => {
    const cwdA = makeTempDir();
    const cwdB = makeTempDir();
    const store = new RecordingStore();
    const { manager } = makeManager(store);

    const idA = manager.createSessionDetached({ cwd: cwdA, workspaceId: 'w1' }) as string;
    const idB = manager.createSessionDetached({ cwd: cwdB, workspaceId: 'w2' }) as string;

    manager.destroyAllSessions();

    expect(ptyState.instances.map((pty) => pty.killed)).toEqual([true, true]);
    expect(store.destroyed.sort()).toEqual([idA, idB].sort());
    expect(manager.listSessionsByWorkspaceId('w1')).toEqual([]);
    expect(manager.listSessionsByWorkspaceId('w2')).toEqual([]);
  });

  test('workspace listing stays by cwd path and destroySessionsForWorkspace targets cwd only', () => {
    const cwdA = makeTempDir();
    const cwdB = makeTempDir();
    const store = new RecordingStore();
    const { manager } = makeManager(store);

    const idA = manager.createSessionDetached({ cwd: cwdA, workspaceId: 'w1' }) as string;
    const idB = manager.createSessionDetached({ cwd: cwdB, workspaceId: 'w1' }) as string;

    expect(manager.listSessionsForWorkspace(cwdA).map((session) => session.id)).toEqual([idA]);
    expect(manager.listSessionsForWorkspace(cwdB).map((session) => session.id)).toEqual([idB]);
    expect(manager.listSessionsByWorkspaceId('w1').map((session) => session.id).sort())
      .toEqual([idA, idB].sort());

    manager.destroySessionsForWorkspace(cwdA);
    expect(store.destroyed).toEqual([idA]);
    expect(manager.getSession(idB)).not.toBeNull();
  });

  test('worktree listing prefers managed identity and retains exact-path legacy fallback', () => {
    const managedPath = makeTempDir();
    const otherPath = makeTempDir();
    const store = new RecordingStore();
    const { manager } = makeManager(store);

    const managedId = manager.createSessionDetached({
      cwd: otherPath,
      workspaceId: 'w1',
      managedWorktreeId: 'worktree-1',
    }) as string;
    const legacyId = manager.createSessionDetached({
      cwd: managedPath,
      workspaceId: 'w1',
    }) as string;
    manager.createSessionDetached({
      cwd: managedPath,
      workspaceId: 'w1',
      managedWorktreeId: 'worktree-2',
    });

    expect(manager.listSessionsForWorktree('worktree-1', managedPath).map((session) => session.id))
      .toEqual([managedId, legacyId]);
  });

  test('without an installed store port, spawn persistence fails and returns null', () => {
    const originalError = console.error;
    console.error = () => {};
    try {
      const cwd = makeTempDir();
      const { manager } = makeManager();
      expect(manager.createSessionDetached({ cwd, workspaceId: 'w1' })).toBeNull();
    } finally {
      console.error = originalError;
    }
  });
});

describe('terminal manager singleton wiring', () => {
  test('getTerminalManager is a lazy singleton and getTerminalEventManager keeps its identity', () => {
    const first = getTerminalManager();
    const second = getTerminalManager();
    expect(first).toBe(second);
    const events = getTerminalEventManager();
    expect(getTerminalEventManager()).toBe(events);
  });

  test('installTerminalSessionStore wires persistence before and after singleton creation', () => {
    const store = new RecordingStore();
    installTerminalSessionStore(store);
    const manager = getTerminalManager();
    installTerminalSessionStore(store);

    const cwd = makeTempDir();
    const id = manager.createSessionDetached({ cwd, workspaceId: 'w1' });
    expect(id).toBeTypeOf('string');
    expect(store.created).toHaveLength(1);
    manager.destroyAllSessions();
    expect(store.destroyed).toHaveLength(1);
  });
});
