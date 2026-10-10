/**
 * Everything at once on a large screen: two sessions side by side, Changes
 * on the right, and a terminal running the tests below.
 */
import { openWorkspace, typeInTerminal, type Scene } from '../scene';
import { FIX_READY, RATE_LIMIT_READY } from './ready';

export const fullWorkspace: Scene = {
  name: 'full-workspace',
  async open(ctx, theme) {
    const { fixExpiredLinks, rateLimit } = ctx.world.sessions;
    const page = await openWorkspace(ctx, theme, {
      columns: [[fixExpiredLinks], [rateLimit]],
      rightActive: 'changes',
      docks: { right: true, bottom: true },
      bottomSize: 240,
      readyTexts: [FIX_READY, RATE_LIMIT_READY],
      viewport: { width: 1920, height: 1080 },
    });
    await page.getByRole('button', { name: /^Commit/ }).waitFor();
    await typeInTerminal(page, ['bun test']);
    return page;
  },
};
