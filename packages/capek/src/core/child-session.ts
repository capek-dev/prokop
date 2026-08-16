/**
 * Compatibility forwarder (C5 subagent domain). Child-session execution
 * moved to `subagent/child-session.ts`; this module keeps the pre-C5 import
 * path (compat barrel and its consumers) unchanged.
 */
export * from '../subagent/child-session';
