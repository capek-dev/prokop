/** Branch history of the demo repo next to the finished fix. */
import { openWorkspace, type Scene } from '../scene';
import { FIX_READY } from './ready';

export const branches: Scene = {
  name: 'branches',
  async open(ctx, theme) {
    const page = await openWorkspace(ctx, theme, {
      columns: [[ctx.world.sessions.fixExpiredLinks]],
      rightActive: 'branches',
      docks: { right: true },
      readyTexts: [FIX_READY],
    });
    await page.getByText('Cover redirects and click counting with tests').first().waitFor();
    return page;
  },
};
