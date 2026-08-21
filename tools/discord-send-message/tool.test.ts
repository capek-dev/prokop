import { describe, test, expect, mock } from 'bun:test';
import { definition, execute } from './tool';
import { createMockContext, VirtualFS } from '../test-utils';
import type { ToolContext } from '@prokopai/sdk';

/** Captured fetch request data for assertions. */
interface CapturedRequest {
  url: string;
  method: string;
  headers: Record<string, string>;
  body: unknown;
}

/**
 * Build a mock context with custom fetch + env behavior.
 * Returns the context and an array that captures all fetch calls.
 */
function buildContext(
  envValues: Record<string, string | undefined>,
  fetchResponse: { ok: boolean; status: number; body: unknown } | null,
  fetchError: Error | null = null,
): { ctx: ToolContext; calls: CapturedRequest[] } {
  const vfs = new VirtualFS();
  const baseCtx = createMockContext(vfs);
  const calls: CapturedRequest[] = [];

  const ctx: ToolContext = {
    ...baseCtx,
    env: {
      get: (key: string) => envValues[key],
      require: (key: string) => {
        const val = envValues[key];
        if (val === undefined) throw new Error(`Required environment variable not set: ${key}`);
        return val;
      },
    },
    fetch: mock(async (url: string | URL | Request, init?: RequestInit): Promise<Response> => {
      const urlStr = typeof url === 'string' ? url : url.toString();
      const headers: Record<string, string> = {};
      if (init?.headers) {
        const h = init.headers as Record<string, string>;
        for (const [k, v] of Object.entries(h)) {
          headers[k] = v;
        }
      }
      let parsedBody: unknown = undefined;
      if (init?.body) {
        try {
          parsedBody = JSON.parse(init.body as string);
        } catch {
          parsedBody = init.body;
        }
      }
      calls.push({ url: urlStr, method: init?.method ?? 'GET', headers, body: parsedBody });

      if (fetchError) throw fetchError;

      return new Response(JSON.stringify(fetchResponse!.body), {
        status: fetchResponse!.status,
        headers: { 'content-type': 'application/json' },
      });
    }) as unknown as ToolContext['fetch'],
  };

  return { ctx, calls };
}

/** A successful Discord message response. */
const DISCORD_SUCCESS = {
  id: '1234567890',
  channel_id: '111222333',
  content: 'hello',
  author: { id: 'bot', username: 'Jean2' },
};

// ========================================================================
// Tool Definition
// ========================================================================

describe('discord-send-message: definition', () => {
  test('has correct name', () => {
    expect(definition.name).toBe('discord-send-message');
  });

  test('declares required env vars', () => {
    expect(definition.env).toContain('DISCORD_BOT_TOKEN');
    expect(definition.env).toContain('DISCORD_DEFAULT_CHANNEL_ID');
  });

  test('has timeout set', () => {
    expect(definition.timeout).toBe(30000);
  });

  test('input schema has content and embeds properties', () => {
    const schema = definition.inputSchema as { properties: Record<string, unknown> };
    expect(schema.properties).toHaveProperty('content');
    expect(schema.properties).toHaveProperty('embeds');
    expect(schema.properties).toHaveProperty('channelId');
  });
});

// ========================================================================
// Validation
// ========================================================================

describe('discord-send-message: input validation', () => {
  test('fails when neither content nor embeds provided', async () => {
    const { ctx } = buildContext({ DISCORD_BOT_TOKEN: 'test-token' }, null);
    const result = await execute({}, ctx);
    expect(result.success).toBe(false);
    expect(result.error).toContain('Either content or embeds');
  });

  test('fails when no channel ID from param or env', async () => {
    const { ctx } = buildContext({ DISCORD_BOT_TOKEN: 'test-token' }, null);
    const result = await execute({ content: 'hello' }, ctx);
    expect(result.success).toBe(false);
    expect(result.error).toContain('No channel ID');
  });
});

// ========================================================================
// Success: Plain Text
// ========================================================================

