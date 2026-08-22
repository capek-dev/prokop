import { describe, test, expect, mock } from 'bun:test';
import { definition, execute } from './tool';
import { createMockContext, VirtualFS } from '../test-utils';

let vfs: VirtualFS;
let ctx: ReturnType<typeof createMockContext>;

// Helper to create a context with a specific ask response
function createContextWithAsk(askFn: typeof ctx.ask) {
  vfs = new VirtualFS();
  ctx = createMockContext(vfs, { ask: askFn });
  return ctx;
}

// ══════════════════════════════════════════════════════════════════
// Tool Definition
// ══════════════════════════════════════════════════════════════════

describe('question tool definition', () => {
  test('has correct name', () => {
    expect(definition.name).toBe('question');
  });

  test('has required title and questions', () => {
    const schema = definition.inputSchema as { properties: Record<string, unknown>; required: string[] };
    expect(schema.required).toContain('title');
    expect(schema.required).toContain('questions');
  });

  test('has 5 minute timeout', () => {
    expect(definition.timeout).toBe(300000);
  });
});

// ══════════════════════════════════════════════════════════════════
// Input Validation
// ══════════════════════════════════════════════════════════════════

describe('question: validation', () => {
  test('rejects empty questions array', async () => {
    const testCtx = createContextWithAsk(mock(async () => true) as unknown as typeof ctx.ask);
    const result = await execute({
      title: 'Test',
      questions: [],
    }, testCtx);
    expect(result.success).toBe(false);
    expect(result.error).toContain('At least one question');
  });

  test('rejects empty title', async () => {
    const testCtx = createContextWithAsk(mock(async () => true) as unknown as typeof ctx.ask);
    const result = await execute({
      title: '',
      questions: [{ type: 'text', question: 'Name?' }],
    }, testCtx);
    expect(result.success).toBe(false);
    expect(result.error).toContain('Title is required');
  });
});

// ══════════════════════════════════════════════════════════════════
// Question Types
// ══════════════════════════════════════════════════════════════════

describe('question: question types', () => {
  test('sends form ask with questions', async () => {
    const mockAsk = mock(async (_req: unknown) => ({
      type: 'form',
      answers: [{ question: 'Name?', answer: 'John' }],
    })) as unknown as typeof ctx.ask;
    const testCtx = createContextWithAsk(mockAsk);

    const result = await execute({
      title: 'User Info',
      questions: [{ type: 'text', question: 'Name?' }],
    }, testCtx);

    expect(result.success).toBe(true);
    expect(mockAsk).toHaveBeenCalled();
    const askArg = (mockAsk as ReturnType<typeof mock>).mock.calls[0][0] as { target: string; type: string; questions: unknown[] };
    expect(askArg.target).toBe('human');
    expect(askArg.type).toBe('form');
    expect(askArg.questions.length).toBe(1);
  });

  test('returns structured answers', async () => {
    const mockAsk = mock(async () => ({
      type: 'form',
      answers: [
        { question: 'Name?', answer: 'John' },
        { question: 'Age?', answer: '30' },
      ],
    })) as unknown as typeof ctx.ask;
    const testCtx = createContextWithAsk(mockAsk);

    const result = await execute({
      title: 'Survey',
      questions: [
        { type: 'text', question: 'Name?' },
        { type: 'text', question: 'Age?' },
      ],
    }, testCtx);

    expect(result.success).toBe(true);
    const res = result.result as { answers: Array<{ question: string; type: string; answer: unknown }> };
    expect(res.answers.length).toBe(2);
    expect(res.answers[0].answer).toBe('John');
    expect(res.answers[1].answer).toBe('30');
  });

  test('handles ask error gracefully', async () => {
    const mockAsk = mock(async () => {
      throw new Error('User cancelled');
    }) as unknown as typeof ctx.ask;
    const testCtx = createContextWithAsk(mockAsk);

    const result = await execute({
      title: 'Test',
      questions: [{ type: 'text', question: 'Name?' }],
    }, testCtx);

    expect(result.success).toBe(false);
    expect(result.error).toContain('User cancelled');
  });
});
