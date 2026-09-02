import { beforeEach, describe, expect, mock, test } from 'bun:test';
import { definition, execute } from './tool';
import { createMockContext, VirtualFS, getAskCall, getAllAskCalls } from '../test-utils';

let vfs: VirtualFS;
let ctx: ReturnType<typeof createMockContext>;

beforeEach(() => {
  vfs = new VirtualFS();
  ctx = createMockContext(vfs, {
    ask: mock(async (request: unknown) => {
      const r = request as Record<string, unknown>;
      if (r.type === 'permission') return true;
      if (r.type === 'client_capability') {
        return {
          success: true,
          elements: [
            { tag: 'button', selector: '#btn1', text: 'Click me', type: 'button' },
            { tag: 'input', selector: '#search', text: '', type: 'text', attributes: { placeholder: 'Search...' } },
            { tag: 'a', selector: 'a.nav-link', text: 'Home', type: 'link', attributes: { href: '/' } },
          ],
        };
      }
      return true;
    }) as unknown as ReturnType<typeof createMockContext>['ask'],
  });
});

// ══════════════════════════════════════════════════════════════════
// Tool Definition
// ══════════════════════════════════════════════════════════════════

describe('browser_discover_elements tool definition', () => {
  test('has correct name', () => {
    expect(definition.name).toBe('browser_discover_elements');
  });

  test('has description mentioning interactive elements', () => {
    expect(definition.description).toContain('interactive elements');
  });

  test('accepts an optional tabId', () => {
    expect(definition.inputSchema.properties).toHaveProperty('tabId');
  });

  test('has timeout set', () => {
    expect(definition.timeout).toBe(15000);
  });
});

// ══════════════════════════════════════════════════════════════════
// Permission Ask
// ══════════════════════════════════════════════════════════════════

describe('browser_discover_elements permissions', () => {
  test('asks for permission with low risk', async () => {
    await execute({}, ctx);
    const permAsk = getAskCall(ctx);
    expect(permAsk.type).toBe('permission');
    expect(permAsk.risk).toBe('low');
    expect(permAsk.resource).toBe('browser');
    expect(permAsk.action).toBe('read');
  });

  test('permission rejection returns USER_REJECTION', async () => {
    const rejectCtx = createMockContext(vfs, {
      ask: mock(async (request: unknown) => {
        const r = request as Record<string, unknown>;
        if (r.type === 'permission') return false;
        return true;
      }) as unknown as ReturnType<typeof createMockContext>['ask'],
    });

    const result = await execute({}, rejectCtx);
    expect(result.success).toBe(false);
    expect(result.error).toBe('USER_REJECTION');
  });
});

// ══════════════════════════════════════════════════════════════════
// Successful Execution
// ══════════════════════════════════════════════════════════════════

describe('browser_discover_elements execution', () => {
  test('returns elements and count on success', async () => {
    const result = await execute({}, ctx);
    expect(result.success).toBe(true);
    const data = result.result as { elementCount: number; elements: unknown[] };
    expect(data.elementCount).toBe(3);
    expect(data.elements.length).toBe(3);
  });

  test('returns elements with correct structure', async () => {
    const result = await execute({}, ctx);
    expect(result.success).toBe(true);
    const data = result.result as { elements: Record<string, unknown>[] };
    const btn = data.elements[0];
    expect(btn.tag).toBe('button');
    expect(btn.selector).toBe('#btn1');
    expect(btn.text).toBe('Click me');
  });

  test('forwards tabId to the extension', async () => {
    await execute({ tabId: 42 }, ctx);
    const calls = getAllAskCalls(ctx);
    const metadata = calls[1].metadata as Record<string, unknown>;
    expect(metadata.params).toEqual({ tabId: 42 });
  });
});

// ══════════════════════════════════════════════════════════════════
// Error Handling
// ══════════════════════════════════════════════════════════════════

describe('browser_discover_elements error handling', () => {
  test('handles invalid extension response', async () => {
    const badCtx = createMockContext(vfs, {
      ask: mock(async (request: unknown) => {
        const r = request as Record<string, unknown>;
        if (r.type === 'permission') return true;
        return 'not an object';
      }) as unknown as ReturnType<typeof createMockContext>['ask'],
    });

    const result = await execute({}, badCtx);
    expect(result.success).toBe(false);
    expect(result.error).toContain('invalid response');
  });

  test('handles missing elements array', async () => {
    const noElemsCtx = createMockContext(vfs, {
      ask: mock(async (request: unknown) => {
        const r = request as Record<string, unknown>;
        if (r.type === 'permission') return true;
        return { success: true };
      }) as unknown as ReturnType<typeof createMockContext>['ask'],
    });

    const result = await execute({}, noElemsCtx);
    expect(result.success).toBe(false);
    expect(result.error).toContain('invalid element list');
  });

  test('handles non-array elements', async () => {
    const badArrayCtx = createMockContext(vfs, {
      ask: mock(async (request: unknown) => {
        const r = request as Record<string, unknown>;
        if (r.type === 'permission') return true;
        return { success: true, elements: 'not-an-array' };
      }) as unknown as ReturnType<typeof createMockContext>['ask'],
    });

    const result = await execute({}, badArrayCtx);
    expect(result.success).toBe(false);
    expect(result.error).toContain('invalid element list');
  });

  test('handles timeout error', async () => {
    const timeoutCtx = createMockContext(vfs, {
      ask: mock(async (request: unknown) => {
        const r = request as Record<string, unknown>;
        if (r.type === 'permission') return true;
        throw new Error('Extension timed out');
      }) as unknown as ReturnType<typeof createMockContext>['ask'],
    });

    const result = await execute({}, timeoutCtx);
    expect(result.success).toBe(false);
    expect(result.error).toContain('timed out');
  });

  test('handles generic error', async () => {
    const errorCtx = createMockContext(vfs, {
      ask: mock(async (request: unknown) => {
        const r = request as Record<string, unknown>;
        if (r.type === 'permission') return true;
        throw new Error('Discovery failed');
      }) as unknown as ReturnType<typeof createMockContext>['ask'],
    });

    const result = await execute({}, errorCtx);
    expect(result.success).toBe(false);
    expect(result.error).toContain('Element discovery failed');
    expect(result.error).toContain('Discovery failed');
  });
});
