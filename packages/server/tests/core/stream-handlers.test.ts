import { describe, test, expect, beforeEach, afterEach } from 'bun:test';

import { setupTestDatabase, resetTestDatabase } from '#tests/db';
import { seedWorkspaceWithSession } from '#tests/seed';
import { createMessage } from '@/store/messages';
import { createStreamHandlers, type StreamHandlerContext } from '@capekai/core/internal/execution';

describe('stream-handlers', () => {
  let sessionId: string;
  let messageId: string;

  beforeEach(() => {
    setupTestDatabase();
    const { sessionId: sid } = seedWorkspaceWithSession();
    sessionId = sid;
    messageId = 'msg-1';
    createMessage({
      id: messageId,
      sessionId,
      role: 'assistant',
      createdAt: Date.now(),
      status: 'streaming',
      modelId: 'gpt-4o',
      providerId: 'openai',
      tokens: { prompt: 0, completion: 0 },
      cost: 0,
    });
  });

  afterEach(() => {
    resetTestDatabase();
  });

  function createContext(overrides: Partial<StreamHandlerContext> = {}): StreamHandlerContext {
    return {
      messageId,
      sessionId,
      toolParts: [],
      currentText: '',
      currentTextPartId: null,
      currentTextCreatedAt: null,
      currentReasoning: '',
      currentReasoningPartId: null,
      currentReasoningCreatedAt: null,
      yieldFn: () => {},
      ...overrides,
    };
  }

  // ── handleTextDelta ──────────────────────────────────────────

  describe('handleTextDelta', () => {
    test('creates new text part on first delta', () => {
      const ctx = createContext();
      const handlers = createStreamHandlers(ctx);

      handlers.handleTextDelta({ text: 'Hello' });

      expect(ctx.currentText).toBe('Hello');
      expect(ctx.currentTextPartId).not.toBeNull();
    });

    test('appends to existing text part on subsequent deltas', () => {
      const ctx = createContext();
      const handlers = createStreamHandlers(ctx);

      handlers.handleTextDelta({ text: 'Hello' });
      handlers.handleTextDelta({ text: ' world' });

      expect(ctx.currentText).toBe('Hello world');
      expect(ctx.currentTextPartId).not.toBeNull();
    });

    test('ignores empty string delta', () => {
      const ctx = createContext();
      const handlers = createStreamHandlers(ctx);

      handlers.handleTextDelta({ text: '' });

      expect(ctx.currentText).toBe('');
      expect(ctx.currentTextPartId).toBeNull();
    });

    test('ignores undefined text delta', () => {
      const ctx = createContext();
      const handlers = createStreamHandlers(ctx);

      handlers.handleTextDelta({ text: undefined });

      expect(ctx.currentText).toBe('');
      expect(ctx.currentTextPartId).toBeNull();
    });

    test('accumulates text across multiple deltas', () => {
      const ctx = createContext();
      const handlers = createStreamHandlers(ctx);

      handlers.handleTextDelta({ text: 'a' });
      handlers.handleTextDelta({ text: 'b' });
      handlers.handleTextDelta({ text: 'c' });

      expect(ctx.currentText).toBe('abc');
    });
  });

  // ── handleReasoningDelta ─────────────────────────────────────

  describe('handleReasoningDelta', () => {
    test('creates new reasoning part on first delta', () => {
      const ctx = createContext();
      const handlers = createStreamHandlers(ctx);

      handlers.handleReasoningDelta({ text: 'Thinking...' });

      expect(ctx.currentReasoning).toBe('Thinking...');
      expect(ctx.currentReasoningPartId).not.toBeNull();
    });

    test('appends to existing reasoning part on subsequent deltas', () => {
      const ctx = createContext();
      const handlers = createStreamHandlers(ctx);

      handlers.handleReasoningDelta({ text: 'Step 1' });
      handlers.handleReasoningDelta({ text: ' Step 2' });

      expect(ctx.currentReasoning).toBe('Step 1 Step 2');
    });

    test('ignores empty string delta', () => {
      const ctx = createContext();
      const handlers = createStreamHandlers(ctx);

      handlers.handleReasoningDelta({ text: '' });

      expect(ctx.currentReasoning).toBe('');
      expect(ctx.currentReasoningPartId).toBeNull();
    });

    test('ignores undefined text delta', () => {
      const ctx = createContext();
      const handlers = createStreamHandlers(ctx);

      handlers.handleReasoningDelta({ text: undefined });

      expect(ctx.currentReasoning).toBe('');
      expect(ctx.currentReasoningPartId).toBeNull();
    });

    test('accumulates reasoning across multiple deltas', () => {
      const ctx = createContext();
      const handlers = createStreamHandlers(ctx);

      handlers.handleReasoningDelta({ text: 'a' });
      handlers.handleReasoningDelta({ text: 'b' });
      handlers.handleReasoningDelta({ text: 'c' });

      expect(ctx.currentReasoning).toBe('abc');
    });
  });

  // ── handleToolCall ───────────────────────────────────────────

  describe('handleToolCall', () => {
    test('creates tool part with pending state', () => {
      const ctx = createContext();
      const handlers = createStreamHandlers(ctx);

      handlers.handleToolCall({
        toolCallId: 'call-1',
        toolName: 'read-file',
        input: { path: '/test.txt' },
      });

      expect(ctx.toolParts).toHaveLength(1);
      const toolPart = ctx.toolParts[0];
      expect(toolPart.type).toBe('tool');
      expect(toolPart.callId).toBe('call-1');
      expect(toolPart.name).toBe('read-file');
      expect(toolPart.state.status).toBe('pending');
    });

    test('resets text state after tool call', () => {
      const ctx = createContext();
      const handlers = createStreamHandlers(ctx);

      handlers.handleTextDelta({ text: 'Some text' });
      expect(ctx.currentText).toBe('Some text');
      expect(ctx.currentTextPartId).not.toBeNull();

      handlers.handleToolCall({
        toolCallId: 'call-1',
        toolName: 'read-file',
        input: {},
      });

      expect(ctx.currentText).toBe('');
      expect(ctx.currentTextPartId).toBeNull();
    });

    test('resets reasoning state after tool call', () => {
      const ctx = createContext();
      const handlers = createStreamHandlers(ctx);

      handlers.handleReasoningDelta({ text: 'Thinking' });
      expect(ctx.currentReasoning).toBe('Thinking');
      expect(ctx.currentReasoningPartId).not.toBeNull();

      handlers.handleToolCall({
        toolCallId: 'call-1',
        toolName: 'read-file',
        input: {},
      });

      expect(ctx.currentReasoning).toBe('');
      expect(ctx.currentReasoningPartId).toBeNull();
    });

    test('parses string input as JSON', () => {
      const ctx = createContext();
      const handlers = createStreamHandlers(ctx);

      handlers.handleToolCall({
        toolCallId: 'call-1',
        toolName: 'edit',
        input: '{"path":"/foo","old":"a","new":"b"}',
      });

      expect(ctx.toolParts[0].state.input).toEqual({ path: '/foo', old: 'a', new: 'b' });
    });

    test('handles null input gracefully', () => {
      const ctx = createContext();
      const handlers = createStreamHandlers(ctx);

      handlers.handleToolCall({
        toolCallId: 'call-1',
        toolName: 'test-tool',
        input: null,
      });

      expect(ctx.toolParts[0].state.input).toEqual({});
    });

    test('supports multiple tool calls', () => {
      const ctx = createContext();
      const handlers = createStreamHandlers(ctx);

      handlers.handleToolCall({ toolCallId: 'call-1', toolName: 'tool-a', input: {} });
      handlers.handleToolCall({ toolCallId: 'call-2', toolName: 'tool-b', input: {} });

      expect(ctx.toolParts).toHaveLength(2);
      expect(ctx.toolParts[0].callId).toBe('call-1');
      expect(ctx.toolParts[1].callId).toBe('call-2');
    });
  });

  // ── handleToolResult ─────────────────────────────────────────

  describe('handleToolResult', () => {
    test('updates existing tool part to completed status', () => {
      const ctx = createContext();
      const handlers = createStreamHandlers(ctx);

      handlers.handleToolCall({ toolCallId: 'call-1', toolName: 'read-file', input: {} });
      handlers.handleToolResult({ toolCallId: 'call-1', output: 'file contents' });

      expect(ctx.toolParts[0].state.status).toBe('completed');
      expect((ctx.toolParts[0].state as { output: unknown }).output).toBe('file contents');
    });

    test('parses JSON string output', () => {
      const ctx = createContext();
      const handlers = createStreamHandlers(ctx);

      handlers.handleToolCall({ toolCallId: 'call-1', toolName: 'test', input: {} });
      handlers.handleToolResult({ toolCallId: 'call-1', output: '{"key":"value"}' });

      const state = ctx.toolParts[0].state as { output: unknown };
      expect(state.output).toEqual({ key: 'value' });
    });

    test('keeps non-JSON string output as-is', () => {
      const ctx = createContext();
      const handlers = createStreamHandlers(ctx);

      handlers.handleToolCall({ toolCallId: 'call-1', toolName: 'test', input: {} });
      handlers.handleToolResult({ toolCallId: 'call-1', output: 'plain text result' });

      const state = ctx.toolParts[0].state as { output: unknown };
      expect(state.output).toBe('plain text result');
    });

    test('extracts value from object with value property', () => {
      const ctx = createContext();
      const handlers = createStreamHandlers(ctx);

      handlers.handleToolCall({ toolCallId: 'call-1', toolName: 'test', input: {} });
      handlers.handleToolResult({ toolCallId: 'call-1', output: { value: 'extracted' } });

      const state = ctx.toolParts[0].state as { output: unknown };
      expect(state.output).toBe('extracted');
    });

    test('detects error result and sets error status', () => {
      const ctx = createContext();
      const handlers = createStreamHandlers(ctx);

      handlers.handleToolCall({ toolCallId: 'call-1', toolName: 'test', input: {} });
      handlers.handleToolResult({ toolCallId: 'call-1', output: { error: 'Something went wrong' } });

      const state = ctx.toolParts[0].state as { status: string; error: string };
      expect(state.status).toBe('error');
      expect(state.error).toBe('Something went wrong');
    });

    test('preserves input when completing tool', () => {
      const ctx = createContext();
      const handlers = createStreamHandlers(ctx);

      handlers.handleToolCall({ toolCallId: 'call-1', toolName: 'edit', input: { path: '/foo' } });
      handlers.handleToolResult({ toolCallId: 'call-1', output: 'done' });

      const state = ctx.toolParts[0].state as { input: unknown };
      expect(state.input).toEqual({ path: '/foo' });
    });

    test('ignores result for unknown tool call id', () => {
      const ctx = createContext();
      const handlers = createStreamHandlers(ctx);

      handlers.handleToolCall({ toolCallId: 'call-1', toolName: 'test', input: {} });
      handlers.handleToolResult({ toolCallId: 'nonexistent', output: 'orphan result' });

      expect(ctx.toolParts).toHaveLength(1);
      expect(ctx.toolParts[0].state.status).toBe('pending');
    });

    test('handles tool result with direct object output (no value property)', () => {
      const ctx = createContext();
      const handlers = createStreamHandlers(ctx);

      handlers.handleToolCall({ toolCallId: 'call-1', toolName: 'test', input: {} });
      handlers.handleToolResult({ toolCallId: 'call-1', output: { files: ['a.ts', 'b.ts'] } });

      const state = ctx.toolParts[0].state as { output: unknown };
      expect(state.output).toEqual({ files: ['a.ts', 'b.ts'] });
    });
  });

  // ── Full flow ────────────────────────────────────────────────

  describe('full streaming flow', () => {
    test('text -> tool call -> text creates two text parts', () => {
      const ctx = createContext();
      const handlers = createStreamHandlers(ctx);

      handlers.handleTextDelta({ text: 'Before tool' });
      const firstTextPartId = ctx.currentTextPartId;

      handlers.handleToolCall({ toolCallId: 'call-1', toolName: 'test', input: {} });
      handlers.handleToolResult({ toolCallId: 'call-1', output: 'ok' });

      handlers.handleTextDelta({ text: 'After tool' });
      const secondTextPartId = ctx.currentTextPartId;

      expect(firstTextPartId).not.toBeNull();
      expect(secondTextPartId).not.toBeNull();
      expect(firstTextPartId).not.toBe(secondTextPartId);
      expect(ctx.currentText).toBe('After tool');
    });

    test('reasoning -> text -> tool call flow', () => {
      const ctx = createContext();
      const handlers = createStreamHandlers(ctx);

      handlers.handleReasoningDelta({ text: 'Let me think...' });
      handlers.handleTextDelta({ text: 'I will read a file.' });
      handlers.handleToolCall({ toolCallId: 'call-1', toolName: 'read-file', input: { path: '/test' } });

      expect(ctx.currentText).toBe('');
      expect(ctx.currentReasoning).toBe('');
      expect(ctx.toolParts).toHaveLength(1);
    });
  });
});
