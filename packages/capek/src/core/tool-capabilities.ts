import type { Session } from '@capekai/types';
import { getSession } from '../storage/runtime';

export type ToolExecutionScope = 'subsession' | 'scheduled';

const RESTRICTED_CAPABILITIES: Record<ToolExecutionScope, ReadonlySet<string>> = {
  subsession: new Set(['interactive-user-input']),
  scheduled: new Set(['interactive-user-input']),
};

export async function resolveToolExecutionScopes(
  sessionId: string,
  sessionLookup: (id: string) => Session | null | Promise<Session | null> = getSession,
): Promise<ReadonlySet<ToolExecutionScope>> {
  const scopes = new Set<ToolExecutionScope>();
  const visited = new Set<string>();
  let current = await sessionLookup(sessionId);

  if (!current) {
    return scopes;
  }

  if (current.parentId) {
    scopes.add('subsession');
  }

  while (current) {
    if (visited.has(current.id)) {
      break;
    }
    visited.add(current.id);

    if (!current.parentId) {
      const scheduledJobId = current.metadata?.scheduledJobId;
      if (typeof scheduledJobId === 'string' && scheduledJobId.length > 0) {
        scopes.add('scheduled');
      }
      break;
    }

    current = await sessionLookup(current.parentId);
  }

  return scopes;
}

export function isToolAllowedInContext(
  capabilities: readonly string[] | undefined,
  scopes: ReadonlySet<ToolExecutionScope>,
): boolean {
  if (!capabilities || capabilities.length === 0) {
    return true;
  }

  for (const scope of scopes) {
    const restricted = RESTRICTED_CAPABILITIES[scope];
    for (const capability of capabilities) {
      if (restricted.has(capability)) {
        return false;
      }
    }
  }

  return true;
}
