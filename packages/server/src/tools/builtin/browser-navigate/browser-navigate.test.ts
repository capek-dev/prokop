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
        return { success: true, url: 'https://example.com/page', title: 'Example Page' };
      }
      return true;
    }) as unknown as ReturnType<typeof createMockContext>['ask'],
  });
});

// ══════════════════════════════════════════════════════════════════
// Tool Definition
// ══════════════════════════════════════════════════════════════════

describe('browser_navigate tool definition', () => {
  test('has correct name', () => {
    expect(definition.name).toBe('browser_navigate');
  });

  test('has url as required property', () => {
    expect(definition.inputSchema.required).toContain('url');
  });

  test('has timeout set', () => {
    expect(definition.timeout).toBe(30000);
  });
});

// ══════════════════════════════════════════════════════════════════
// Input Validation
// ══════════════════════════════════════════════════════════════════

describe('browser_navigate input validation', () => {
  test('missing url returns error', async () => {
    const result = await execute({}, ctx);
    expect(result.success).toBe(false);
    expect(result.error).toContain('Missing required parameter: url');
  });

  test('empty string url returns error', async () => {
    const result = await execute({ url: '' }, ctx);
    expect(result.success).toBe(false);
    expect(result.error).toContain('Missing required parameter: url');
  });

  test('non-http URL returns error', async () => {
    const result = await execute({ url: 'ftp://example.com' }, ctx);
    expect(result.success).toBe(false);
    expect(result.error).toContain('http:// or https://');
  });

  test('relative URL returns error', async () => {
    const result = await execute({ url: '/path/to/page' }, ctx);
    expect(result.success).toBe(false);
    expect(result.error).toContain('http:// or https://');
  });

  test('javascript: URL returns error', async () => {
    const result = await execute({ url: 'javascript:alert(1)' }, ctx);
    expect(result.success).toBe(false);
    expect(result.error).toContain('http:// or https://');
  });
});

// ══════════════════════════════════════════════════════════════════
// Permission Ask
// ══════════════════════════════════════════════════════════════════

describe('browser_navigate permissions', () => {
  test('asks for permission with medium risk', async () => {
    await execute({ url: 'https://example.com' }, ctx);
    const permAsk = getAskCall(ctx);
    expect(permAsk.type).toBe('permission');
    expect(permAsk.risk).toBe('medium');
    expect(permAsk.resource).toBe('browser');
    expect(permAsk.action).toBe('navigate');
  });

  test('permission question includes the URL', async () => {
    await execute({ url: 'https://ebay.com/item/123' }, ctx);
    const permAsk = getAskCall(ctx);
    expect(permAsk.question).toContain('https://ebay.com/item/123');
  });

  test('permission scope includes URL', async () => {
    await execute({ url: 'https://example.com' }, ctx);
    const permAsk = getAskCall(ctx);
    expect(permAsk.scope).toEqual({
      type: 'custom',
      value: 'https://example.com',
      label: 'https://example.com',
    });
  });

  test('permission rejection returns USER_REJECTION', async () => {
    const rejectCtx = createMockContext(vfs, {
      ask: mock(async (request: unknown) => {
        const r = request as Record<string, unknown>;
        if (r.type === 'permission') return false;
        return true;
      }) as unknown as ReturnType<typeof createMockContext>['ask'],
    });

    const result = await execute({ url: 'https://example.com' }, rejectCtx);
    expect(result.success).toBe(false);
    expect(result.error).toBe('USER_REJECTION');
  });

  test('permission rejection does not send client_capability', async () => {
    const rejectCtx = createMockContext(vfs, {
      ask: mock(async (request: unknown) => {
        const r = request as Record<string, unknown>;
        if (r.type === 'permission') return false;
        return true;
      }) as unknown as ReturnType<typeof createMockContext>['ask'],
    });

    await execute({ url: 'https://example.com' }, rejectCtx);
    const calls = getAllAskCalls(rejectCtx);
    expect(calls.length).toBe(1);
    expect(calls[0].type).toBe('permission');
  });
});

// ══════════════════════════════════════════════════════════════════
// Successful Execution
// ══════════════════════════════════════════════════════════════════

