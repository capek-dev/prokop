/**
 * Explorer on the right with the edited handler open in the editor, showing
 * the agent's change inline.
 */
import { clickTreeItem, openWorkspace, type Scene } from '../scene';
import { FIX_READY } from './ready';

export const explorer: Scene = {
  name: 'explorer',
  async open(ctx, theme) {
    const page = await openWorkspace(ctx, theme, {
      columns: [[ctx.world.sessions.fixExpiredLinks]],
      rightActive: 'explorer',
      docks: { right: true },
      readyTexts: [FIX_READY],
    });
    await clickTreeItem(page, 'src/');
    await clickTreeItem(page, 'src/routes/');
    await clickTreeItem(page, 'src/routes/redirect.ts');
    // The click opens a preview; once its content loaded, Edit docks the file in the editor.
    await page.getByRole('dialog').getByText('Link expired').waitFor();
    await page.getByRole('dialog').getByRole('button', { name: 'Edit' }).click();
    await page.getByRole('dialog').waitFor({ state: 'detached' });
    await page.getByRole('tab', { name: /redirect\.ts/ }).waitFor();
    return page;
  },
};
