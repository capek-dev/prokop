import type { WorkspaceSettings } from '@prokopai/sdk';

export type SessionTagOrder = NonNullable<WorkspaceSettings['sessionTagOrder']>;

export const SESSION_TAG_ORDERS = [
  { value: 'tagged-first', label: 'Tagged first' },
  { value: 'untagged-first', label: 'Untagged first' },
] as const;

export function isSessionTagOrder(value: unknown): value is SessionTagOrder {
  return value === 'tagged-first' || value === 'untagged-first';
}

export function getSessionTagOrder(value: unknown): SessionTagOrder {
  return isSessionTagOrder(value) ? value : 'tagged-first';
}

/** Preserve tag recency and session ordering, moving only the untagged bucket. */
export function orderedSessionGroupNames(
  tagNames: readonly string[],
  hasUntagged: boolean,
  order: SessionTagOrder = 'tagged-first',
): string[] {
  if (!hasUntagged) return [...tagNames];
  return order === 'untagged-first'
    ? ['__ungrouped__', ...tagNames]
    : [...tagNames, '__ungrouped__'];
}
