import type { PermissionAsk } from '../shared-types/index';

/**
 * Permissions v2 ask details (docs/plans/unified-permissions.md).
 *
 * Server-side ask builders write `concerns` / `evidence` / `catastrophic`
 * top-level on the PermissionAsk wire JSON. The `Ask` union itself is
 * capek-typed, so these ride as additive fields; this reader is the typed
 * access for both ends (mirrors the server's `readAskConcerns` plus the
 * evidence list). Returns null for asks without the fields (legacy asks) or
 * with malformed values, so callers fall back to the legacy risk display.
 */

export type PermissionAskConcern = 'escape' | 'sensitive' | 'destructive' | 'opaque';

export interface PermissionAskDetails {
  readonly concerns: readonly PermissionAskConcern[];
  readonly catastrophic: boolean;
  readonly evidence: readonly string[];
}

/** A permission ask carrying the classified concern fields: the exact shape
 * the server ask builders put on the wire. Use for fixtures and tests; the
 * plain capek `PermissionAsk` stays the reading type everywhere else. */
export type ClassifiedPermissionAsk = PermissionAsk & {
  concerns: readonly PermissionAskConcern[];
  catastrophic: boolean;
  evidence?: readonly string[];
};

const VALID_CONCERNS: readonly string[] = ['escape', 'sensitive', 'destructive', 'opaque'];

/** Reads and validates the concern fields off a permission ask. Unknown
 * concern strings are dropped (forward compatibility); a missing concerns
 * array means the ask predates the fields. */
export function readPermissionAskDetails(ask: PermissionAsk): PermissionAskDetails | null {
  const record = ask as PermissionAsk & {
    concerns?: unknown;
    evidence?: unknown;
    catastrophic?: unknown;
  };
  if (!Array.isArray(record.concerns)) return null;
  const concerns = record.concerns.filter(
    (concern): concern is PermissionAskConcern =>
      typeof concern === 'string' && VALID_CONCERNS.includes(concern),
  );
  const evidence = Array.isArray(record.evidence)
    ? record.evidence.filter((line): line is string =>
      typeof line === 'string' && line.length > 0 && line.length <= 1000)
    : [];
  return {
    concerns,
    catastrophic: record.catastrophic === true,
    evidence: evidence.slice(0, 8),
  };
}
