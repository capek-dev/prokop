/**
 * A pending command approval: the agent wants to clean and build, and only
 * `rm -rf dist` is flagged and highlighted for review.
 */
import { openWorkspace, type Scene } from '../scene';

export const commandApproval: Scene = {
  name: 'command-approval',
  async open(ctx, theme) {
    const page = await openWorkspace(ctx, theme, {
      columns: [[ctx.world.sessions.buildScript]],
      readyTexts: ['Running it once to check the bundle.'],
    });
    await page.getByText('Allow this command to run?').first().waitFor();
    return page;
  },
};
