import type { Preconfig as CapekPreconfig } from '@capekai/types/preconfig';
import type { SessionHarness } from './session';

export type { PreconfigCapabilities, PreconfigMode } from '@capekai/types/preconfig';

/**
 * Product extension of the capek preconfig contract: which harness the pinned
 * model belongs to. Absent or null means the Prokop catalog (existing stored
 * preconfigs keep working unchanged); 'codex-cli'/'claude-cli' pins apply only
 * to sessions created on the matching harness.
 */
export interface Preconfig extends CapekPreconfig {
  modelHarness?: SessionHarness | null;
}
