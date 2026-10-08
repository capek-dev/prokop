import { claudeTextTurnArgs } from './command';
import { readClaudeStream, type ClaudeStreamEvent } from './stream';

export interface ClaudeProcess {
  stdin: { write(bytes: Uint8Array): number | Promise<number>; end(): number | Promise<number> | void };
  stdout: ReadableStream<Uint8Array>;
  exited: Promise<number>;
  kill(signal?: number): void;
}

export type ClaudeSpawn = (args: string[], cwd: string) => ClaudeProcess;

/** Only the installed `claude` command is used. The prompt travels over stdin, not argv. */
export const spawnClaude: ClaudeSpawn = (args, cwd) => {
  // The selected harness uses the user's CLI login, never an inherited API key or cloud backend.
  const { ANTHROPIC_API_KEY: _apiKey, ANTHROPIC_AUTH_TOKEN: _authToken,
    CLAUDE_CODE_USE_BEDROCK: _bedrock, CLAUDE_CODE_USE_VERTEX: _vertex,
    CLAUDE_CODE_USE_FOUNDRY: _foundry, ...env } = process.env;
  const child = Bun.spawn(args, { cwd, env, stdin: 'pipe', stdout: 'pipe', stderr: 'ignore', windowsHide: true });
  if (!child.stdin || !child.stdout || typeof child.stdin === 'number'
    || typeof child.stdout === 'number') {
    child.kill();
    throw new Error('Claude CLI stdio is unavailable');
  }
  return { stdin: child.stdin, stdout: child.stdout, exited: child.exited,
    kill: signal => child.kill(signal) };
};

/** An unconfirmed result is never returned as success or automatically replayed. */
export async function* runClaudeTextTurn(input: {
  cwd: string;
  prompt: string;
  resumeSessionId?: string;
  sessionId?: string;
  model?: string;
  effort?: string;
  signal?: AbortSignal;
  spawn?: ClaudeSpawn;
}): AsyncGenerator<ClaudeStreamEvent> {
  if (!input.prompt.trim()) throw new Error('Claude CLI requires a nonempty prompt');
  if (input.signal?.aborted) throw new Error('Claude CLI turn interrupted');
  const process = (input.spawn ?? spawnClaude)(claudeTextTurnArgs(input.resumeSessionId, input.model, input.effort, input.sessionId), input.cwd);
  let interrupted = false;
  const stop = (): void => { interrupted = true; process.kill(2); };
  input.signal?.addEventListener('abort', stop, { once: true });
  try {
    await process.stdin.write(new TextEncoder().encode(input.prompt));
    await process.stdin.end();
    for await (const event of readClaudeStream(process.stdout, input.resumeSessionId ?? input.sessionId)) {
      if (interrupted) throw new Error('Claude CLI turn interrupted');
      yield event;
    }
    if (interrupted) throw new Error('Claude CLI turn interrupted');
    if (await process.exited !== 0) throw new Error('Claude CLI exited unsuccessfully');
  } finally {
    input.signal?.removeEventListener('abort', stop);
    // A failed parse or consumer cancellation must not leave a tool-capable process alive.
    try { process.kill(); } catch { /* Process already exited. */ }
  }
}
