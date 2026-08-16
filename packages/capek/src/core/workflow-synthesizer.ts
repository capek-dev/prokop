/**
 * Compatibility forwarder (C5 workflow domain). Result synthesis moved to
 * `workflow/synthesizer.ts`; this module keeps the pre-C5 import path and
 * export identities until consumers migrate (compat barrel).
 */
export * from '../workflow/synthesizer';
