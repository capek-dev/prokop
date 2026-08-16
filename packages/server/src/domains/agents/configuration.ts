import type { Preconfig, PreconfigMode } from '@jean2/sdk';

/**
 * Agents domain: subagent configuration rules.
 *
 * Owns the preconfig rules that decide which preconfigs are usable as
 * subagent targets and how `canSpawnSubagents` arrays are sanitized against
 * the known target ids. The pre-S4 rules were duplicated between
 * `core/preconfig.ts` (warn, filter, disable) and
 * `configuration/preconfigs.ts` (reject); both consumers now apply these
 * shared primitives and keep their own reaction.
 */

export function effectivePreconfigMode(mode: PreconfigMode | undefined): PreconfigMode {
  return mode ?? 'primary';
}

/** A preconfig is a subagent target when its effective mode is 'subagent'
 * or 'both'. */
export function isSubagentTargetPreconfig(preconfig: Pick<Preconfig, 'mode'>): boolean {
  const mode = effectivePreconfigMode(preconfig.mode);
  return mode === 'subagent' || mode === 'both';
}

/** The ids of every preconfig usable as a subagent target. */
export function knownSubagentIds(preconfigs: Preconfig[]): Set<string> {
  return new Set(preconfigs.filter(isSubagentTargetPreconfig).map((preconfig) => preconfig.id));
}

export interface CanSpawnSubagentsSanitization {
  /** Ids from the configured list that are known subagent targets. */
  validIds: string[];
  /** Ids from the configured list that are not known subagent targets. */
  invalidIds: string[];
}

/** Splits a `canSpawnSubagents` id list into known and unknown target ids
 * without changing the configured order of the valid ids. */
export function sanitizeCanSpawnSubagentsIds(
  configuredIds: string[],
  knownIds: Set<string>,
): CanSpawnSubagentsSanitization {
  const validIds: string[] = [];
  const invalidIds: string[] = [];
  for (const id of configuredIds) {
    (knownIds.has(id) ? validIds : invalidIds).push(id);
  }
  return { validIds, invalidIds };
}

/** The first id in the configured list that is not a known subagent target,
 * or null when every id is known. Used by the strict configuration
 * validation path. */
export function firstUnknownSubagentId(
  configuredIds: string[],
  knownIds: Set<string>,
): string | null {
  for (const id of configuredIds) {
    if (!knownIds.has(id)) return id;
  }
  return null;
}
