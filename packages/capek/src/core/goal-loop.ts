/**
 * Compatibility forwarder (C5 goal domain). The persistent goal loop moved
 * to `goals/loop.ts`; this module keeps the pre-C5 import path and export
 * identities until consumers migrate (chat-handler, compat barrel).
 */
export * from '../goals/loop';
