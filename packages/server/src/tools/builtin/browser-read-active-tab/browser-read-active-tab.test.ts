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
        return { title: 'Test Page', url: 'https://example.com', text: 'Hello world' };
      }
      return true;
    }) as unknown as ReturnType<typeof createMockContext>['ask'],
  });
});

// ══════════════════════════════════════════════════════════════════
// Tool Definition
// ══════════════════════════════════════════════════════════════════

describe('browser_read_active_tab tool definition', () => {
  test('has correct name', () => {
    expect(definition.name).toBe('browser_read_active_tab');
  });

  test('has description mentioning browser tab reading', () => {
    expect(definition.description).toContain('active');
    expect(definition.description).toContain('browser tab');
  });

  test('accepts an optional tabId', () => {
    expect(definition.inputSchema.properties).toHaveProperty('tabId');
  });

  test('has timeout set', () => {
    expect(definition.timeout).toBe(120000);
  });
});

// ══════════════════════════════════════════════════════════════════
// Permission Ask
// ══════════════════════════════════════════════════════════════════

describe('browser_read_active_tab permissions', () => {
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

  test('permission ask has allowedScopes once and session', async () => {
    await execute({}, ctx);
    const permAsk = getAskCall(ctx);
    expect(permAsk.allowedScopes).toEqual(['once', 'session']);
  });
});

// ══════════════════════════════════════════════════════════════════
// Successful Execution
// ══════════════════════════════════════════════════════════════════

describe('browser_read_active_tab execution', () => {
  test('returns title, url, and text on success', async () => {
    const result = await execute({}, ctx);
    expect(result.success).toBe(true);
    const data = result.result as { title: string; url: string; text: string };
    expect(data.title).toBe('Test Page');
    expect(data.url).toBe('https://example.com');
    expect(data.text).toBe('Hello world');
  });

  test('sends client_capability ask after permission approval', async () => {
    await execute({}, ctx);
    const calls = getAllAskCalls(ctx);
    expect(calls.length).toBe(2);
    expect((calls[0] as unknown as Record<string, unknown>).type).toBe('permission');
    expect((calls[1] as unknown as Record<string, unknown>).type).toBe('client_capability');
  });

  test('forwards tabId to the extension', async () => {
    await execute({ tabId: 42 }, ctx);
    const calls = getAllAskCalls(ctx);
    const metadata = calls[1].metadata as Record<string, unknown>;
    expect(metadata.params).toEqual({ tabId: 42 });
  });

  test('returns error for invalid extension response', async () => {
    const badCtx = createMockContext(vfs, {
      ask: mock(async (request: unknown) => {
        const r = request as Record<string, unknown>;
        if (r.type === 'permission') return true;
        return null;
      }) as unknown as ReturnType<typeof createMockContext>['ask'],
    });

    const result = await execute({}, badCtx);
    expect(result.success).toBe(false);
    expect(result.error).toContain('invalid response');
  });

  test('returns error for empty extension response', async () => {
    const emptyCtx = createMockContext(vfs, {
      ask: mock(async (request: unknown) => {
        const r = request as Record<string, unknown>;
        if (r.type === 'permission') return true;
        return { title: '', url: '', text: '' };
      }) as unknown as ReturnType<typeof createMockContext>['ask'],
    });

    const result = await execute({}, emptyCtx);
    expect(result.success).toBe(false);
    expect(result.error).toContain('empty result');
  });
});

// ══════════════════════════════════════════════════════════════════
// Error Handling
// ══════════════════════════════════════════════════════════════════

describe('browser_read_active_tab error handling', () => {
  test('handles timeout error from extension', async () => {
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

  test('handles generic error from extension', async () => {
    const errorCtx = createMockContext(vfs, {
      ask: mock(async (request: unknown) => {
        const r = request as Record<string, unknown>;
        if (r.type === 'permission') return true;
        throw new Error('Connection lost');
      }) as unknown as ReturnType<typeof createMockContext>['ask'],
    });

    const result = await execute({}, errorCtx);
    expect(result.success).toBe(false);
    expect(result.error).toContain('Browser read failed');
    expect(result.error).toContain('Connection lost');
  });
});
