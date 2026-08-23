import type { ToolDefinition, ToolContext, ToolResult } from '@capekai/tool';

export const definition: ToolDefinition = {
  name: 'llm-test',
  description:
    'Tests ctx.llm.generateStructured() end-to-end using MiniMax.\n' +
    'Sends a simple structured request and returns the raw result for inspection.\n' +
    'No input needed — just call it.',
  inputSchema: {
    type: 'object',
    properties: {},
    required: [],
  },
  timeout: 30000,
};

export async function execute(_input: Record<string, unknown>, ctx: ToolContext): Promise<ToolResult> {
  const schema = {
    type: 'object',
    properties: {
      answer: { type: 'string' },
    },
    required: ['answer'],
  } as const;

  const start = Date.now();

  try {
    const result = await ctx.llm.generateStructured<{ answer: string }>({
      prompt: 'What is 2 + 2? Respond with the numeric answer.',
      schema,
      model: 'MiniMax-M2.7',
      provider: 'minimax',
    });

    return {
      success: true,
      result: {
        durationMs: Date.now() - start,
        output: result,
        keys: result && typeof result === 'object' ? Object.keys(result) : null,
      },
    };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return {
      success: false,
      result: {
        durationMs: Date.now() - start,
        error: message,
        stack: err instanceof Error ? err.stack?.split('\n').slice(0, 5).join('\n') : undefined,
      },
      error: message,
    };
  }
}