describe('browser_navigate execution', () => {
  test('returns url and title on success', async () => {
    const result = await execute({ url: 'https://example.com' }, ctx);
    expect(result.success).toBe(true);
    const data = result.result as { url: string; title: string };
    expect(data.url).toBe('https://example.com/page');
    expect(data.title).toBe('Example Page');
  });

  test('sends client_capability with correct metadata', async () => {
    await execute({ url: 'https://example.com', tabId: 42, waitForLoad: false, timeout: 5000 }, ctx);
    const calls = getAllAskCalls(ctx);
    const capCall = calls[1] as unknown as Record<string, unknown>;
    expect(capCall.capability).toBe('browser_navigate');
    const metadata = capCall.metadata as Record<string, unknown>;
    const params = metadata.params as Record<string, unknown>;
    expect(params.tabId).toBe(42);
    expect(params.url).toBe('https://example.com');
    expect(params.waitForLoad).toBe(false);
    expect(params.timeout).toBe(5000);
  });

  test('defaults waitForLoad to true and timeout to 10000', async () => {
    await execute({ url: 'https://example.com' }, ctx);
    const calls = getAllAskCalls(ctx);
    const capCall = calls[1] as unknown as Record<string, unknown>;
    const metadata = capCall.metadata as Record<string, unknown>;
    const params = metadata.params as Record<string, unknown>;
    expect(params.waitForLoad).toBe(true);
    expect(params.timeout).toBe(10000);
  });

  test('falls back to input url when extension does not return url', async () => {
    const fallbackCtx = createMockContext(vfs, {
      ask: mock(async (request: unknown) => {
        const r = request as Record<string, unknown>;
        if (r.type === 'permission') return true;
        return { success: true, title: 'Page' };
      }) as unknown as ReturnType<typeof createMockContext>['ask'],
    });

    const result = await execute({ url: 'https://example.com' }, fallbackCtx);
    expect(result.success).toBe(true);
    const data = result.result as { url: string; title: string };
    expect(data.url).toBe('https://example.com');
  });
});

// ══════════════════════════════════════════════════════════════════
// Error Handling
// ══════════════════════════════════════════════════════════════════

describe('browser_navigate error handling', () => {
  test('handles extension returning failure', async () => {
    const failCtx = createMockContext(vfs, {
      ask: mock(async (request: unknown) => {
        const r = request as Record<string, unknown>;
        if (r.type === 'permission') return true;
        return { success: false, error: 'Page load failed' };
      }) as unknown as ReturnType<typeof createMockContext>['ask'],
    });

    const result = await execute({ url: 'https://example.com' }, failCtx);
    expect(result.success).toBe(false);
    expect(result.error).toContain('Navigation failed');
    expect(result.error).toContain('Page load failed');
  });

  test('handles invalid extension response', async () => {
    const badCtx = createMockContext(vfs, {
      ask: mock(async (request: unknown) => {
        const r = request as Record<string, unknown>;
        if (r.type === 'permission') return true;
        return 42;
      }) as unknown as ReturnType<typeof createMockContext>['ask'],
    });

    const result = await execute({ url: 'https://example.com' }, badCtx);
    expect(result.success).toBe(false);
    expect(result.error).toContain('invalid response');
  });

  test('handles timeout error', async () => {
    const timeoutCtx = createMockContext(vfs, {
      ask: mock(async (request: unknown) => {
        const r = request as Record<string, unknown>;
        if (r.type === 'permission') return true;
        throw new Error('Extension timed out');
      }) as unknown as ReturnType<typeof createMockContext>['ask'],
    });

    const result = await execute({ url: 'https://example.com' }, timeoutCtx);
    expect(result.success).toBe(false);
    expect(result.error).toContain('timed out');
  });

  test('handles generic error', async () => {
    const errorCtx = createMockContext(vfs, {
      ask: mock(async (request: unknown) => {
        const r = request as Record<string, unknown>;
        if (r.type === 'permission') return true;
        throw new Error('Network failure');
      }) as unknown as ReturnType<typeof createMockContext>['ask'],
    });

    const result = await execute({ url: 'https://example.com' }, errorCtx);
    expect(result.success).toBe(false);
    expect(result.error).toContain('Navigation failed');
    expect(result.error).toContain('Network failure');
  });
});
