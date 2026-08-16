/**
 * Compatibility forwarder (C5 workflow domain). The workflow execution,
 * decomposition, synthesis, and orchestrator-session implementation moved
 * to `workflow/`; this module keeps the pre-C5 import path and export
 * identities until consumers migrate (compat barrel, goal-evaluator).
 */
export * from '../workflow/execution';
