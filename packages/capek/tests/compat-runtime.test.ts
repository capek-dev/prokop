import { describe, expect, test } from 'bun:test';
import {
  InterruptManager,
  buildSchemaPromptInstruction,
  createStreamHandlers,
  jean2CompatibilityPhase,
  streamChatWithRetry,
} from '@capekai/core/compat/jean2';

describe('Jean2 compatibility runtime exports', () => {
  test('loads Phase 1 runtime only through the declared package path', () => {
    expect(jean2CompatibilityPhase).toBe(1);
    expect(typeof streamChatWithRetry).toBe('function');
    expect(typeof createStreamHandlers).toBe('function');
    expect(typeof buildSchemaPromptInstruction).toBe('function');
    expect(new InterruptManager()).toBeInstanceOf(InterruptManager);
  });
});
