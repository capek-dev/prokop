/** The finished fix with a real terminal below it: git status and the test run. */
import { openWorkspace, typeInTerminal, type Scene } from '../scene';
import { FIX_READY } from './ready';

export const terminal: Scene = {
  name: 'terminal',
  async open(ctx, theme) {
    const page = await openWorkspace(ctx, theme, {
      columns: [[ctx.world.sessions.fixExpiredLinks]],
      docks: { bottom: true },
      bottomSize: 380,
      readyTexts: [FIX_READY],
    });
    await typeInTerminal(page, ['git status --short', 'bun test']);
    return page;
  },
};
