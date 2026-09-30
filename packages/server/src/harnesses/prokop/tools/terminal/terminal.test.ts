import { afterEach, beforeEach, describe, expect, mock, test } from 'bun:test';
import { mkdirSync, mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { resolve } from 'path';
import type { PermissionAsk, ToolContext } from '@capekai/tool';
import { execute, definition } from './tool';
import { getTerminalManager, installTerminalSessionStore } from '@/transport/terminal';
import type { TerminalSessionStorePort } from '@/application/ports/terminal';

// ---------------------------------------------------------------------------
// Fake PTY over mock.module('bun-pty'), same pattern as
// terminal-manager.test.ts: the tool talks to the real TerminalManager
// singleton (seeded with a no-op store); only the spawn boundary is
// simulated so tests can drive PTY output deterministically.
// ---------------------------------------------------------------------------

interface SpawnOptions {
  name: string;
  cols: number;
  rows: number;
  cwd: string;
  env: Record<string, string>;
}

class FakePty {
  pid = 4242;
  killed = false;
  writeCalls: string[] = [];
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

  resize(): void {}

  kill(): void {
    this.killed = true;
    for (const handler of this.exitHandlers) handler({ exitCode: 0 });
  }

  emitData(data: string): void {
    for (const handler of this.dataHandlers) handler(data);
  }
}

const ptyState = { instances: [] as FakePty[] };

mock.module('bun-pty', () => ({
  spawn: (_shell: string, _args: string[], _options: SpawnOptions): FakePty => {
    const pty = new FakePty();
    ptyState.instances.push(pty);
    return pty;
  },
}));

function makeNoopStore(): TerminalSessionStorePort {
  return {
    createTerminalSession(): void {},
    updateTerminalSessionTitle(): void {},
    updateTerminalSessionActivity(): void {},
    markTerminalSessionExited(): void {},
    markTerminalSessionDestroyed(): void {},
    getTerminalSession(): null {
      return null;
    },
    listTerminalSessions(): [] {
      return [];
    },
    listActiveTerminalSessions(): [] {
      return [];
    },
    cleanupStaleTerminalSessions(): number {
      return 0;
    },
    cleanupRunningSessionsOnStartup(): number {
      return 0;
    },
    clearManagedWorktreeReferences(): void {},
  };
}

let tempDirs: string[] = [];

function makeWorkspaceCtx(): { ctx: ToolContext; cwd: string } {
  const cwd = mkdtempSync(`${tmpdir()}/term-tool-`);
  tempDirs.push(cwd);
  const ctx: ToolContext = {
    sessionId: 'test-session-123',
    workspacePath: cwd,
    workspaceId: 'ws-1',
    abortSignal: new AbortController().signal,
    allowedPaths: [],
    resolvePath: (p: string) => (p.startsWith('/') ? p : `${cwd}/${p}`),
    isWithinWorkspace: (p: string) => p.startsWith(cwd),
    isSensitivePath: (p: string) => p.includes('.env'),
    isBlockedPath: () => false,
    ask: async () => true,
    fs: {
      tempDir: `${cwd}/.tmp`,
      resolve: (p: string) => (p.startsWith('/') ? p : `${cwd}/${p}`),
      readFile: async () => new Uint8Array(),
      writeFile: async () => {},
      appendFile: async () => {},
      readDir: async () => [],
      exists: async () => false,
      stat: async () => ({ size: 0, isDirectory: false, isFile: true, modifiedAt: new Date(), createdAt: new Date() }),
      mkdir: async () => {},
      rm: async () => {},
    },
    logger: { info: () => {}, warn: () => {}, error: () => {} },
  } as unknown as ToolContext;
  return { ctx, cwd };
}

async function createSession(ctx: ToolContext): Promise<string> {
  const created = await execute({ action: 'create' }, ctx);
  expect(created.success).toBe(true);
  return (created.result as { sessionId: string }).sessionId;
}

beforeEach(() => {
  installTerminalSessionStore(makeNoopStore());
});

afterEach(() => {
  getTerminalManager().destroyAllSessions();
  for (const dir of tempDirs) {
    try { rmSync(dir, { recursive: true, force: true }); } catch { /* best effort */ }
  }
  tempDirs = [];
});

describe('terminal tool: definition', () => {
  test('has no deadline (null timeout) and five actions', () => {
    expect(definition.timeout).toBeNull();
    expect(definition.name).toBe('terminal');
    expect((definition.inputSchema.properties as Record<string, { enum?: string[] }>).action?.enum)
      .toEqual(['create', 'send', 'output', 'list', 'kill']);
  });
});

describe('terminal tool: actions', () => {
  test('create spawns an agent-origin session and list shows it', async () => {
    const { ctx } = makeWorkspaceCtx();
    const sessionId = await createSession(ctx);

    const listed = await execute({ action: 'list' }, ctx);
    const sessions = (listed.result as { sessions: Array<{ sessionId: string; origin: string; status: string }> }).sessions;
    const ours = sessions.find((s) => s.sessionId === sessionId);
    expect(ours).toBeDefined();
    expect(ours!.origin).toBe('agent');
    expect(ours!.status).toBe('running');
  });

  test('send waits for the sentinel marker and returns exit code and output', async () => {
    const { ctx } = makeWorkspaceCtx();
    const sessionId = await createSession(ctx);
    const pty = ptyState.instances[ptyState.instances.length - 1]!;

    const sendPromise = execute({ action: 'send', sessionId, command: 'echo hello' }, ctx);
    await Bun.sleep(80); // let the tool write to the PTY

    const written = pty.writeCalls.join('');
    expect(written).toContain('echo hello');
    // The wrap embeds the marker before `$?`; the real sentinel is marker+digits
    const markerMatch = written.match(/__T([a-f0-9]{8})_\$/);
    expect(markerMatch).not.toBeNull();
    // Simulate shell behavior: echo the line, print output, print sentinel
    pty.emitData(`${written}\r\nhello\r\n__T${markerMatch![1]}_0:${ctx.workspacePath}\r\n`);
    pty.emitData('$ ');

    const sent = await sendPromise;
    expect(sent.success).toBe(true);
    const res = sent.result as { status: string; exitCode: number; output: string };
    expect(res.status).toBe('completed');
    expect(res.exitCode).toBe(0);
    expect(res.output).toContain('hello');
  }, 10_000);

  test('send reports the real exit code on failure', async () => {
    const { ctx } = makeWorkspaceCtx();
    const sessionId = await createSession(ctx);
    const pty = ptyState.instances[ptyState.instances.length - 1]!;

    const sendPromise = execute({ action: 'send', sessionId, command: 'false' }, ctx);
    await Bun.sleep(80);

    const written = pty.writeCalls.join('');
    const markerMatch = written.match(/__T([a-f0-9]{8})_\$/);
    pty.emitData(`${written}\r\nboom\r\n__T${markerMatch![1]}_1:${ctx.workspacePath}\r\n`);

    const sent = await sendPromise;
    expect(sent.success).toBe(false);
    const res = sent.result as { status: string; exitCode: number; output: string };
    expect(res.status).toBe('completed');
    expect(res.exitCode).toBe(1);
    expect(res.output).toContain('boom');
    expect(sent.error).toContain('code 1');
  }, 10_000);

  test('send finds a sentinel after verbose output exceeds the response cap', async () => {
    const { ctx } = makeWorkspaceCtx();
    const sessionId = await createSession(ctx);
    const pty = ptyState.instances[ptyState.instances.length - 1]!;

    const sendPromise = execute({ action: 'send', sessionId, command: 'verbose-test', timeoutMs: 1000 }, ctx);
    await Bun.sleep(80);

    const written = pty.writeCalls.join('');
    const markerMatch = written.match(/__T([a-f0-9]{8})_\$/);
    expect(markerMatch).not.toBeNull();
    // The marker is after the old 128 KiB scan window. The result sent to
    // the model remains capped, but completion detection must not be.
    const verboseOutput = 'x'.repeat(131_072);
    pty.emitData(`${written}\r\n${verboseOutput}\r\n__T${markerMatch![1]}_0:${ctx.workspacePath}\r\n`);

    const sent = await sendPromise;
    expect(sent.success).toBe(true);
    const res = sent.result as { status: string; exitCode: number };
    expect(res.status).toBe('completed');
    expect(res.exitCode).toBe(0);
  }, 10_000);

  test('send timeout returns status running without failing the session', async () => {
    const { ctx } = makeWorkspaceCtx();
    const sessionId = await createSession(ctx);

    // Sentinel never arrives: send hits its (clamped-minimum) timeout
    const sent = await execute({ action: 'send', sessionId, command: 'sleep 100', timeoutMs: 1000 }, ctx);
    expect(sent.success).toBe(true);
    const res = sent.result as { status: string; hint?: string; nextOffset?: number };
    expect(res.status).toBe('running');
    expect(res.hint).toBeDefined();

    // Session is still alive and usable
    const listed = await execute({ action: 'list' }, ctx);
    const sessions = (listed.result as { sessions: Array<{ sessionId: string; commandPending: boolean }> }).sessions;
    expect(sessions.find((s) => s.sessionId === sessionId)!.commandPending).toBe(false);
  }, 15_000);

  test('send raw delivers input without sentinel wrapping', async () => {
    const { ctx } = makeWorkspaceCtx();
    const sessionId = await createSession(ctx);

    const sent = await execute({ action: 'send', sessionId, command: 'y\n', raw: true }, ctx);
    expect(sent.success).toBe(true);
    const pty = ptyState.instances[ptyState.instances.length - 1]!;
    expect(pty.writeCalls[pty.writeCalls.length - 1]).toBe('y\n');
  });

  test('permission paths use an additional-workspace terminal cwd', async () => {
    const { ctx, cwd } = makeWorkspaceCtx();
    const additionalCwd = mkdtempSync(`${tmpdir()}/term-tool-additional-`);
    tempDirs.push(additionalCwd);
    ctx.isWithinWorkspace = (path: string) =>
      path.startsWith(cwd) || path.startsWith(additionalCwd);
    ctx.ask = mock(async () => true) as unknown as ToolContext['ask'];

    const created = await execute({ action: 'create', cwd: additionalCwd }, ctx);
    const sessionId = (created.result as { sessionId: string }).sessionId;
    const sent = await execute({
      action: 'send',
      sessionId,
      command: 'rm -rf dist',
      raw: true,
    }, ctx);

    expect(sent.success).toBe(true);
    const calls = (ctx.ask as ReturnType<typeof mock>).mock.calls;
    expect(calls).toHaveLength(1);
    const expectedPath = resolve(additionalCwd, 'dist');
    const ask = calls[0][0] as PermissionAsk;
    expect(ask.paths).toEqual([expectedPath]);
    expect(ask.intents?.[0]?.targets[0]?.target).toBe(`${expectedPath}/`);
  });

  test('permission paths follow cwd changes from completed commands', async () => {
    const { ctx, cwd } = makeWorkspaceCtx();
    const subdirectory = resolve(cwd, 'subdirectory');
    mkdirSync(subdirectory);
    ctx.ask = mock(async () => true) as unknown as ToolContext['ask'];
    const sessionId = await createSession(ctx);
    const pty = ptyState.instances[ptyState.instances.length - 1]!;

    const changeDirectory = execute({
      action: 'send',
      sessionId,
      command: 'cd subdirectory',
    }, ctx);
    await Bun.sleep(80);
    const wrapped = pty.writeCalls[pty.writeCalls.length - 1]!;
    const markerMatch = wrapped.match(/__T([a-f0-9]{8})_\$/);
    expect(markerMatch).not.toBeNull();
    pty.emitData(`${wrapped}\r\n__T${markerMatch![1]}_0:${subdirectory}\r\n`);
    expect((await changeDirectory).success).toBe(true);

    const sent = await execute({
      action: 'send',
      sessionId,
      command: 'rm -rf dist',
      raw: true,
    }, ctx);

    expect(sent.success).toBe(true);
    const calls = (ctx.ask as ReturnType<typeof mock>).mock.calls;
    expect(calls).toHaveLength(1);
    const ask = calls[0][0] as PermissionAsk;
    expect(ask.paths).toEqual([resolve(subdirectory, 'dist')]);
  }, 10_000);

  test('null timeoutMs waits past any finite deadline until the sentinel arrives', async () => {
    const { ctx } = makeWorkspaceCtx();
    const sessionId = await createSession(ctx);
    const pty = ptyState.instances[ptyState.instances.length - 1]!;

    // Finite deadline that would normally elapse in 1.5s; the sentinel
    // arrives at ~3s. Under null the wait must still be alive then.
    const sendPromise = execute({ action: 'send', sessionId, command: 'slow-build', timeoutMs: null }, ctx);
    await Bun.sleep(80);
    const written = pty.writeCalls.join('');
    const markerMatch = written.match(/__T([a-f0-9]{8})_\$/);
    expect(markerMatch).not.toBeNull();

    // No sentinel yet past the point where a 1.5s finite timeout would
    // have returned "running" — the wait is still pending, not settled.
    await Bun.sleep(1600);
    const early = await Promise.race([
      sendPromise.then(() => 'settled'),
      Bun.sleep(10).then(() => 'still-waiting'),
    ]);
    expect(early).toBe('still-waiting');

    // Sentinel arrives at ~1.7s: null wait must complete with the code.
    pty.emitData(`${written}\r\nbuilt ok\r\n__T${markerMatch![1]}_0:${ctx.workspacePath}\r\n`);
    const sent = await sendPromise;
    expect(sent.success).toBe(true);
    const res = sent.result as { status: string; exitCode: number; output: string };
    expect(res.status).toBe('completed');
    expect(res.exitCode).toBe(0);
    expect(res.output).toContain('built ok');
  }, 10_000);

  test('null timeoutMs never coerces to a zero-delay timer (no premature running)', async () => {
    const { ctx } = makeWorkspaceCtx();
    const sessionId = await createSession(ctx);
    const pty = ptyState.instances[ptyState.instances.length - 1]!;

    // Under a broken null handling, setTimeout(fn, null) fires on the
    // next tick and would settle as "running" immediately. The wait must
    // survive past that and complete when the sentinel arrives.
    const sendPromise = execute({ action: 'send', sessionId, command: 'echo late', timeoutMs: null }, ctx);
    await Bun.sleep(80);
    const written = pty.writeCalls.join('');
    const markerMatch = written.match(/__T([a-f0-9]{8})_\$/);
    expect(markerMatch).not.toBeNull();

    await Bun.sleep(200);
    pty.emitData(`${written}\r\nlate\r\n__T${markerMatch![1]}_0:${ctx.workspacePath}\r\n`);
    const sent = await sendPromise;
    expect(sent.success).toBe(true);
    const res = sent.result as { status: string };
    expect(res.status).toBe('completed');
  }, 10_000);

  test('destroyed mid-wait reports status destroyed instead of running', async () => {
    const { ctx } = makeWorkspaceCtx();
    const sessionId = await createSession(ctx);

    // Short finite wait; while it is pending, the user kills the session
    // from the terminal panel.
    const sendPromise = execute({ action: 'send', sessionId, command: 'sleep 100', timeoutMs: 5000 }, ctx);
    await Bun.sleep(80);
    getTerminalManager().destroySessionById(sessionId);

    const sent = await sendPromise;
    expect(sent.success).toBe(false);
    const res = sent.result as { status: string };
    expect(res.status).toBe('destroyed');
    expect(sent.error).toContain('destroyed');
  }, 10_000);

  test('send rejects while another command is pending in the same session', async () => {
    const { ctx } = makeWorkspaceCtx();
    const sessionId = await createSession(ctx);

    const first = execute({ action: 'send', sessionId, command: 'sleep 5', timeoutMs: 1100 }, ctx);
    await Bun.sleep(50);
    const second = await execute({ action: 'send', sessionId, command: 'echo hi' }, ctx);
    expect(second.success).toBe(false);
    expect(second.error).toContain('already pending');
    await first; // settle, which clears pendingSends
  }, 10_000);

  test('output reads session output with ANSI stripped and nextOffset', async () => {
    const { ctx } = makeWorkspaceCtx();
    const sessionId = await createSession(ctx);
    const pty = ptyState.instances[ptyState.instances.length - 1]!;

    pty.emitData('\x1b[32mplain text\x1b[0m\r\n');

    const out = await execute({ action: 'output', sessionId, fromOffset: 0 }, ctx);
    expect(out.success).toBe(true);
    const res = out.result as { output: string; nextOffset: number; totalBytes: number; pendingCommand: boolean };
    expect(res.output).toContain('plain text');
    expect(res.output).not.toContain('\x1b[32m');
    expect(res.nextOffset).toBeGreaterThan(0);
    expect(res.totalBytes).toBeGreaterThanOrEqual(res.nextOffset);
    expect(res.pendingCommand).toBe(false);
  });

  test('kill destroys an agent session without asking, then output 404s', async () => {
    const { ctx } = makeWorkspaceCtx();
    const sessionId = await createSession(ctx);

    const killed = await execute({ action: 'kill', sessionId }, ctx);
    expect(killed.success).toBe(true);
    expect((killed.result as { status: string }).status).toBe('destroyed');

    const gone = await execute({ action: 'output', sessionId }, ctx);
    expect(gone.success).toBe(false);
    expect(gone.error).toContain('not found');
  });

  test('unknown action fails closed', async () => {
    const { ctx } = makeWorkspaceCtx();
    const result = await execute({ action: 'teleport' as unknown as 'create' }, ctx);
    expect(result.success).toBe(false);
    expect(result.error).toContain('Unknown action');
  });

  test('missing sessionId fails for send/output/kill', async () => {
    const { ctx } = makeWorkspaceCtx();
    for (const action of ['send', 'output', 'kill'] as const) {
      const result = await execute({ action, command: 'echo hi' }, ctx);
      expect(result.success).toBe(false);
      expect(result.error).toContain('sessionId is required');
    }
  });
});
