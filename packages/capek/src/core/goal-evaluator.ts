/**
 * Compatibility forwarder (C5 goal domain). The goal evaluator model turn
 * moved to `goals/evaluator.ts`; this module keeps the pre-C5 import path
 * and export identities until consumers migrate (compat barrel, goal loop
 * forwarder, phase2 tests).
 */
export * from '../goals/evaluator';
