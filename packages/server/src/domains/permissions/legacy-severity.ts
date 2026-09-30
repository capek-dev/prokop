import type { PermissionMode } from './concerns';

/**
 * The permissions-v2 risk bridge: maps the three-level permission mode onto
 * capek's legacy risk-severity ceiling. Load-bearing in two places, both
 * intentional and permanent:
 *
 * - The capek interaction host getter: capek's default permission provider
 *   auto-approves asks whose Finding-derived risk (`concernRisk`, the other
 *   half of the bridge) sits at or below this ceiling — which reproduces
 *   decide() exactly for prokop tool asks.
 * - `shouldAutoApproveAsk`'s legacy ceiling for asks without concern fields
 *   (feature-risk settings like memory writes and session search).
 *
 * There is no ask-everything level: it was removed by design, so nothing
 * maps below 'low'.
 */
export type LegacyAutoApproveSeverity = 'none' | 'low' | 'medium' | 'high';

export function severityFromMode(mode: PermissionMode): LegacyAutoApproveSeverity {
  return mode === 'full' ? 'high' : mode === 'extended' ? 'medium' : 'low';
}
