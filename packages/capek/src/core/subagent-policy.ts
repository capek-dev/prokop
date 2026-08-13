import type { Preconfig, Session } from '@jean2/sdk';
import { getSession, listPreconfigs } from '../compat/jean2-dependencies';

export type SubagentPolicyReason =
  | 'allowed'
  | 'maximum_depth'
  | 'target_not_allowed'
  | 'self_disabled'
  | 'repeated_ancestor';

export interface SubagentPolicyResult {
  allowed: boolean;
  reason: SubagentPolicyReason;
  error?: string;
}

export interface SubagentAncestry {
  preconfigIds: string[];
  depth: number;
}

export interface ResolveSubagentTargetsOptions {
  sessionId: string;
  canSpawnSubagents?: boolean | string[] | null;
  allowSelfAsSubagent?: boolean;
  currentPreconfig?: Preconfig | null;
  maximumDepthReached?: boolean;
}

export function isValidSubagentPreconfig(preconfig: Pick<Preconfig, 'mode'>): boolean {
  const mode = preconfig.mode ?? 'primary';
  return mode === 'subagent' || mode === 'both';
}

export function isValidSubagentTargetPreconfig(
  preconfig: Pick<Preconfig, 'id' | 'mode'>,
  currentPreconfigId: string | null,
  allowSelfAsSubagent: boolean,
): boolean {
  return isValidSubagentPreconfig(preconfig)
    || (allowSelfAsSubagent && preconfig.id === currentPreconfigId);
}

export function isSubagentSpawningDisabled(
  canSpawnSubagents: boolean | string[] | null | undefined,
): boolean {
  return canSpawnSubagents === false
    || canSpawnSubagents === null
    || (Array.isArray(canSpawnSubagents) && canSpawnSubagents.length === 0);
}

export function getSubagentResumeError(
  childSession: Pick<Session, 'parentId' | 'preconfigId'>,
  parentSessionId: string,
  targetPreconfigId: string,
): string | null {
  if (childSession.parentId !== parentSessionId) {
    return 'Invalid task_id: does not belong to this session';
  }

  if (childSession.preconfigId !== targetPreconfigId) {
    return `Invalid task_id: belongs to subagent type "${childSession.preconfigId ?? 'unknown'}", not "${targetPreconfigId}"`;
  }

  return null;
}

export function collectSubagentAncestry(sessionId: string): SubagentAncestry {
  const preconfigIds: string[] = [];
  const visitedSessionIds = new Set<string>();
  let currentSessionId: string | null = sessionId;
  let depth = 0;

  while (currentSessionId && !visitedSessionIds.has(currentSessionId)) {
    visitedSessionIds.add(currentSessionId);
    const session = getSession(currentSessionId);
    if (!session) break;

    if (session.preconfigId) {
      preconfigIds.push(session.preconfigId);
    }

    if (!session.parentId) break;
    depth++;
    currentSessionId = session.parentId;
  }

  return { preconfigIds, depth };
}

export function evaluateSubagentTarget(options: {
  targetPreconfigId: string;
  currentPreconfigId: string | null;
  ancestryPreconfigIds: string[];
  allowSelfAsSubagent: boolean;
  allowedSubagentIds?: string[];
  maximumDepthReached?: boolean;
}): SubagentPolicyResult {
  const {
    targetPreconfigId,
    currentPreconfigId,
    ancestryPreconfigIds,
    allowSelfAsSubagent,
    allowedSubagentIds,
    maximumDepthReached,
  } = options;

  if (maximumDepthReached) {
    return { allowed: false, reason: 'maximum_depth' };
  }

  if (allowedSubagentIds && !allowedSubagentIds.includes(targetPreconfigId)) {
    return { allowed: false, reason: 'target_not_allowed' };
  }

  if (currentPreconfigId === targetPreconfigId) {
    if (!allowSelfAsSubagent) {
      return {
        allowed: false,
        reason: 'self_disabled',
        error: `Preconfig "${targetPreconfigId}" is not allowed to use itself as a subagent.`,
      };
    }

    if (ancestryPreconfigIds.slice(1).includes(targetPreconfigId)) {
      return {
        allowed: false,
        reason: 'repeated_ancestor',
        error: `Preconfig "${targetPreconfigId}" is already present in this subagent chain.`,
      };
    }

    return { allowed: true, reason: 'allowed' };
  }

  if (ancestryPreconfigIds.includes(targetPreconfigId)) {
    return {
      allowed: false,
      reason: 'repeated_ancestor',
      error: `Preconfig "${targetPreconfigId}" is already present in this subagent chain.`,
    };
  }

  return { allowed: true, reason: 'allowed' };
}

export async function resolveEffectiveSubagentTargets(
  options: ResolveSubagentTargetsOptions,
): Promise<Preconfig[]> {
  const spawningEnabled = options.canSpawnSubagents === true
    || (Array.isArray(options.canSpawnSubagents) && options.canSpawnSubagents.length > 0);
  if (!spawningEnabled || options.maximumDepthReached) return [];

  const ancestry = collectSubagentAncestry(options.sessionId);
  const currentSession = getSession(options.sessionId);
  const currentPreconfigId = currentSession?.preconfigId ?? options.currentPreconfig?.id ?? null;
  const allowSelfAsSubagent = options.allowSelfAsSubagent
    ?? options.currentPreconfig?.allowSelfAsSubagent
    ?? false;
  const configuredIds = Array.isArray(options.canSpawnSubagents)
    ? options.canSpawnSubagents
    : undefined;
  const effectiveAllowedIds = configuredIds
    ? [...new Set([...configuredIds, ...(currentPreconfigId && allowSelfAsSubagent ? [currentPreconfigId] : [])])]
    : undefined;

  const candidates = await listPreconfigs();
  return candidates.filter((candidate) => isValidSubagentTargetPreconfig(
    candidate,
    currentPreconfigId,
    allowSelfAsSubagent,
  ) && evaluateSubagentTarget({
    targetPreconfigId: candidate.id,
    currentPreconfigId,
    ancestryPreconfigIds: ancestry.preconfigIds,
    allowSelfAsSubagent,
    allowedSubagentIds: effectiveAllowedIds,
  }).allowed);
}