describe('discord-send-message: plain text', () => {
  test('sends text content successfully', async () => {
    const { ctx, calls } = buildContext(
      { DISCORD_BOT_TOKEN: 'my-bot-token' },
      { ok: true, status: 200, body: DISCORD_SUCCESS },
    );

    const result = await execute(
      { content: 'Hello Discord!', channelId: '111222333' },
      ctx,
    );

    expect(result.success).toBe(true);
    const res = result.result as { messageId: string; channelId: string; url: string };
    expect(res.messageId).toBe('1234567890');
    expect(res.channelId).toBe('111222333');
    expect(res.url).toContain('111222333');
    expect(res.url).toContain('1234567890');

    // Verify the request
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe('https://discord.com/api/v10/channels/111222333/messages');
    expect(calls[0].method).toBe('POST');
    expect(calls[0].headers['Authorization']).toBe('Bot my-bot-token');
    expect(calls[0].headers['Content-Type']).toBe('application/json');
    expect(calls[0].body).toEqual({ content: 'Hello Discord!' });
  });

  test('falls back to DISCORD_DEFAULT_CHANNEL_ID env', async () => {
    const { ctx, calls } = buildContext(
      { DISCORD_BOT_TOKEN: 'token', DISCORD_DEFAULT_CHANNEL_ID: '999888777' },
      { ok: true, status: 200, body: { ...DISCORD_SUCCESS, channel_id: '999888777' } },
    );

    const result = await execute({ content: 'via env' }, ctx);

    expect(result.success).toBe(true);
    expect(calls[0].url).toContain('channels/999888777/messages');
  });
});

// ========================================================================
// Success: Embeds
// ========================================================================

describe('discord-send-message: embeds', () => {
  test('sends single embed with fields', async () => {
    const { ctx, calls } = buildContext(
      { DISCORD_BOT_TOKEN: 'token' },
      { ok: true, status: 200, body: DISCORD_SUCCESS },
    );

    const embed = {
      title: 'Server v1.0.13',
      color: 5763719,
      fields: [
        { name: 'Added', value: '- New feature A', inline: false },
        { name: 'Fixed', value: '- Bug fix B', inline: false },
      ],
    };

    const result = await execute(
      { channelId: '111222333', embeds: [embed] },
      ctx,
    );

    expect(result.success).toBe(true);
    expect(calls[0].body).toEqual({ embeds: [embed] });
  });

  test('sends multiple embeds', async () => {
    const { ctx, calls } = buildContext(
      { DISCORD_BOT_TOKEN: 'token' },
      { ok: true, status: 200, body: DISCORD_SUCCESS },
    );

    const result = await execute(
      {
        channelId: '111222333',
        embeds: [
          { title: 'First', description: 'desc 1' },
          { title: 'Second', description: 'desc 2' },
        ],
      },
      ctx,
    );

    expect(result.success).toBe(true);
    const body = calls[0].body as { embeds: unknown[] };
    expect(body.embeds).toHaveLength(2);
  });

  test('sends both content and embeds', async () => {
    const { ctx, calls } = buildContext(
      { DISCORD_BOT_TOKEN: 'token' },
      { ok: true, status: 200, body: DISCORD_SUCCESS },
    );

    const result = await execute(
      {
        channelId: '111222333',
        content: 'Check this out',
        embeds: [{ title: 'Details', description: 'More info' }],
      },
      ctx,
    );

    expect(result.success).toBe(true);
    const body = calls[0].body as { content: string; embeds: unknown[] };
    expect(body.content).toBe('Check this out');
    expect(body.embeds).toHaveLength(1);
  });

  test('maps avatarUrl to avatar_url in request body', async () => {
    const { ctx, calls } = buildContext(
      { DISCORD_BOT_TOKEN: 'token' },
      { ok: true, status: 200, body: DISCORD_SUCCESS },
    );

    const result = await execute(
      {
        channelId: '111222333',
        content: 'test',
        username: 'CustomName',
        avatarUrl: 'https://example.com/avatar.png',
        tts: true,
      },
      ctx,
    );

    expect(result.success).toBe(true);
    expect(calls[0].body).toEqual({
      content: 'test',
      username: 'CustomName',
      avatar_url: 'https://example.com/avatar.png',
      tts: true,
    });
  });
});

