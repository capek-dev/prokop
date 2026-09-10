import type { LearningCadence, LearningSources } from '@prokopai/sdk';
import { learningCadenceSchema, sessionLearningSettingsSchema } from './settings';

const MINUTE_MS = 60_000;
export const LEARNING_BACKFILL_MS = 7 * 24 * 60 * MINUTE_MS;

export interface LearningTimingInput {
  now: number;
  /** Age of unprocessed evidence, not the most recent queue insertion. */
  oldestPendingAt: number | null;
  lastForegroundActivityAt: number;
  lastStartedAt: number | null;
  foregroundRunning: boolean;
  reviewRunning: boolean;
  cadence: LearningCadence;
}

export type LearningTimingDecision =
  | { due: true; reason: 'idle' | 'maximum_pending' }
  | { due: false; reason: 'invalid' | 'empty' | 'running' | 'cooldown' | 'busy' };

/** Caller supplies completed evidence only, including for the busy-scope fallback. */
export function decideLearningTiming(input: LearningTimingInput): LearningTimingDecision {
  const times = [input.now, input.lastForegroundActivityAt, input.oldestPendingAt, input.lastStartedAt];
  if (times.some(time => time !== null && (!Number.isFinite(time) || time < 0))
    || !learningCadenceSchema.safeParse(input.cadence).success) {
    return { due: false, reason: 'invalid' };
  }
  if (input.oldestPendingAt === null) return { due: false, reason: 'empty' };
  if (input.reviewRunning) return { due: false, reason: 'running' };
  if (input.lastStartedAt !== null
    && input.now - input.lastStartedAt < input.cadence.minimumIntervalMinutes * MINUTE_MS) {
    return { due: false, reason: 'cooldown' };
  }
  if (input.now < input.oldestPendingAt || input.now < input.lastForegroundActivityAt) {
    return { due: false, reason: 'invalid' };
  }
  if (input.now - input.oldestPendingAt >= input.cadence.maximumPendingMinutes * MINUTE_MS) {
    return { due: true, reason: 'maximum_pending' };
  }
  if (!input.foregroundRunning
    && input.now - input.lastForegroundActivityAt >= input.cadence.idleMinutes * MINUTE_MS) {
    return { due: true, reason: 'idle' };
  }
  return { due: false, reason: 'busy' };
}

export type LearningEvidenceScope =
  | { kind: 'workspace'; workspaceId: string }
  | { kind: 'agent'; agentId: string; sources: LearningSources };

export interface LearningEvidenceCandidate {
  workspaceId: string;
  /** Verified participation for this conversation range, not the reviewer identity. */
  participatingAgentIds: readonly string[];
  /** Server-owned classification, including inherited automated origin. */
  origin: 'foreground' | 'automated' | 'learning';
  /** Must be resolved by the host; missing/deleted ancestor policy fails closed. */
  ancestorsEligible: boolean;
  completed: boolean;
  sessionLearning: unknown;
  allowPersonalLearning: unknown;
}

/** Reuse for discovery AND every subsequent search/read, before limits and snippets. */
export function isLearningEvidenceEligible(
  scope: LearningEvidenceScope,
  candidate: LearningEvidenceCandidate,
): boolean {
  if (!candidate.completed || !candidate.ancestorsEligible || candidate.origin === 'learning') return false;
  const result = sessionLearningSettingsSchema.safeParse(candidate.sessionLearning === undefined ? {} : candidate.sessionLearning);
  if (!result.success || result.data.excluded) return false;
  if (candidate.origin !== 'foreground' && !(candidate.origin === 'automated' && result.data.includeAutomated)) return false;
  if (scope.kind === 'workspace') return candidate.workspaceId === scope.workspaceId;
  if (candidate.allowPersonalLearning !== undefined && candidate.allowPersonalLearning !== true) return false;
  if (!candidate.participatingAgentIds.includes(scope.agentId)) return false;
  return scope.sources.mode === 'all' || scope.sources.workspaceIds.includes(candidate.workspaceId);
}
