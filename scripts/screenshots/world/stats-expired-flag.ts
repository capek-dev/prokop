/**
 * A finished follow-up in its own worktree: the stats endpoint reports
 * whether a link expired. Edits stay uncommitted on the worktree branch.
 */
import type { WorldSetup } from './types';

export async function statsExpiredFlag({ demo, workspaceId }: WorldSetup, worktreeId: string): Promise<string> {
  const title = 'Add expired flag to link stats';
  const { session } = await demo.rest.sessions.create({ workspaceId, title });
  await demo.rest.sessions.bindWorktree(session.id, worktreeId);
  await demo.scriptTitle(session.id, title);

  await demo.runTurn(session.id, 'Have the stats endpoint include `expired` so the dashboard can grey out dead links.', [
    {
      type: 'tool-call',
      toolName: 'read-file',
      args: { path: 'src/routes/links.ts' },
      usage: { inputTokens: 13_120, outputTokens: 48 },
    },
    {
      type: 'tool-call',
      text: 'Computing `expired` in `linkStats`, with the same optional `now` pattern so it stays testable.',
      toolName: 'edit',
      args: {
        path: 'src/routes/links.ts',
        revision: null,
        edits: [
          {
            oldString: 'export function linkStats(slug: string, store: LinkStore): Response {',
            newString: 'export function linkStats(slug: string, store: LinkStore, now = Date.now()): Response {',
          },
          {
            oldString: '  return Response.json({ slug: link.slug, clicks: link.clicks, expiresAt: link.expiresAt });',
            newString: '  const expired = link.expiresAt !== null && link.expiresAt <= now;\n  return Response.json({ slug: link.slug, clicks: link.clicks, expiresAt: link.expiresAt, expired });',
          },
        ],
      },
      usage: { inputTokens: 13_960, outputTokens: 296 },
    },
    {
      type: 'tool-call',
      text: 'Adding a test for an expired link.',
      toolName: 'edit',
      args: {
        path: 'test/links.test.ts',
        revision: null,
        edits: [
          {
            oldString: '    expect(link.expiresAt).toBeGreaterThan(Date.now());\n  });\n',
            newString: [
              '    expect(link.expiresAt).toBeGreaterThan(Date.now());',
              '  });',
              '',
              "  test('stats report expired links', async () => {",
              '    const server = createServer();',
              "    server.store.create('old', 'https://example.com', 1, Date.now() - 2 * 24 * 60 * 60 * 1000);",
              '',
              "    const response = await server.fetch(new Request('http://localhost/api/links/old/stats'));",
              '    expect((await response.json()).expired).toBe(true);',
              '  });',
              '',
            ].join('\n'),
          },
        ],
      },
      usage: { inputTokens: 14_700, outputTokens: 251 },
    },
    {
      type: 'tool-call',
      toolName: 'shell',
      // Bun reports results on stderr, which the transcript styles as an error.
      args: { command: 'bun test 2>&1' },
      usage: { inputTokens: 15_240, outputTokens: 30 },
    },
    {
      type: 'text',
      content: [
        '`GET /api/links/:slug/stats` now includes `expired`, true once a link is past `expiresAt`.',
        '',
        '`bun test`: 7 pass, 0 fail. This is on `feat/stats-expired-flag` in its own worktree, so it stays separate from the redirect fix on `main`.',
      ].join('\n'),
      usage: { inputTokens: 15_690, outputTokens: 92 },
    },
  ]);

  return session.id;
}
