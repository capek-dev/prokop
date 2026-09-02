import { beforeEach, describe, expect, mock, test } from 'bun:test';
import { definition, execute } from './tool';
import { createMockContext, VirtualFS, getAskCall } from '../test-utils';

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
          tabs: [
            { id: 1, index: 0, url: 'https://example.com', title: 'Example', active: true },
            { id: 2, index: 1, url: 'https://google.com', title: 'Google', active: false },
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

describe('browser_tab_manage tool definition', () => {
  test('has correct name', () => {
    expect(definition.name).toBe('browser_tab_manage');
  });

  test('has action as required property', () => {
    expect(definition.inputSchema.required).toContain('action');
  });

  test('supports list, create, close, switch actions', () => {
    const properties = definition.inputSchema.properties as Record<string, { enum: string[] }> | undefined;
    const actionProp = properties!.action;
    expect(actionProp.enum).toEqual(['list', 'create', 'close', 'switch']);
  });

  test('has timeout set', () => {
    expect(definition.timeout).toBe(15000);
  });
});

// ══════════════════════════════════════════════════════════════════
// Input Validation
// ══════════════════════════════════════════════════════════════════

describe('browser_tab_manage input validation', () => {
  test('missing action returns error', async () => {
    const result = await execute({}, ctx);
    expect(result.success).toBe(false);
    expect(result.error).toContain('Missing required parameter: action');
  });

  test('null action returns error', async () => {
    const result = await execute({ action: null }, ctx);
    expect(result.success).toBe(false);
    expect(result.error).toContain('Missing required parameter: action');
  });
});

// ══════════════════════════════════════════════════════════════════
// Permission Ask: Conditional Risk by Action
// ══════════════════════════════════════════════════════════════════

describe('browser_tab_manage permissions', () => {
  test('list action asks for low risk (read)', async () => {
    await execute({ action: 'list' }, ctx);
    const permAsk = getAskCall(ctx);
    expect(permAsk.risk).toBe('low');
    expect(permAsk.action).toBe('read');
  });

  test('create action asks for medium risk (write)', async () => {
    await execute({ action: 'create' }, ctx);
    const permAsk = getAskCall(ctx);
    expect(permAsk.risk).toBe('medium');
    expect(permAsk.action).toBe('write');
  });

  test('close action asks for medium risk (write)', async () => {
    await execute({ action: 'close', tabId: 1 }, ctx);
    const permAsk = getAskCall(ctx);
    expect(permAsk.risk).toBe('medium');
    expect(permAsk.action).toBe('write');
  });

  test('switch action asks for medium risk (write)', async () => {
    await execute({ action: 'switch', tabId: 2 }, ctx);
    const permAsk = getAskCall(ctx);
    expect(permAsk.risk).toBe('medium');
    expect(permAsk.action).toBe('write');
  });

  test('list action question says "List browser tabs"', async () => {
    await execute({ action: 'list' }, ctx);
    const permAsk = getAskCall(ctx);
    expect(permAsk.question).toContain('List browser tabs');
  });

  test('create action question includes URL when provided', async () => {
    await execute({ action: 'create', url: 'https://example.com' }, ctx);
    const permAsk = getAskCall(ctx);
    expect(permAsk.question).toContain('Open new tab');
    expect(permAsk.question).toContain('https://example.com');
  });

  test('close action question includes tabId', async () => {
    await execute({ action: 'close', tabId: 42 }, ctx);
    const permAsk = getAskCall(ctx);
    expect(permAsk.question).toContain('Close tab');
    expect(permAsk.question).toContain('42');
  });

  test('switch action question includes tabId', async () => {
    await execute({ action: 'switch', tabId: 7 }, ctx);
    const permAsk = getAskCall(ctx);
    expect(permAsk.question).toContain('Switch to tab');
    expect(permAsk.question).toContain('7');
  });

  test('permission rejection returns USER_REJECTION', async () => {
    const rejectCtx = createMockContext(vfs, {
      ask: mock(async (request: unknown) => {
        const r = request as Record<string, unknown>;
        if (r.type === 'permission') return false;
        return true;
      }) as unknown as ReturnType<typeof createMockContext>['ask'],
    });

    const result = await execute({ action: 'list' }, rejectCtx);
    expect(result.success).toBe(false);
    expect(result.error).toBe('USER_REJECTION');
  });

  test('permission scope includes tab action type', async () => {
    await execute({ action: 'create' }, ctx);
    const permAsk = getAskCall(ctx);
    expect(permAsk.scope).toEqual({
      type: 'custom',
      value: 'tab:create',
      label: 'Open new tab',
    });
  });
});

// ══════════════════════════════════════════════════════════════════
// Successful Execution
// ══════════════════════════════════════════════════════════════════

describe('browser_tab_manage execution', () => {
  test('returns tab list on success', async () => {
    const result = await execute({ action: 'list' }, ctx);
    expect(result.success).toBe(true);
    const data = result.result as { tabs: unknown[] };
    expect(data.tabs.length).toBe(2);
  });

  test('passes action params through to client_capability', async () => {
    await execute({ action: 'create', url: 'https://test.com', windowId: 24, active: false }, ctx);
    const calls = (ctx.ask as ReturnType<typeof mock>).mock.calls;
    const capCall = calls[1][0] as Record<string, unknown>;
    const metadata = capCall.metadata as Record<string, unknown>;
    const params = metadata.params as Record<string, unknown>;
    expect(params.action).toBe('create');
    expect(params.url).toBe('https://test.com');
    expect(params.windowId).toBe(24);
    expect(params.active).toBe(false);
  });
});

// ══════════════════════════════════════════════════════════════════
// Error Handling
// ══════════════════════════════════════════════════════════════════

describe('browser_tab_manage error handling', () => {
  test('handles extension returning failure', async () => {
    const failCtx = createMockContext(vfs, {
      ask: mock(async (request: unknown) => {
        const r = request as Record<string, unknown>;
        if (r.type === 'permission') return true;
        return { success: false, error: 'Tab not found' };
      }) as unknown as ReturnType<typeof createMockContext>['ask'],
    });

    const result = await execute({ action: 'close', tabId: 999 }, failCtx);
    expect(result.success).toBe(false);
    expect(result.error).toContain('Tab action failed');
    expect(result.error).toContain('Tab not found');
  });

  test('handles invalid extension response', async () => {
    const badCtx = createMockContext(vfs, {
      ask: mock(async (request: unknown) => {
        const r = request as Record<string, unknown>;
        if (r.type === 'permission') return true;
        return null;
      }) as unknown as ReturnType<typeof createMockContext>['ask'],
    });

    const result = await execute({ action: 'list' }, badCtx);
    expect(result.success).toBe(false);
    expect(result.error).toContain('invalid response');
  });

  test('handles timeout error', async () => {
    const timeoutCtx = createMockContext(vfs, {
      ask: mock(async (request: unknown) => {
        const r = request as Record<string, unknown>;
        if (r.type === 'permission') return true;
        throw new Error('Extension did not respond');
      }) as unknown as ReturnType<typeof createMockContext>['ask'],
    });

    const result = await execute({ action: 'list' }, timeoutCtx);
    expect(result.success).toBe(false);
    expect(result.error).toContain('timed out');
  });

  test('handles generic error', async () => {
    const errorCtx = createMockContext(vfs, {
      ask: mock(async (request: unknown) => {
        const r = request as Record<string, unknown>;
        if (r.type === 'permission') return true;
        throw new Error('Unknown error');
      }) as unknown as ReturnType<typeof createMockContext>['ask'],
    });

    const result = await execute({ action: 'list' }, errorCtx);
    expect(result.success).toBe(false);
    expect(result.error).toContain('Tab action failed');
    expect(result.error).toContain('Unknown error');
  });
});
