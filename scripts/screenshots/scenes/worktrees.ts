/**
 * The running rate-limit session, which works in its own worktree, next to
 * the Worktrees panel listing both demo worktrees.
 */
import { openWorkspace, type Scene } from '../scene';
import { RATE_LIMIT_READY } from './ready';

export const worktrees: Scene = {
  name: 'worktrees',
  async open(ctx, theme) {
    const page = await openWorkspace(ctx, theme, {
      columns: [[ctx.world.sessions.rateLimit]],
      rightActive: 'worktrees',
      docks: { right: true },
      readyTexts: [RATE_LIMIT_READY],
    });
    await page.getByText('stats-expired-flag').first().waitFor();
    return page;
  },
};
