/**
 * Terminal tool: LLM-facing management of persistent PTY sessions.
 *
 * Sessions live in the shared TerminalManager, so everything the tool
 * creates is visible (and killable) in the user's terminal panel, and
 * dies with the workspace. Completion detection uses a random sentinel:
 * the tool wraps the command with an echo that prints `<marker><exit>`
 * after the command finishes, and watches the session buffer for the
 * marker followed by digits. The echoed wrapper is removed from the
 * captured output before marker matching, so its marker literals cannot
 * report completion early.
 */

import type { ToolDefinition, ToolContext, ToolResult } from '@capekai/tool';
import {
  createOutsideWorkspaceAsk,
  createShellPermissionAskStructured,
  createWorkspaceModificationAsk,
} from '@prokopai/sdk';
import { analyzeRisk, resolveCommandPath, stripRedundantCd } from '../shell/risk';
import { getTerminalManager } from '@/transport/terminal';

interface TerminalInput {
  action?: 'create' | 'send' | 'output' | 'list' | 'kill';
  sessionId?: string;
  command?: string;
  cwd?: string;
  timeoutMs?: number | null;
  fromOffset?: number;
  raw?: boolean;
}

interface PendingSend {
  marker: string;
  startedAt: number;
}

/** One tracked command per session: a second send while one is pending
 * is rejected so outputs never interleave. */
const pendingSends = new Map<string, PendingSend>();

const DEFAULT_SEND_TIMEOUT_MS = 60_000;
const MAX_SEND_TIMEOUT_MS = 10 * 60_000;
const MAX_OUTPUT_BYTES = 32_768;

function detectPlatform(): 'windows' | 'unix' {
  if (typeof process !== 'undefined' && process.platform) {
    return process.platform === 'win32' ? 'windows' : 'unix';
  }
  return 'unix';
}

/** Wraps a command so its completion announces itself in the output
 * stream with a random marker followed by the exit code. Unguessable,
 * so program output cannot spoof completion. */
function wrapWithMarker(command: string, marker: string, platform: 'windows' | 'unix'): string {
  if (platform === 'windows') {
    // cmd.exe expands %ERRORLEVEL% at parse time, so the code is carried
    // by the && / || branch instead: 0 on success, 1 otherwise.
    return `${command} && echo ${marker}0: || echo ${marker}1:`;
  }
  return `${command}; __prokop_status=$?; __prokop_cwd=$(command pwd -P); echo "${marker}$__prokop_status:$__prokop_cwd"`;
}

/** Strips ANSI escape sequences and control characters so raw PTY bytes
 * become readable text for the model. Keeps \n and \r. */
