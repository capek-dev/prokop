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

/** A span of the ask's `metadata.command` (string offsets). */
export interface PermissionAskSpan {
  readonly start: number;
  readonly end: number;
}

/** A command span that needs review, with a plain-language reason. */
export interface PermissionAskHighlight extends PermissionAskSpan {
  readonly reason: string;
}

export interface PermissionAskDetails {
  readonly concerns: readonly PermissionAskConcern[];
  readonly catastrophic: boolean;
  readonly evidence: readonly string[];
  /** Shell asks only; empty when absent or malformed. */
  readonly highlights: readonly PermissionAskHighlight[];
  /** Top-level pipeline stages of the command; empty when absent. */
  readonly commandSegments: readonly PermissionAskSpan[];
}

/** A permission ask carrying the classified concern fields: the exact shape
 * the server ask builders put on the wire. Use for fixtures and tests; the
 * plain capek `PermissionAsk` stays the reading type everywhere else. */
export type ClassifiedPermissionAsk = PermissionAsk & {
  concerns: readonly PermissionAskConcern[];
  catastrophic: boolean;
  evidence?: readonly string[];
  highlights?: readonly PermissionAskHighlight[];
  commandSegments?: readonly PermissionAskSpan[];
};

const VALID_CONCERNS: readonly string[] = ['escape', 'sensitive', 'destructive', 'opaque'];

function isSpan(value: unknown): value is PermissionAskSpan {
  const span = value as Partial<PermissionAskSpan> | null;
  return !!span && Number.isInteger(span.start) && Number.isInteger(span.end)
    && span.start! >= 0 && span.end! > span.start!;
}

function readSpans<T extends PermissionAskSpan>(value: unknown, accept: (item: PermissionAskSpan) => item is T): T[] {
  return Array.isArray(value) ? value.filter(isSpan).filter(accept).slice(0, 16) : [];
}

const isHighlight = (item: PermissionAskSpan): item is PermissionAskHighlight => {
  const reason = (item as Partial<PermissionAskHighlight>).reason;
  return typeof reason === 'string' && reason.length > 0 && reason.length <= 200;
};

/** Reads and validates the concern fields off a permission ask. Unknown
 * concern strings are dropped (forward compatibility); a missing concerns
 * array means the ask predates the fields. */
export function readPermissionAskDetails(ask: PermissionAsk): PermissionAskDetails | null {
  const record = ask as PermissionAsk & {
    concerns?: unknown;
    evidence?: unknown;
    catastrophic?: unknown;
    highlights?: unknown;
    commandSegments?: unknown;
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
    highlights: readSpans(record.highlights, isHighlight)
      .map(({ start, end, reason }) => ({ start, end, reason })),
    commandSegments: readSpans(record.commandSegments, (item): item is PermissionAskSpan => true)
      .map(({ start, end }) => ({ start, end })),
  };
}
