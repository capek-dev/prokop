/**
 * Temporary forwarding module (S1).
 *
 * The event adapter implementation now lives in
 * `adapters/capek/events.ts`. This module keeps the old import path working
 * with the same function identities until consumers migrate.
 */
export {
  createJean2RuntimeContext,
  deliverCapekEvent,
  mapCapekEventToServerMessage,
  type Jean2EventRouter,
} from '@/adapters/capek/events';
