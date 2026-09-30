import type {
  CreateScheduledJobInput as BaseCreateScheduledJobInput,
  ScheduledJob as BaseScheduledJob,
} from '@capekai/types/scheduled-job';
import type { SessionHarness } from './session';

export * from '@capekai/types/scheduled-job';

/**
 * Product extension of the neutral scheduled-job record. The base contract
 * lives in @capekai/types; the owning harness identity is Prokop product
 * data (same identity as Session.harness) and extends here. The column
 * defaults to 'prokop'; older rows backfill through the schema migration.
 */
export interface ScheduledJob extends BaseScheduledJob {
  harness: SessionHarness;
}

export interface CreateScheduledJobInput extends BaseCreateScheduledJobInput {
  /** Optional at creation; persisted as 'prokop' when omitted. Creation
   * rejects harnesses without a headless execution implementation. */
  harness?: SessionHarness;
}
