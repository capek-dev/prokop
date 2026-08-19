import { AsyncLocalStorage } from 'node:async_hooks';
import { evaluateGoal, type EvaluateGoalOptions } from './evaluator';
import { runGoalLoop, type GoalLoopOptions } from './loop';

/**
 * Goal domain service access. The composed agent scope seeds the plugin
 * service here through `enterAgentScope` (when the goal domain plugin is
 * installed); consumers resolve the active service through `getGoalDomain()`.
 * Unscoped consumers keep the pre-adoption module path (module storage,
 * module broadcast, module evaluator) as the fallback, exactly like the C6
 * policy accessors.
 */

export interface GoalDomainService {
  evaluateGoal(options: EvaluateGoalOptions): ReturnType<typeof evaluateGoal>;
  runGoalLoop(options: GoalLoopOptions): Promise<void>;
}

const scopedService = new AsyncLocalStorage<GoalDomainService>();

function unscopedGoalDomain(): GoalDomainService {
  return {
    evaluateGoal: (options) => evaluateGoal(options),
    runGoalLoop: (options) => runGoalLoop(options),
  };
}

/** Resolves the scoped goal domain service, or the unscoped module-path
 * fallback outside a composed agent scope. */
export function getGoalDomain(): GoalDomainService {
  return scopedService.getStore() ?? unscopedGoalDomain();
}

/** Seeds a service for the callback duration. `enterAgentScope` seeds the
 * composed agent scope's service here when the goal domain plugin is
 * installed. */
export function withGoalDomain<T>(service: GoalDomainService, callback: () => T): T {
  return scopedService.run(service, callback);
}
