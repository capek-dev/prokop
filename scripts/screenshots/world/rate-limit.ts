/**
 * A session left mid-turn in its own worktree: the agent planned, read the
 * handler, wrote the limiter, and is waiting on its next model call, so the
 * UI shows it as running.
 */
import type { WorldSetup } from './types';

const LIMITER = `interface Window {
  start: number;
  count: number;
}

/** Fixed-window limiter keyed by client, e.g. IP address. */
export class RateLimiter {
  private windows = new Map<string, Window>();

  constructor(private readonly limit: number, private readonly windowMs: number) {}

  /** Seconds until the window resets when \`key\` is over the limit, otherwise null. */
  check(key: string, now = Date.now()): number | null {
    const current = this.windows.get(key);
    if (!current || now - current.start >= this.windowMs) {
      this.windows.set(key, { start: now, count: 1 });
      return null;
    }
    current.count += 1;
    if (current.count <= this.limit) return null;
    return Math.ceil((current.start + this.windowMs - now) / 1000);
  }
}
`;

export async function rateLimit({ demo, workspaceId }: WorldSetup, worktreeId: string): Promise<string> {
  const title = 'Rate limit link creation per IP';
  const { session } = await demo.rest.sessions.create({ workspaceId, title });
  await demo.rest.sessions.bindWorktree(session.id, worktreeId);
  await demo.scriptTitle(session.id, title);

  await demo.runTurn(
    session.id,
    'Add rate limiting to POST /api/links: 20 links per minute per IP, with a 429 and Retry-After when exceeded.',
    [
      {
        type: 'tool-call',
        reasoning: 'No dependencies in this project, so a small fixed-window limiter keyed by IP is enough. Plan first, then read the create handler.',
        toolName: 'todo',
        args: {
          todos: [
            { content: 'Add a fixed-window limiter in src/rate-limit.ts', status: 'in_progress' },
            { content: 'Apply it to POST /api/links with 429 + Retry-After', status: 'pending' },
            { content: 'Test the limit and the window reset', status: 'pending' },
          ],
        },
        usage: { inputTokens: 13_800, outputTokens: 230 },
      },
      {
        type: 'tool-call',
        text: 'Reading the create handler to see where the client IP is available.',
        toolName: 'read-file',
        args: { path: 'src/routes/links.ts' },
        usage: { inputTokens: 14_420, outputTokens: 61 },
      },
      {
        type: 'tool-call',
        text: 'The handler only gets the `Request`, so the IP has to come from the server. Writing the limiter first; `check` returns the Retry-After seconds directly.',
        toolName: 'write-file',
        args: { path: 'src/rate-limit.ts', content: LIMITER },
        usage: { inputTokens: 15_310, outputTokens: 402 },
      },
    ],
    { until: 'running' },
  );

  return session.id;
}
