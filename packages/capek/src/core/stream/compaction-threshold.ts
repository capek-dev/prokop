/**
 * C6 pinned compatibility forwarder. The auto-threshold computation moved to
 * `compaction/policy.ts` and resolves the scoped compaction service; the
 * exported function identity is unchanged.
 */

export { computeAutoThreshold } from '../../compaction/policy';
export type { AutoThresholdResult } from '../../compaction/contracts';
