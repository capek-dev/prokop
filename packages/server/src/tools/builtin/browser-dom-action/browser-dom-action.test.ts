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
        return { success: true, elementFound: true, currentValue: 'test', pageChanged: true };
      }
      return true;
    }) as unknown as ReturnType<typeof createMockContext>['ask'],
  });
});

// ══════════════════════════════════════════════════════════════════
// Tool Definition
// ══════════════════════════════════════════════════════════════════

describe('browser_dom_action tool definition', () => {
  test('has correct name', () => {
    expect(definition.name).toBe('browser_dom_action');
  });

  test('has action as required property', () => {
    expect(definition.inputSchema.required).toContain('action');
  });

  test('supports all action types', () => {
    const properties = definition.inputSchema.properties as Record<string, { enum: string[] }> | undefined;
    const actionProp = properties!.action;
    expect(actionProp.enum).toEqual([
      'click', 'type', 'select', 'clear', 'scroll', 'hover', 'press_enter', 'check', 'uncheck',
    ]);
  });

  test('has timeout set', () => {
    expect(definition.timeout).toBe(30000);
  });
});

// ══════════════════════════════════════════════════════════════════
// Input Validation
// ══════════════════════════════════════════════════════════════════

describe('browser_dom_action input validation', () => {
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
// Permission Ask
// ══════════════════════════════════════════════════════════════════

describe('browser_dom_action permissions', () => {
  test('asks for permission with medium risk', async () => {
    await execute({ action: 'click', selector: '#btn' }, ctx);
    const permAsk = getAskCall(ctx);
    expect(permAsk.type).toBe('permission');
    expect(permAsk.risk).toBe('medium');
    expect(permAsk.resource).toBe('browser');
    expect(permAsk.action).toBe('interact');
  });

  test('permission question includes action name', async () => {
    await execute({ action: 'type', selector: '#input', value: 'hello' }, ctx);
    const permAsk = getAskCall(ctx);
    expect(permAsk.question).toContain('type');
  });

  test('permission description includes selector when provided', async () => {
    await execute({ action: 'click', selector: '#buy-btn' }, ctx);
    const permAsk = getAskCall(ctx);
    expect(permAsk.description).toContain('#buy-btn');
  });

  test('permission description includes text when provided', async () => {
    await execute({ action: 'click', text: 'Add to cart' }, ctx);
    const permAsk = getAskCall(ctx);
    expect(permAsk.description).toContain('Add to cart');
  });

  test('permission description includes value when provided', async () => {
    await execute({ action: 'type', selector: '#qty', value: '2' }, ctx);
    const permAsk = getAskCall(ctx);
    expect(permAsk.description).toContain('2');
  });

  test('permission rejection returns USER_REJECTION', async () => {
    const rejectCtx = createMockContext(vfs, {
      ask: mock(async (request: unknown) => {
        const r = request as Record<string, unknown>;
        if (r.type === 'permission') return false;
        return true;
      }) as unknown as ReturnType<typeof createMockContext>['ask'],
    });

    const result = await execute({ action: 'click' }, rejectCtx);
    expect(result.success).toBe(false);
    expect(result.error).toBe('USER_REJECTION');
  });

  test('permission scope includes action name', async () => {
    await execute({ action: 'click' }, ctx);
    const permAsk = getAskCall(ctx);
    expect(permAsk.scope).toEqual({ type: 'custom', value: 'click', label: 'click action' });
  });
});

// ══════════════════════════════════════════════════════════════════
// Successful Execution
// ══════════════════════════════════════════════════════════════════

describe('browser_dom_action execution', () => {
  test('click action returns success', async () => {
    const result = await execute({ action: 'click', selector: '#btn' }, ctx);
    expect(result.success).toBe(true);
    const data = result.result as Record<string, unknown>;
    expect(data.action).toBe('click');
    expect(data.selector).toBe('#btn');
  });

  test('type action passes value through', async () => {
    const result = await execute({ action: 'type', selector: '#input', value: 'hello' }, ctx);
    expect(result.success).toBe(true);
  });

  test('sends client_capability ask with correct params', async () => {
    await execute({ action: 'scroll', tabId: 42, x: 0, y: 100 }, ctx);
    const calls = getAllAskCalls(ctx);
    const capCall = calls[1] as unknown as Record<string, unknown>;
    expect(capCall.type).toBe('client_capability');
    expect(capCall.capability).toBe('browser_dom_action');
    const metadata = capCall.metadata as Record<string, unknown>;
    const params = metadata.params as Record<string, unknown>;
    expect(params.action).toBe('scroll');
    expect(params.tabId).toBe(42);
    expect(params.x).toBe(0);
    expect(params.y).toBe(100);
  });

  test('returns null selector when not provided', async () => {
    const result = await execute({ action: 'press_enter' }, ctx);
    expect(result.success).toBe(true);
    const data = result.result as Record<string, unknown>;
    expect(data.selector).toBeNull();
  });
});

// ══════════════════════════════════════════════════════════════════
// Error Handling
// ══════════════════════════════════════════════════════════════════

describe('browser_dom_action error handling', () => {
  test('handles extension returning failure', async () => {
    const failCtx = createMockContext(vfs, {
      ask: mock(async (request: unknown) => {
        const r = request as Record<string, unknown>;
        if (r.type === 'permission') return true;
        return { success: false, error: 'Element not found' };
      }) as unknown as ReturnType<typeof createMockContext>['ask'],
    });

    const result = await execute({ action: 'click', selector: '#missing' }, failCtx);
    expect(result.success).toBe(false);
    expect(result.error).toContain('DOM action failed');
    expect(result.error).toContain('Element not found');
  });

  test('handles invalid extension response', async () => {
    const badCtx = createMockContext(vfs, {
      ask: mock(async (request: unknown) => {
        const r = request as Record<string, unknown>;
        if (r.type === 'permission') return true;
        return 'not an object';
      }) as unknown as ReturnType<typeof createMockContext>['ask'],
    });

    const result = await execute({ action: 'click' }, badCtx);
    expect(result.success).toBe(false);
    expect(result.error).toContain('invalid response');
  });

  test('handles timeout error', async () => {
    const timeoutCtx = createMockContext(vfs, {
      ask: mock(async (request: unknown) => {
        const r = request as Record<string, unknown>;
        if (r.type === 'permission') return true;
        throw new Error('Extension did not respond in time');
      }) as unknown as ReturnType<typeof createMockContext>['ask'],
    });

    const result = await execute({ action: 'click' }, timeoutCtx);
    expect(result.success).toBe(false);
    expect(result.error).toContain('timed out');
  });

  test('handles generic error', async () => {
    const errorCtx = createMockContext(vfs, {
      ask: mock(async (request: unknown) => {
        const r = request as Record<string, unknown>;
        if (r.type === 'permission') return true;
        throw new Error('Something went wrong');
      }) as unknown as ReturnType<typeof createMockContext>['ask'],
    });

    const result = await execute({ action: 'click' }, errorCtx);
    expect(result.success).toBe(false);
    expect(result.error).toContain('Browser action failed');
    expect(result.error).toContain('Something went wrong');
  });
});
