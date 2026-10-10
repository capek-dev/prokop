/**
 * Three sessions side by side: the finished fix on the left, the running
 * rate-limit session and the slug Q&A stacked on the right.
 */
import { openWorkspace, type Scene } from '../scene';
import { FIX_READY, RATE_LIMIT_READY, SLUGS_READY } from './ready';

export const multiSession: Scene = {
  name: 'multi-session',
  open: (ctx, theme) => {
    const { fixExpiredLinks, rateLimit, explainSlugs } = ctx.world.sessions;
    return openWorkspace(ctx, theme, {
      columns: [[fixExpiredLinks], [rateLimit, explainSlugs]],
      readyTexts: [FIX_READY, RATE_LIMIT_READY, SLUGS_READY],
    });
  },
};
