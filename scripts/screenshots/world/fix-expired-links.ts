/**
 * A finished bug-fix turn. The agent greps, reads, edits two files, and runs
 * the real test suite. Its edits stay uncommitted for the Changes panel.
 */
import { REPO_DISPLAY_PATH, repoPath, type WorldSetup } from './types';

const PROMPT = 'Expired links still redirect. Someone reported a 30-day campaign link that still works two months later. Can you fix it and add a test?';

/** Visible once the final reply rendered. */
export const FIX_EXPIRED_LINKS_READY = 'Want it to include';

export async function fixExpiredLinks({ demo, workspaceId }: WorldSetup): Promise<string> {
  const file = repoPath;
  const title = 'Fix expired links still redirecting';
  const { session } = await demo.rest.sessions.create({ workspaceId, title });
  await demo.scriptTitle(session.id, title);

  await demo.runTurn(session.id, PROMPT, [
    {
      type: 'tool-call',
      reasoning: 'The store sets expiresAt when a link is created, so the bug is likely that nothing on the redirect path reads it. Confirm where expiresAt is used before touching anything.',
      text: 'Checking where `expiresAt` is read.',
      toolName: 'grep',
      args: { pattern: 'expiresAt', path: file('src') },
      usage: { inputTokens: 14_210, outputTokens: 96 },
    },
    {
      type: 'multi-tool-call',
      text: '`expiresAt` is written by the store and only read by the stats route. Reading the redirect handler.',
      calls: [
        { toolName: 'read-file', args: { path: file('src/routes/redirect.ts') } },
        { toolName: 'read-file', args: { path: file('src/store.ts') } },
      ],
      usage: { inputTokens: 15_020, outputTokens: 88 },
    },
    {
      type: 'tool-call',
      reasoning: '410 Gone fits better than 404: the slug existed and is intentionally unavailable now. An expired hit should not count as a click either. Take `now` as a parameter so the check is testable without mocking Date.',
      text: 'The redirect handler never checks expiry. Returning 410 Gone for expired links and skipping the click count.',
      toolName: 'edit',
      args: {
        path: file('src/routes/redirect.ts'),
        revision: null,
        edits: [
          {
            oldString: 'export function redirect(slug: string, store: LinkStore): Response {',
            newString: 'export function redirect(slug: string, store: LinkStore, now = Date.now()): Response {',
          },
          {
            oldString: "    return new Response('Link not found', { status: 404 });\n  }\n",
            newString: "    return new Response('Link not found', { status: 404 });\n  }\n\n  if (link.expiresAt !== null && link.expiresAt <= now) {\n    return new Response('Link expired', { status: 410 });\n  }\n",
          },
        ],
      },
      usage: { inputTokens: 16_480, outputTokens: 412 },
    },
    {
      type: 'tool-call',
      text: 'Adding tests for an expired link and for one that is still valid.',
      toolName: 'edit',
      args: {
        path: file('test/redirect.test.ts'),
        revision: null,
        edits: [
          {
            oldString: "  test('returns 404 for unknown slugs', async () => {",
            newString: [
              "  test('returns 410 for expired links without counting the click', async () => {",
              '    const server = createServer();',
              '    const thirtyOneDaysAgo = Date.now() - 31 * 24 * 60 * 60 * 1000;',
              "    server.store.create('spring', 'https://example.com/campaign', 30, thirtyOneDaysAgo);",
              '',
              "    const response = await server.fetch(new Request('http://localhost/spring'));",
              '    expect(response.status).toBe(410);',
              "    expect(server.store.get('spring')?.clicks).toBe(0);",
              '  });',
              '',
              "  test('still redirects links that have not expired', async () => {",
              '    const server = createServer();',
              "    server.store.create('summer', 'https://example.com/summer', 30);",
              '',
              "    const response = await server.fetch(new Request('http://localhost/summer'));",
              '    expect(response.status).toBe(302);',
              '  });',
              '',
              "  test('returns 404 for unknown slugs', async () => {",
            ].join('\n'),
          },
        ],
      },
      usage: { inputTokens: 17_390, outputTokens: 538 },
    },
    {
      type: 'tool-call',
      text: 'Running the suite.',
      toolName: 'shell',
      // Bun reports results on stderr, which the transcript styles as an error.
      args: { command: 'bun test 2>&1', cwd: REPO_DISPLAY_PATH },
      usage: { inputTokens: 18_120, outputTokens: 41 },
    },
    {
      type: 'text',
      content: [
        'Fixed. Expired links now return **410 Gone** instead of redirecting.',
        '',
        '- `src/routes/redirect.ts` checks `expiresAt` before redirecting and does not count clicks on expired links. It takes an optional `now`, so the check is testable without mocking `Date`.',
        '- `test/redirect.test.ts` covers an expired 30-day link (410, no click recorded) and a link that is still valid (302).',
        '',
        '`bun test`: 8 pass, 0 fail.',
        '',
        'The stats endpoint still reports expired links like any other. Want it to include an `expired` flag?',
      ].join('\n'),
      usage: { inputTokens: 18_860, outputTokens: 164 },
    },
  ]);

  return session.id;
}
