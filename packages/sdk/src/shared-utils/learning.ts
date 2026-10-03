import type { LearningCadence, LearningScope } from '../shared-types/learning';

/** Effective timing when a learner has no custom cadence. */
export function defaultLearningCadence(scope: LearningScope): LearningCadence {
  return {
    idleMinutes: scope === 'workspace' ? 30 : 60,
    minimumIntervalMinutes: scope === 'workspace' ? 120 : 1440,
    maximumPendingMinutes: 1440,
  };
}
