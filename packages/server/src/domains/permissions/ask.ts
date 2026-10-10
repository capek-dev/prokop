/**
 * Permission-ask bridge (permissions v2, slice 4).
 *
 * Connects Findings to the ask wire and to every auto-approve decision point.
 *
 * - Ask builders write `concerns` / `evidence` / `catastrophic` top-level on
 *   the PermissionAsk JSON (the Ask union is capek-typed, so these are
 *   additive fields, like the existing `paths` extension).
 * - The legacy `risk` field is DERIVED from the Finding here, once:
 *   catastrophic -> critical, sensitive/destructive -> high, escape ->
 *   medium, otherwise low. Combined with severityFromMode (standard -> low,
 *   extended -> medium, full -> high), every surviving severity consumer —
 *   the capek runtime auto-approve, and the client handler until its removal
 *   — reproduces decide() exactly. One mapping, no drift.
 * - shouldAutoApproveAsk is the single decision helper for asks that carry
 *   concerns; asks without them (feature-risk settings like memory/session
 *   search, capek workspace-policy file asks) keep the legacy ceiling so
 *   their behavior does not change in this slice.
 */

import type { PermissionAsk, PermissionRiskLevel } from '@prokopai/sdk';
import { decide, type Concern, type Finding, type Highlight, type PermissionMode } from './concerns';
import { severityFromMode } from './legacy-severity';

/** PermissionAsk extended with the permissions-v2 concern fields. */
export interface ConcernsPermissionAsk extends PermissionAsk {
  concerns?: readonly Concern[];
  evidence?: readonly string[];
  catastrophic?: boolean;
  /** Shell asks: spans of `metadata.command` that need review, and the
   * top-level pipeline stages for one-stage-per-line display. */
  highlights?: readonly Highlight[];
  commandSegments?: ReadonlyArray<{ start: number; end: number }>;
}

function riskOfConcerns(concerns: readonly Concern[], catastrophic: boolean): PermissionRiskLevel {
  if (catastrophic) return 'critical';
  if (concerns.includes('sensitive') || concerns.includes('destructive')) return 'high';
  if (concerns.includes('escape')) return 'medium';
  return 'low';
}

/** The single place a Finding becomes the ask's legacy risk level. */
export function concernRisk(finding: Finding): PermissionRiskLevel {
  return riskOfConcerns(finding.concerns, finding.catastrophic);
}

/** Reads and validates the concern fields off an ask. Null when the ask
 * predates the fields or carries malformed ones. */
export function readAskConcerns(ask: PermissionAsk): Pick<Finding, 'concerns' | 'catastrophic'> | null {
  const record = ask as ConcernsPermissionAsk;
  if (!Array.isArray(record.concerns)) return null;
  const valid: readonly Concern[] = ['escape', 'sensitive', 'destructive', 'opaque'];
  const concerns = record.concerns.filter((concern): concern is Concern =>
    (valid as readonly string[]).includes(concern));
  return { concerns, catastrophic: record.catastrophic === true };
}

const LEGACY_RISK_ORDER: PermissionRiskLevel[] = ['none', 'low', 'medium', 'high'];

/** Legacy ceiling for asks without concern fields (unchanged behavior). */
function legacyShouldAutoApprove(risk: PermissionRiskLevel | undefined, mode: PermissionMode): boolean {
  if (typeof risk !== 'string') return false;
  const riskIndex = LEGACY_RISK_ORDER.indexOf(risk);
  const ceilingIndex = LEGACY_RISK_ORDER.indexOf(severityFromMode(mode));
  // Critical and unknown risks never auto-approve.
  return riskIndex !== -1 && ceilingIndex !== -1 && riskIndex <= ceilingIndex;
}

/** The one auto-approve decision for asks. Concerns-bearing asks go through
 * decide(); legacy asks keep the severity ceiling. */
export function shouldAutoApproveAsk(ask: PermissionAsk, mode: PermissionMode): boolean {
  const details = readAskConcerns(ask);
  if (details) return decide(mode, { ...details, evidence: [], resolvedPaths: [] }) === 'auto';
  return legacyShouldAutoApprove(ask.risk, mode);
}

/** True when the finding contains anything a human (or the mode ceiling)
 * must decide: any real concern beyond opaque, or a catastrophic floor.
 * Tools use this to skip the ask flow entirely for clean/opaque commands. */
export function requiresHumanReview(finding: Finding): boolean {
  return finding.catastrophic || finding.concerns.some(concern => concern !== 'opaque');
}

/** Grant scopes an ask may offer: destructive and catastrophic findings are
 * once-only; escape and sensitive findings may be remembered for the session
 * or workspace (docs/plans/unified-permissions.md, grants rule). */
export function grantScopesForFinding(finding: Finding): PermissionAsk['allowedScopes'] {
  if (finding.catastrophic || finding.concerns.includes('destructive')) return ['once'];
  return ['once', 'session', 'workspace'];
}
