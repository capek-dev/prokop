import { describe, test, expect, mock, beforeEach } from 'bun:test';
import { definition, execute } from './tool';
import { createMockContext, VirtualFS } from '../test-utils';

let vfs: VirtualFS;
let ctx: ReturnType<typeof createMockContext>;

beforeEach(() => {
  vfs = new VirtualFS();
  ctx = createMockContext(vfs);
});

// ══════════════════════════════════════════════════════════════════
// Tool Definition
// ══════════════════════════════════════════════════════════════════

describe('webfetch tool definition', () => {
  test('has correct name', () => {
    expect(definition.name).toBe('webfetch');
  });

  test('has required url input', () => {
    const schema = definition.inputSchema as { properties: Record<string, unknown>; required: string[] };
    expect(schema.required).toContain('url');
  });

  test('has 120 second timeout', () => {
    expect(definition.timeout).toBe(120000);
  });
});

// ══════════════════════════════════════════════════════════════════
// URL Validation & Security
// ══════════════════════════════════════════════════════════════════

describe('webfetch: URL validation', () => {
  test('rejects invalid URL', async () => {
    const result = await execute({ url: 'not-a-url' }, ctx);
    expect(result.success).toBe(false);
    expect(result.error).toContain('Invalid URL');
  });

  test('rejects non-HTTP protocols', async () => {
    const result = await execute({ url: 'ftp://example.com/file' }, ctx);
    expect(result.success).toBe(false);
    expect(result.error).toContain('Only HTTP and HTTPS');
  });

  test('rejects localhost', async () => {
    const result = await execute({ url: 'http://localhost:3000/api' }, ctx);
    expect(result.success).toBe(false);
    expect(result.error).toContain('private IP');
  });

  test('rejects 127.0.0.1 (loopback)', async () => {
    const result = await execute({ url: 'http://127.0.0.1:8080/api' }, ctx);
    expect(result.success).toBe(false);
    expect(result.error).toContain('private IP');
    expect(ctx.fetch).not.toHaveBeenCalled();
  });

  test('rejects 10.x.x.x (private class A)', async () => {
    const result = await execute({ url: 'http://10.0.0.1/internal' }, ctx);
    expect(result.success).toBe(false);
    expect(result.error).toContain('private IP');
    expect(ctx.fetch).not.toHaveBeenCalled();
  });

  test('rejects 192.168.x.x (private class C)', async () => {
    const result = await execute({ url: 'http://192.168.1.1/admin' }, ctx);
    expect(result.success).toBe(false);
    expect(result.error).toContain('private IP');
    expect(ctx.fetch).not.toHaveBeenCalled();
  });

  test('rejects 172.16-31.x.x (private class B)', async () => {
    const result = await execute({ url: 'http://172.16.0.1/internal' }, ctx);
    expect(result.success).toBe(false);
    expect(result.error).toContain('private IP');
    expect(ctx.fetch).not.toHaveBeenCalled();
  });

  test('rejects HTTPS to private IP (no HTTP ask needed)', async () => {
    const result = await execute({ url: 'https://10.0.0.1/secret' }, ctx);
    expect(result.success).toBe(false);
    expect(result.error).toContain('private IP');
    expect(ctx.ask).not.toHaveBeenCalled();
    expect(ctx.fetch).not.toHaveBeenCalled();
  });

  test('rejects cloud metadata IP (169.254.169.254) as private IP', async () => {
    const result = await execute({ url: 'http://169.254.169.254/latest/meta-data/' }, ctx);
    expect(result.success).toBe(false);
    // Caught by isPrivateIP (169.254.x.x = link-local) before metadata hostname check
    expect(result.error).toContain('private IP');
  });

  test('rejects metadata.google.internal', async () => {
    const result = await execute({ url: 'http://metadata.google.internal/computeMetadata/v1/' }, ctx);
    expect(result.success).toBe(false);
    expect(result.error).toContain('metadata');
  });

  test('rejects file:// protocol', async () => {
    const result = await execute({ url: 'file:///etc/passwd' }, ctx);
    expect(result.success).toBe(false);
    expect(result.error).toContain('Only HTTP');
  });
});

// ══════════════════════════════════════════════════════════════════
// HTTP vs HTTPS
// ══════════════════════════════════════════════════════════════════

describe('webfetch: HTTP vs HTTPS', () => {
  test('HTTPS URL does not require permission', async () => {
    const result = await execute({ url: 'https://example.com' }, ctx);
    expect(ctx.ask).not.toHaveBeenCalled();
    expect(result.success).toBe(true);
  });

  test('HTTP URL requires permission', async () => {
    const _result = await execute({ url: 'http://example.com' }, ctx);
    expect(ctx.ask).toHaveBeenCalled();
  });

  test('HTTP URL rejected returns USER_REJECTION', async () => {
    const rejectCtx = createMockContext(vfs, {
      ask: mock(async () => false) as unknown as typeof ctx.ask,
    });
    const result = await execute({ url: 'http://example.com' }, rejectCtx);
    expect(result.success).toBe(false);
    expect(result.error).toBe('USER_REJECTION');
  });

  test('HTTP URL approved proceeds with fetch', async () => {
    const result = await execute({ url: 'http://example.com' }, ctx);
    expect(result.success).toBe(true);
    expect(ctx.fetch).toHaveBeenCalled();
  });
});

// ══════════════════════════════════════════════════════════════════
// Fetch & Response Handling (mocked)
// ══════════════════════════════════════════════════════════════════

describe('webfetch: response handling', () => {
  test('successful fetch returns content', async () => {
    const result = await execute({ url: 'https://example.com' }, ctx);
    expect(result.success).toBe(true);
    const res = result.result as { content: string; title: string; contentType: string };
    expect(res.content).toBeTruthy();
  });

  test('returns markdown format by default', async () => {
    const mdCtx = createMockContext(vfs);
    // Mock fetch returns HTML, which gets converted to markdown
    const result = await execute({ url: 'https://example.com' }, mdCtx);
    expect(result.success).toBe(true);
  });

  test('returns html format when requested', async () => {
    const result = await execute({ url: 'https://example.com', format: 'html' }, ctx);
    expect(result.success).toBe(true);
    const res = result.result as { content: string };
    expect(res.content).toContain('<html>');
  });

  test('returns text format when requested', async () => {
    const result = await execute({ url: 'https://example.com', format: 'text' }, ctx);
    expect(result.success).toBe(true);
    const res = result.result as { content: string };
    // Text format strips HTML tags
    expect(res.content).not.toContain('<html>');
    expect(res.content).toContain('mock page');
  });

  test('handles non-OK response', async () => {
    const failCtx = createMockContext(vfs);
    failCtx.fetch = mock(async () => new Response('Not Found', { status: 404 })) as unknown as typeof ctx.fetch;
    const result = await execute({ url: 'https://example.com/missing' }, failCtx);
    expect(result.success).toBe(false);
    expect(result.error).toContain('404');
  });

  test('returns visualization with URL', async () => {
    const result = await execute({ url: 'https://example.com' }, ctx);
    expect(result.visualization).toBeDefined();
    expect(result.visualization?.type).toBe('none');
    const viz = result.visualization as { message: string };
    expect(viz.message).toContain('example.com');
  });
});
