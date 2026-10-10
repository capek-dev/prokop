/** Desktop session view of the finished bug fix. */
import { openSession, type Scene } from '../scene';
import { FIX_READY } from './ready';

export const hero: Scene = {
  name: 'hero',
  open: (ctx, theme) => openSession(ctx, theme, ctx.world.sessions.fixExpiredLinks, FIX_READY),
};
