/** The same finished bug fix on a phone. */
import { openSession, PHONE, type Scene } from '../scene';
import { FIX_READY } from './ready';

export const mobile: Scene = {
  name: 'mobile',
  open: (ctx, theme) => openSession(ctx, theme, ctx.world.sessions.fixExpiredLinks, FIX_READY, PHONE),
};
