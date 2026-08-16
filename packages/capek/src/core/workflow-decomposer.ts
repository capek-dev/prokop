/**
 * Compatibility forwarder (C5 workflow domain). Task decomposition moved to
 * `workflow/decomposer.ts`; this module keeps the pre-C5 import path and
 * export identities until consumers migrate (compat barrel).
 */
export * from '../workflow/decomposer';
