/**
 * Compatibility forwarder (C5 subagent domain). The ancestry and target
 * policy moved to `subagent/policy.ts`; this module keeps the pre-C5 import
 * path and export identities until consumers migrate (agent, workflow,
 * compat barrel).
 */
export * from '../subagent/policy';