function stripAnsi(text: string): string {
  // eslint-disable-next-line no-control-regex
  return text.replace(/\x1b\[[0-9;?]*[A-Za-z]/g, '').replace(/[\x00-\x09\x0b\x0c\x0e-\x1f\x7f]/g, '');
}

/** The captured region starts with the PTY echoing the wrapped command
 * (the prompt was printed before our capture offset). Removes the echo
 * so the model sees only what the command produced. */
function removeEchoedCommand(text: string, wrapped: string): string {
  const idx = text.indexOf(wrapped);
  if (idx >= 0) {
    return text.slice(0, idx) + text.slice(idx + wrapped.length);
  }
  // Echo may be split by line wraps; fall back to dropping the first line.
  const firstNewline = text.indexOf('\n');
  return firstNewline >= 0 ? text.slice(firstNewline + 1) : text;
}

function truncateOutput(text: string, maxBytes: number): string {
  const bytes = Buffer.byteLength(text, 'utf8');
  if (bytes <= maxBytes) return text;
  // Keep the tail: errors and results usually appear at the end.
  const keepChars = Math.floor((maxBytes / bytes) * text.length);
  return `... [truncated, oldest output cut]\n${text.slice(text.length - keepChars)}`;
}

async function requestPermission(
  command: string,
  executionCwd: string,
  ctx: ToolContext,
): Promise<boolean> {
  const resolveFromCwd = (path: string): string => resolveCommandPath(path, executionCwd, ctx);
  const effectiveCommand = stripRedundantCd(command, executionCwd, resolveFromCwd);
  const risk = analyzeRisk(effectiveCommand, ctx, executionCwd);
  if (!risk.requiresAsk) return true;

  let permAsk;
  if (risk.riskCategory === 'outside-workspace') {
    permAsk = createOutsideWorkspaceAsk({
      command: effectiveCommand,
      cwd: executionCwd,
      resolvedPaths: risk.resolvedPaths,
      hasOperators: risk.hasOperators,
    });
  } else if (risk.riskCategory === 'workspace-modification') {
    permAsk = createWorkspaceModificationAsk({
      command: effectiveCommand,
      baseCommand: risk.baseCommand,
      resolvedPaths: risk.resolvedPaths,
      hasOperators: risk.hasOperators,
    });
  } else {
    permAsk = createShellPermissionAskStructured({
      command: effectiveCommand,
      baseCommand: risk.baseCommand,
      flags: risk.flags,
      risk: risk.risk,
      riskCategory: risk.riskCategory,
      reason: risk.reason,
      resolvedPaths: risk.resolvedPaths,
      workspaceBound: risk.workspaceBound,
      hasOperators: risk.hasOperators,
    });
  }

  return (await ctx.ask(permAsk)) === true;
}

type MarkerOutcome =
  | { completed: true; exitCode: number; output: string; cwd?: string }
  | { completed: false; output: string; destroyed: boolean };

async function waitForMarker(
  sessionId: string,
  marker: string,
  wrapped: string,
  timeoutMs: number | null,
  fromOffset: number,
  abortSignal: AbortSignal,
): Promise<MarkerOutcome> {
  const manager = getTerminalManager();
  // null deadline: wait until the sentinel appears or the session dies.
  // Only interrupt can stop the wait early.
  const deadline = timeoutMs === null ? Infinity : Date.now() + timeoutMs;
  // Marker followed by digits = real sentinel. The echoed wrapper is
  // removed before matching so its marker literals cannot match.
  const pattern = new RegExp(`${marker}(\\d+):([^\\r\\n]*)`);

  const hasCompletionMarker = (text: string): boolean =>
    pattern.test(removeEchoedCommand(stripAnsi(text), wrapped));

  let read = manager.readBuffer(sessionId, fromOffset, MAX_OUTPUT_BYTES * 4);
  while (read && !hasCompletionMarker(read.text) && Date.now() < deadline && !abortSignal.aborted) {
    await Bun.sleep(50);
    read = manager.readBuffer(sessionId, fromOffset, MAX_OUTPUT_BYTES * 4);
  }

  // readBuffer null = the session was destroyed mid-wait (e.g. killed
  // from the terminal panel). The sentinel can never arrive after that.
  if (!read) return { completed: false, output: '', destroyed: true };
  const text = removeEchoedCommand(stripAnsi(read.text), wrapped);
  const match = text.match(pattern);
  if (match && match.index !== undefined) {
    const exitCode = Number(match[1]);
    const cwd = match[2]?.trim() || undefined;
    const output = text.slice(0, match.index).replace(/^[\r\n]+/, '').trimEnd();
    return { completed: true, exitCode, output, cwd };
  }
  return { completed: false, output: text.trimEnd(), destroyed: false };
}

export const definition: ToolDefinition = {
  name: 'terminal',
  description: `Manage persistent PTY terminal sessions in the workspace.

A terminal session is a REAL shell that stays alive between commands: same working directory, same environment variables, warm build daemons (Gradle, Vite, Jest). Use it for repeated builds/tests of the same project and for long-running processes (dev servers, watchers).

The user sees every session you create in their terminal panel and can watch or kill it at any time.

Actions:
- "create": Start a new session. Returns sessionId. Optional cwd (defaults to workspace root).
- "send": Run a command in a session and wait for it to finish. Returns output and exit code. State (cwd, env, daemons) persists across sends.
- "output": Read what a session has printed since a byte offset. For checking on a long-running process.
- "list": List all sessions in the workspace with status.
- "kill": Terminate a session (yours are free to kill; user sessions need permission).

When to use which:
- One-off command → shell tool (simpler)
- Repeated compile/test cycles, or processes that must keep running → terminal
- A dev server you need to check on later → create + send (send returns status "running" after its timeout), then output to check progress
- Answering an interactive prompt (sending "y", Ctrl-C as \\x03) → send with raw: true

Rules:
- One command at a time per session: wait for send to return before sending again
- kill sessions you no longer need
- send waits up to timeoutMs (default 60s, max 10min) for completion; on timeout the command KEEPS RUNNING and partial output is returned with status "running"
- Starting a server or watcher (npm run dev, vite, watch mode)? Pass a SMALL timeoutMs (3000-5000): send returns quickly with boot output and status "running" while the process keeps going. Then check progress with the output action.
- For slow work you KNOW terminates (full builds, long test suites), pass timeoutMs: null to wait until it actually finishes and get the real exit code. Never use null for servers or watchers.`,
  display: { summary: '{action}: {command}' },
  inputSchema: {
    type: 'object',
    properties: {
      action: {
        type: 'string',
        enum: ['create', 'send', 'output', 'list', 'kill'],
        description: 'The action to perform.',
      },
      sessionId: {
        type: 'string',
        description: 'Session id (required for send/output/kill).',
      },
      command: {
        type: 'string',
        description: 'Command to run (send action).',
      },
      cwd: {
        type: 'string',
        description: 'Working directory for the new session (create action). Defaults to workspace root.',
      },
      timeoutMs: {
        type: ['number', 'null'],
        description: 'How long send waits for completion, in milliseconds. Default 60000, max 600000. On timeout the command keeps running; partial output is returned with status "running". Pass null to wait until the command finishes (only for work you know terminates: builds, test suites — never servers). Pass a small value like 3000-5000 when starting a dev server or watcher.',
      },
      fromOffset: {
        type: 'number',
        description: 'Byte offset to read output from (output action). Start at 0, then use nextOffset from the previous read.',
      },
      raw: {
        type: 'boolean',
        description: 'Write input exactly as given, without completion tracking (send action). For interactive prompts: "y\\n", "\\x03" for Ctrl-C.',
      },
    },
    required: ['action'],
  },
  timeout: null,
};

export async function execute(input: TerminalInput, ctx: ToolContext): Promise<ToolResult> {
  try {
    switch (input.action) {
      case 'create':
        return await handleCreate(input, ctx);
      case 'send':
        return await handleSend(input, ctx);
      case 'output':
        return handleOutput(input);
      case 'list':
        return handleList(ctx);
      case 'kill':
        return await handleKill(input, ctx);
      default:
        return { success: false, error: `Unknown action: ${String(input.action)}` };
    }
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return { success: false, error: message };
  }
}

async function handleCreate(input: TerminalInput, ctx: ToolContext): Promise<ToolResult> {
  const resolvedCwd = input.cwd ? ctx.resolvePath(input.cwd) : ctx.workspacePath;

  if (input.cwd && !ctx.isWithinWorkspace(resolvedCwd)) {
    const approved = await ctx.ask(createOutsideWorkspaceAsk({
      command: `terminal create ${input.cwd}`,
      cwd: resolvedCwd,
      resolvedPaths: [resolvedCwd],
      hasOperators: false,
    }));
    if (approved !== true) return { success: false, error: 'USER_REJECTION' };
  }

  const manager = getTerminalManager();
  const sessionId = manager.createSessionDetached({
    cwd: resolvedCwd,
    workspaceId: ctx.workspaceId ?? resolvedCwd,
    origin: 'agent',
  });

  if (!sessionId) {
    return { success: false, error: 'Failed to create terminal session (invalid cwd or session limit reached)' };
  }

  return {
    success: true,
    result: {
      sessionId,
      cwd: resolvedCwd,
      hint: 'Session is visible in the user terminal panel. Use send to run commands.',
    },
  };
}

async function handleSend(input: TerminalInput, ctx: ToolContext): Promise<ToolResult> {
  const sessionId = input.sessionId;
  if (!sessionId) return { success: false, error: 'sessionId is required for send' };
  const command = input.command;
  if (!command || !command.trim()) return { success: false, error: 'command is required for send' };

  const manager = getTerminalManager();
  const session = manager.getSession(sessionId);
  if (!session) return { success: false, error: `Session not found: ${sessionId}` };
  if (session.status !== 'running') {
    return { success: false, error: `Session has exited (code ${session.exitCode ?? 'unknown'}). Create a new one.` };
  }
  if (pendingSends.has(sessionId)) {
    return { success: false, error: 'A command is already pending in this session. Wait for it to complete (or read its output) before sending another.' };
  }

  const executionCwd = manager.getSessionExecutionCwd(sessionId) ?? session.cwd;
  const approved = await requestPermission(command, executionCwd, ctx);
  if (!approved) return { success: false, error: 'USER_REJECTION' };

  if (input.raw === true) {
    const written = manager.writeToSession(sessionId, command);
    if (!written) return { success: false, error: 'Failed to write to session (it may have just exited)' };
    return {
      success: true,
      result: { status: 'sent', note: 'Raw input delivered without completion tracking.' },
    };
  }

  const platform = detectPlatform();
  const marker = `__T${crypto.randomUUID().replace(/-/g, '').slice(0, 8)}_`;
  const wrapped = wrapWithMarker(command, marker, platform);
  // null is an explicit "no deadline" and bypasses the clamp entirely.
  const timeoutMs = input.timeoutMs === null
    ? null
    : Math.min(Math.max(input.timeoutMs ?? DEFAULT_SEND_TIMEOUT_MS, 1000), MAX_SEND_TIMEOUT_MS);

  // Record the buffer size BEFORE writing: the capture window starts at
  // the echoed command and excludes all earlier output. The prompt for
  // this line was printed before this offset, so it stays excluded too.
  const before = manager.readBuffer(sessionId, 0, 0);
  const fromOffset = before ? before.totalBytes : 0;

  const written = manager.writeToSession(sessionId, `${wrapped}\n`);
  if (!written) {
    return { success: false, error: 'Failed to write to session (it may have just exited)' };
  }

  pendingSends.set(sessionId, { marker, startedAt: Date.now() });
  try {
    const outcome = await waitForMarker(sessionId, marker, wrapped, timeoutMs, fromOffset, ctx.abortSignal);
    if (outcome.completed) {
      if (outcome.cwd) {
        manager.updateSessionCwd(sessionId, outcome.cwd);
      }
      const success = outcome.exitCode === 0;
      return {
        success,
        result: {
          status: 'completed',
          exitCode: outcome.exitCode,
          output: truncateOutput(outcome.output, MAX_OUTPUT_BYTES),
        },
        ...(!success && { error: `Command exited with code ${outcome.exitCode}` }),
      };
    }
    const aborted = ctx.abortSignal.aborted;
    if (outcome.destroyed) {
      return {
        success: false,
        result: {
          status: 'destroyed',
          output: truncateOutput(outcome.output, MAX_OUTPUT_BYTES),
        },
        error: 'Session was destroyed while the command was running (likely killed from the terminal panel).',
      };
    }
    return {
      success: !aborted,
      result: {
        status: aborted ? 'interrupted' : 'running',
        output: truncateOutput(outcome.output, MAX_OUTPUT_BYTES),
        ...(aborted
          ? {}
          : { hint: 'Command still running. Read output later with the output action (fromOffset below), or kill the session to stop it.', nextOffset: fromOffset }),
      },
      ...(aborted && { error: 'Tool execution interrupted' }),
    };
  } finally {
    pendingSends.delete(sessionId);
  }
}

function handleOutput(input: TerminalInput): ToolResult {
  const sessionId = input.sessionId;
  if (!sessionId) return { success: false, error: 'sessionId is required for output' };

  const manager = getTerminalManager();
  const session = manager.getSession(sessionId);
  if (!session) return { success: false, error: `Session not found: ${sessionId}` };

  const fromOffset = typeof input.fromOffset === 'number' && input.fromOffset >= 0 ? input.fromOffset : 0;
  const read = manager.readBuffer(sessionId, fromOffset, MAX_OUTPUT_BYTES);
  if (!read) return { success: false, error: `Session not found: ${sessionId}` };

  return {
    success: true,
    result: {
      sessionId,
      status: session.status,
      exitCode: session.exitCode,
      output: truncateOutput(stripAnsi(read.text), MAX_OUTPUT_BYTES),
      nextOffset: read.nextOffset,
      totalBytes: read.totalBytes,
      ...(session.status === 'running' && { pendingCommand: pendingSends.has(sessionId) }),
    },
  };
}

function handleList(ctx: ToolContext): ToolResult {
  const manager = getTerminalManager();
  const sessions = manager.listSessionsForWorkspace(ctx.workspacePath);

  return {
    success: true,
    result: {
      sessions: sessions.map((s) => ({
        sessionId: s.id,
        title: s.title,
        cwd: s.cwd,
        status: s.status,
        exitCode: s.exitCode,
        origin: s.origin ?? 'user',
        lastActivityAt: s.lastActivityAt,
        commandPending: pendingSends.has(s.id),
      })),
    },
  };
}

async function handleKill(input: TerminalInput, ctx: ToolContext): Promise<ToolResult> {
  const sessionId = input.sessionId;
  if (!sessionId) return { success: false, error: 'sessionId is required for kill' };

  const manager = getTerminalManager();
  const session = manager.getSession(sessionId);
  if (!session) return { success: false, error: `Session not found: ${sessionId}` };

  // Agent sessions are ours to clean up. Killing a session the user
  // opened requires their approval.
  if ((session.origin ?? 'user') === 'user') {
    const approved = await ctx.ask(createShellPermissionAskStructured({
      command: `kill terminal session ${session.title} (${sessionId.slice(0, 8)})`,
      baseCommand: 'terminal kill',
      flags: [],
      risk: 'medium',
      riskCategory: 'side-effect',
      reason: 'terminating a terminal session opened by the user',
      resolvedPaths: [],
      workspaceBound: true,
      hasOperators: false,
    }));
    if (approved !== true) return { success: false, error: 'USER_REJECTION' };
  }

  manager.destroySessionById(sessionId);
  return { success: true, result: { sessionId, status: 'destroyed' } };
}
