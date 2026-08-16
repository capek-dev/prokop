/**
 * Temporary forwarding module (S1).
 *
 * The broad adapter composition moved to the focused `adapters/capek` modules
 * and the explicit `bootstrap/create-runtime.ts` composition root. This module
 * keeps the old import path working with the same object and function
 * identities until consumers migrate (S8).
 */
export { configureCapekJean2Compatibility } from '@/bootstrap/create-runtime';
export {
  jean2CompatibilityBindings,
  jean2RuntimeConfiguration,
  jean2SchedulerHost,
  jean2SessionSearchHost,
  jean2StorageBundle,
} from '@/adapters/capek';
