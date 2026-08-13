import { describe, expect, test } from 'bun:test';
import {
  InterruptManager,
  buildSchemaPromptInstruction,
  executeChildSession,
  executeCompaction,
  executeWorkflow,
  handleChat,
  createStreamHandlers,
  createAskApi,
  requestPermission,
  jean2CompatibilityPhase,
  runGoalLoop,
  streamChatWithRetry,
} from '@capekai/core/compat/jean2';

describe('Jean2 compatibility runtime exports', () => {
  test('loads implemented Phase 5 runtime through the declared package path', () => {
    expect(jean2CompatibilityPhase).toBe(5);
    expect(typeof streamChatWithRetry).toBe('function');
    expect(typeof createStreamHandlers).toBe('function');
    expect(typeof buildSchemaPromptInstruction).toBe('function');
    expect(typeof executeCompaction).toBe('function');
    expect(typeof handleChat).toBe('function');
    expect(typeof executeChildSession).toBe('function');
    expect(typeof runGoalLoop).toBe('function');
    expect(typeof executeWorkflow).toBe('function');
    expect(typeof createAskApi).toBe('function');
    expect(typeof requestPermission).toBe('function');
    expect(new InterruptManager()).toBeInstanceOf(InterruptManager);
  });
});
