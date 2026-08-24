import type { ControllerGatedAction as CapekControllerGatedAction } from '@capekai/types';

/**
 * Prokopai extends the neutral Capek gate action union with session
 * transcript mutations. Prokop emits a strict superset: every Capek action
 * remains valid, plus the transcript actions gated only by this server.
 */
export type ControllerGatedAction =
  | CapekControllerGatedAction
  | 'session.compact'
  | 'session.revert'
  | 'session.fork';

export * from '@capekai/types/wire';
