/**
 * The finished fix with the right dock on Changes: the agent's two edited
 * files, uncommitted in the demo repo, next to the conversation that made them.
 */
import { openWorkspace, type Scene } from '../scene';
import { FIX_READY } from './ready';

export const gitWorkbench: Scene = {
  name: 'git-workbench',
  async open(ctx, theme) {
    const page = await openWorkspace(ctx, theme, {
      columns: [[ctx.world.sessions.fixExpiredLinks]],
      rightActive: 'changes',
      docks: { right: true },
      readyTexts: [FIX_READY],
    });
    // File rows live in the tree's shadow DOM; the Commit action appears once changes loaded.
    await page.getByRole('button', { name: /^Commit/ }).waitFor();
    return page;
  },
};
