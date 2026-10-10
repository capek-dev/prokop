/**
 * Unified permission concerns and the single policy table (permissions v2).
 *
 * The classifier reports facts (concerns); this module is the only place that
 * turns facts into a decision. Every harness policy consumer (prokop shell and
 * terminal tools, codex-cli and claude-cli pre-tool hooks) calls decide() so
 * behavior stays identical across harnesses.
 *
 * Policy (user decisions, docs/plans/unified-permissions.md):
 * - standard (default) auto-approves clean and opaque-only findings.
 * - extended additionally auto-approves outside-workspace paths.
 * - full auto-approves everything except catastrophic findings.
 * There is deliberately no ask-everything mode.
 */

export type PermissionMode = 'standard' | 'extended' | 'full';

export type PermissionDecision = 'auto' | 'ask';

export type Concern =
  | 'escape'
  | 'sensitive'
  | 'destructive'
  | 'opaque';

/** A span of the analyzed command (string offsets) and a plain-language
 * reason, so an ask can point at the exact part that needs review. */
export interface Highlight {
  readonly start: number;
  readonly end: number;
  readonly reason: string;
}

export interface Finding {
  readonly concerns: readonly Concern[];
  readonly catastrophic: boolean;
  readonly evidence: readonly string[];
  readonly resolvedPaths: readonly string[];
  /** Display-only spans; never consulted by decide(). */
  readonly highlights?: readonly Highlight[];
}

/** The single policy table. Empty concerns mean a clean finding. */
export function decide(mode: PermissionMode, finding: Finding): PermissionDecision {
  if (finding.catastrophic) return 'ask';
  if (mode === 'full') return 'auto';
  // Opaque-only findings auto-approve in every mode (the raw-text token screen
  // guarantees no dangerous token is hiding inside the opaque construct).
  if (finding.concerns.every(concern => concern === 'opaque')) return 'auto';
  // Extended unlocks outside-workspace paths only; every other concern asks.
  if (mode === 'extended') {
    return finding.concerns.every(concern => concern === 'escape' || concern === 'opaque')
      ? 'auto'
      : 'ask';
  }
  return 'ask';
}
