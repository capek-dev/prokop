/**
 * Compatibility forwarder (C5 subagent domain). The subagent task tool,
 * ancestry policy, and child-session execution moved to
 * `subagent/`; this module keeps the pre-C5 import path and export
 * identities until consumers migrate (workflow, compat barrel).
 */
export * from '../subagent/task-tool';
