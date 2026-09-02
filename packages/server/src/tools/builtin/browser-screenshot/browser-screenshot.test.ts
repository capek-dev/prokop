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
        return { success: true, dataUrl: 'data:image/png;base64,iVBOR...' };
      }
      return true;
    }) as unknown as ReturnType<typeof createMockContext>['ask'],
  });
});

// ══════════════════════════════════════════════════════════════════
// Tool Definition
// ══════════════════════════════════════════════════════════════════

describe('browser_screenshot tool definition', () => {
  test('has correct name', () => {
    expect(definition.name).toBe('browser_screenshot');
  });

  test('has description mentioning screenshot', () => {
    expect(definition.description).toContain('screenshot');
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

describe('browser_screenshot permissions', () => {
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

describe('browser_screenshot execution', () => {
  test('returns dataUrl on success', async () => {
    const result = await execute({}, ctx);
    expect(result.success).toBe(true);
    const data = result.result as { dataUrl: string };
    expect(data.dataUrl).toBe('data:image/png;base64,iVBOR...');
  });

  test('falls back to empty dataUrl when not provided', async () => {
    const fallbackCtx = createMockContext(vfs, {
      ask: mock(async (request: unknown) => {
        const r = request as Record<string, unknown>;
        if (r.type === 'permission') return true;
        return { success: true };
      }) as unknown as ReturnType<typeof createMockContext>['ask'],
    });

    const result = await execute({}, fallbackCtx);
    expect(result.success).toBe(true);
    const data = result.result as { dataUrl: string };
    expect(data.dataUrl).toBe('');
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

describe('browser_screenshot error handling', () => {
  test('handles extension returning failure', async () => {
    const failCtx = createMockContext(vfs, {
      ask: mock(async (request: unknown) => {
        const r = request as Record<string, unknown>;
        if (r.type === 'permission') return true;
        return { success: false, error: 'Tab not accessible' };
      }) as unknown as ReturnType<typeof createMockContext>['ask'],
    });

    const result = await execute({}, failCtx);
    expect(result.success).toBe(false);
    expect(result.error).toContain('Screenshot failed');
    expect(result.error).toContain('Tab not accessible');
  });

  test('handles invalid extension response', async () => {
    const badCtx = createMockContext(vfs, {
      ask: mock(async (request: unknown) => {
        const r = request as Record<string, unknown>;
        if (r.type === 'permission') return true;
        return undefined;
      }) as unknown as ReturnType<typeof createMockContext>['ask'],
    });

    const result = await execute({}, badCtx);
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

    const result = await execute({}, timeoutCtx);
    expect(result.success).toBe(false);
    expect(result.error).toContain('timed out');
  });

  test('handles generic error', async () => {
    const errorCtx = createMockContext(vfs, {
      ask: mock(async (request: unknown) => {
        const r = request as Record<string, unknown>;
        if (r.type === 'permission') return true;
        throw new Error('Capture failed');
      }) as unknown as ReturnType<typeof createMockContext>['ask'],
    });

    const result = await execute({}, errorCtx);
    expect(result.success).toBe(false);
    expect(result.error).toContain('Screenshot failed');
    expect(result.error).toContain('Capture failed');
  });
});