// ========================================================================
// Error Handling: Discord API Errors
// ========================================================================

describe('discord-send-message: discord API errors', () => {
  test('returns error on 401 unauthorized', async () => {
    const { ctx } = buildContext(
      { DISCORD_BOT_TOKEN: 'bad-token' },
      { ok: false, status: 401, body: { message: '401: Unauthorized', code: 0 } },
    );

    const result = await execute(
      { content: 'hello', channelId: '111222333' },
      ctx,
    );

    expect(result.success).toBe(false);
    expect(result.error).toContain('Unauthorized');
    expect(result.error).toContain('401');
  });

  test('returns error on 403 forbidden (missing permissions)', async () => {
    const { ctx } = buildContext(
      { DISCORD_BOT_TOKEN: 'token' },
      {
        ok: false,
        status: 403,
        body: { message: 'Missing Access', code: 50001 },
      },
    );

    const result = await execute(
      { content: 'hello', channelId: '111222333' },
      ctx,
    );

    expect(result.success).toBe(false);
    expect(result.error).toContain('Missing Access');
    expect(result.error).toContain('50001');
  });

  test('returns error on 429 rate limited', async () => {
    const { ctx } = buildContext(
      { DISCORD_BOT_TOKEN: 'token' },
      {
        ok: false,
        status: 429,
        body: { message: 'You are being rate limited.', code: 0, retry_after: 2.5 },
      },
    );

    const result = await execute(
      { content: 'hello', channelId: '111222333' },
      ctx,
    );

    expect(result.success).toBe(false);
    expect(result.error).toContain('rate limited');
  });
});

// ========================================================================
// Error Handling: Network Errors
// ========================================================================

describe('discord-send-message: network errors', () => {
  test('handles fetch throwing (network failure)', async () => {
    const { ctx } = buildContext(
      { DISCORD_BOT_TOKEN: 'token' },
      null,
      new Error('ECONNREFUSED'),
    );

    const result = await execute(
      { content: 'hello', channelId: '111222333' },
      ctx,
    );

    expect(result.success).toBe(false);
    expect(result.error).toContain('Failed to reach Discord API');
    expect(result.error).toContain('ECONNREFUSED');
  });

  test('handles non-JSON error response body gracefully', async () => {
    const vfs = new VirtualFS();
    const baseCtx = createMockContext(vfs);
    const ctx: ToolContext = {
      ...baseCtx,
      env: {
        get: (key: string) => (key === 'DISCORD_BOT_TOKEN' ? 'token' : undefined),
        require: (key: string) => {
          if (key === 'DISCORD_BOT_TOKEN') return 'token';
          throw new Error(`Not set: ${key}`);
        },
      },
      fetch: mock(async (): Promise<Response> => {
        return new Response('Internal Server Error', {
          status: 500,
          headers: { 'content-type': 'text/plain' },
        });
      }) as unknown as ToolContext['fetch'],
    };

    const result = await execute(
      { content: 'hello', channelId: '111222333' },
      ctx,
    );

    expect(result.success).toBe(false);
    expect(result.error).toContain('500');
    expect(result.error).toContain('unexpected response format');
  });
});

// ========================================================================
// Token Access
// ========================================================================

describe('discord-send-message: token handling', () => {
  test('throws when DISCORD_BOT_TOKEN is not set', async () => {
    const { ctx } = buildContext({}, { ok: true, status: 200, body: DISCORD_SUCCESS });

    const result = await execute(
      { content: 'hello', channelId: '111222333' },
      ctx,
    );

    expect(result.success).toBe(false);
    expect(result.error).toContain('DISCORD_BOT_TOKEN');
  });

  test('does not log token value in errors', async () => {
    const { ctx } = buildContext(
      { DISCORD_BOT_TOKEN: 'super-secret-token-value' },
      null,
      new Error('ECONNREFUSED'),
    );

    const result = await execute(
      { content: 'hello', channelId: '111222333' },
      ctx,
    );

    expect(result.success).toBe(false);
    expect(result.error).not.toContain('super-secret-token-value');
  });
});
