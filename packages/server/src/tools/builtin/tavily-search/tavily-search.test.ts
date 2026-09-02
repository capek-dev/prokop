import { beforeEach, describe, expect, test } from 'bun:test';
import { createMockContext, VirtualFS } from '../test-utils';
import { definition, execute } from './tool';

let ctx: ReturnType<typeof createMockContext>;

beforeEach(() => {
  ctx = createMockContext(new VirtualFS());
});

describe('tavily-search tool definition', () => {
  test('declares the Tavily API key and search settings', () => {
    expect(definition.name).toBe('tavily-search');
    expect(definition.timeout).toBe(60000);
    expect(definition.env).toContain('TAVILY_API_KEY');
    expect(definition.env).toContain('TAVILY_SEARCH_DEPTH');
    expect(definition.env).toContain('TAVILY_MAX_RESULTS');
  });

  test('requires a query', () => {
    const schema = definition.inputSchema as { required: string[] };
    expect(schema.required).toContain('query');
  });
});

describe('tavily-search validation', () => {
  test('rejects an empty query before reading credentials', async () => {
    const result = await execute({ query: '   ' }, ctx);

    expect(result).toEqual({ success: false, error: 'Query is required' });
  });

  test('requires users to configure TAVILY_API_KEY', async () => {
    const result = await execute({ query: 'current Bun release' }, ctx);

    expect(result).toEqual({ success: false, error: 'Not set' });
    expect(ctx.logger.error).toHaveBeenCalledWith('tavily-search failed: Not set');
  });
});
