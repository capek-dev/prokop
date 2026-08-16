/**
 * Compatibility forwarder (C5 workflow domain). The shared workflow/goals
 * orchestrator model-turn service implementation moved to
 * `workflow/orchestrator-session.ts`; the named contract is
 * `capek.orchestrator-session` in `plugins/service-keys.ts` with the
 * provider in `plugins/orchestrator-session.ts`. This module keeps the
 * pre-C5 import path for goal-evaluator and the compat barrel until the
 * goals slice consumes the named contract.
 */
export * from '../workflow/orchestrator-session';
