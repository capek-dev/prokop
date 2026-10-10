/** A short, finished question-and-answer session. */
import { repoPath, type WorldSetup } from './types';

export async function explainSlugs({ demo, workspaceId }: WorldSetup): Promise<string> {
  const title = 'How are slugs generated?';
  const { session } = await demo.rest.sessions.create({ workspaceId, title });
  await demo.scriptTitle(session.id, title);

  await demo.runTurn(session.id, 'How are slugs generated, and how likely is a collision?', [
    {
      type: 'tool-call',
      toolName: 'read-file',
      args: { path: repoPath('src/slug.ts') },
      usage: { inputTokens: 12_940, outputTokens: 52 },
    },
    {
      type: 'text',
      content: [
        '`createSlug` in `src/slug.ts` picks 7 characters from a 31-character alphabet. It leaves out `0`, `1`, `i`, `l` and `o` so slugs are easy to read aloud.',
        '',
        'That gives 31^7, about 27.5 billion slugs. `createLink` retries on a collision, so a duplicate is never stored. Retries only become common once you have billions of links.',
      ].join('\n'),
      usage: { inputTokens: 13_380, outputTokens: 118 },
    },
  ]);

  return session.id;
}
