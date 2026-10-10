/**
 * The demo world every scene views: one workspace on the linkshelf repo with
 * sessions in different states, three of them in their own worktrees. Built
 * once per run; scenes only open views.
 */
import { createDemoRepo } from '../seed';
import type { Demo } from '../script';
import { buildScript } from './build-script';
import { explainSlugs } from './explain-slugs';
import { fixExpiredLinks } from './fix-expired-links';
import { rateLimit } from './rate-limit';
import { statsExpiredFlag } from './stats-expired-flag';

export { FIX_EXPIRED_LINKS_READY } from './fix-expired-links';

export interface World {
  repo: string;
  workspaceId: string;
  sessions: {
    explainSlugs: string;
    statsExpiredFlag: string;
    rateLimit: string;
    buildScript: string;
    fixExpiredLinks: string;
  };
}

export async function buildWorld(demo: Demo, home: string): Promise<World> {
  const repo = createDemoRepo(home);
  const { workspace } = await demo.rest.workspaces.create({ name: 'linkshelf', path: repo });
  const setup = { demo, repo, workspaceId: workspace.id };

  const worktree = async (name: string, branch: string) =>
    (await demo.rest.workspaces.createWorktree(workspace.id, { name, branch: `refs/heads/${branch}` })).worktree.id;
  const statsWorktree = await worktree('stats-expired-flag', 'feat/stats-expired-flag');
  const rateLimitWorktree = await worktree('rate-limit', 'feat/rate-limit');
  const buildScriptWorktree = await worktree('build-script', 'chore/build-script');

  // Oldest first, so the hero session ends up on top of the sidebar.
  const explainSlugsId = await explainSlugs(setup);
  const statsExpiredFlagId = await statsExpiredFlag(setup, statsWorktree);
  const rateLimitId = await rateLimit(setup, rateLimitWorktree);
  const buildScriptId = await buildScript(setup, buildScriptWorktree);
  const fixExpiredLinksId = await fixExpiredLinks(setup);

  return {
    repo,
    workspaceId: workspace.id,
    sessions: {
      explainSlugs: explainSlugsId,
      statsExpiredFlag: statsExpiredFlagId,
      rateLimit: rateLimitId,
      buildScript: buildScriptId,
      fixExpiredLinks: fixExpiredLinksId,
    },
  };
}
