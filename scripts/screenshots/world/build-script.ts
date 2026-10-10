/**
 * A session stopped at a command approval, in its own worktree: the agent
 * adds a build script and wants to run `rm -rf dist && bun build ...`. Only
 * the delete is flagged and highlighted for review; the ask is left open.
 */
import type { WorldSetup } from './types';

/** The command whose approval the scene shows. */
export const BUILD_COMMAND = 'rm -rf dist && bun build src/server.ts --outdir dist --target bun';

export async function buildScript({ demo, workspaceId }: WorldSetup, worktreeId: string): Promise<string> {
  const title = 'Add a production build script';
  const { session } = await demo.rest.sessions.create({ workspaceId, title });
  await demo.rest.sessions.bindWorktree(session.id, worktreeId);
  await demo.scriptTitle(session.id, title);

  await demo.runTurn(
    session.id,
    'Add a `build` script that bundles the server into dist/ so we can deploy a single file.',
    [
      {
        type: 'tool-call',
        toolName: 'read-file',
        args: { path: 'package.json' },
        usage: { inputTokens: 12_880, outputTokens: 44 },
      },
      {
        type: 'tool-call',
        text: 'Adding a `build` script that clears `dist/` first, so stale chunks never ship.',
        toolName: 'edit',
        args: {
          path: 'package.json',
          revision: null,
          edits: [
            {
              oldString: '    "dev": "bun --watch src/server.ts",',
              newString: `    "dev": "bun --watch src/server.ts",\n    "build": "${BUILD_COMMAND}",`,
            },
          ],
        },
        usage: { inputTokens: 13_410, outputTokens: 132 },
      },
      {
        type: 'tool-call',
        text: 'Running it once to check the bundle.',
        toolName: 'shell',
        args: { command: BUILD_COMMAND },
        usage: { inputTokens: 13_920, outputTokens: 58 },
      },
    ],
    { until: 'ask' },
  );

  return session.id;
}
