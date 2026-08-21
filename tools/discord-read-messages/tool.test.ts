import { describe, test, expect, mock } from 'bun:test';
import { definition, execute } from './tool';
import { createMockContext, VirtualFS } from '../test-utils';
import type { ToolContext } from '@prokopai/sdk';

interface CapturedRequest {
  url: string;
  method: string;
  headers: Record<string, string>;
}

function buildContext(
  envValues: Record<string, string | undefined>,
  fetchResponse: { ok: boolean; status: number; body: unknown } | null,
  fetchError: Error | null = null,
): { ctx: ToolContext; calls: CapturedRequest[] } {
  const baseCtx = createMockContext(new VirtualFS());
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
        for (const [k, v] of Object.entries(h)) headers[k] = v;
      }
      calls.push({ url: urlStr, method: init?.method ?? 'GET', headers });

      if (fetchError) throw fetchError;

      return new Response(JSON.stringify(fetchResponse!.body), {
        status: fetchResponse!.status,
        headers: { 'content-type': 'application/json' },
      });
    }) as unknown as ToolContext['fetch'],
  };

  return { ctx, calls };
}

const SAMPLE_MESSAGES = [
  {
    id: '300',
    channel_id: '111222333',
    author: { id: 'user1', username: 'alice', global_name: 'Alice' },
    content: 'Hello world!',
    timestamp: '2024-01-15T12:00:00.000Z',
    edited_timestamp: null,
    type: 0,
    pinned: false,
    attachments: [],
    embeds: [],
    reactions: [],
  },
  {
    id: '301',
    channel_id: '111222333',
    author: { id: 'user2', username: 'bob', global_name: 'Bob' },
    content: 'Check this image',
    timestamp: '2024-01-15T12:01:00.000Z',
    edited_timestamp: null,
    type: 0,
    pinned: true,
    attachments: [
      { id: 'att1', filename: 'screenshot.png', url: 'https://cdn.discord.app/att1.png', contentType: 'image/png', size: 102400 },
    ],
    embeds: [],
    reactions: [
      { emoji: { name: '👍' }, count: 3 },
    ],
  },
  {
    id: '302',
    channel_id: '111222333',
    author: { id: 'user1', username: 'alice', global_name: 'Alice' },
    content: 'Replying to Bob',
    timestamp: '2024-01-15T12:02:00.000Z',
    edited_timestamp: '2024-01-15T12:03:00.000Z',
    type: 0,
    pinned: false,
    referenced_message: {
      id: '301',
      author: { id: 'user2', username: 'bob', global_name: 'Bob' },
      content: 'Check this image',
    },
  },
];

// ========================================================================
// Tool Definition
// ========================================================================

describe('discord-read-messages: definition', () => {
  test('has correct name', () => {
    expect(definition.name).toBe('discord-read-messages');
  });

  test('declares required env vars', () => {
    expect(definition.env).toContain('DISCORD_BOT_TOKEN');
    expect(definition.env).toContain('DISCORD_DEFAULT_CHANNEL_ID');
  });

  test('has timeout set', () => {
    expect(definition.timeout).toBe(30000);
  });

  test('input schema has channelId and pagination params', () => {
    const schema = definition.inputSchema as { properties: Record<string, unknown> };
    expect(schema.properties).toHaveProperty('channelId');
    expect(schema.properties).toHaveProperty('limit');
    expect(schema.properties).toHaveProperty('before');
    expect(schema.properties).toHaveProperty('after');
    expect(schema.properties).toHaveProperty('around');
  });
});

// ========================================================================
// Validation
// ========================================================================

describe('discord-read-messages: validation', () => {
  test('fails when no channel ID from param or env', async () => {
    const { ctx } = buildContext({ DISCORD_BOT_TOKEN: 'token' }, null);
    const result = await execute({}, ctx);
    expect(result.success).toBe(false);
    expect(result.error).toContain('No channel ID');
  });

  test('falls back to DISCORD_DEFAULT_CHANNEL_ID env', async () => {
    const { ctx, calls } = buildContext(
      { DISCORD_BOT_TOKEN: 'token', DISCORD_DEFAULT_CHANNEL_ID: '999' },
      { ok: true, status: 200, body: [] },
    );
    const result = await execute({}, ctx);
    expect(result.success).toBe(true);
    expect(calls[0].url).toContain('channels/999/messages');
  });
});

// ========================================================================
// Message Reading
// ========================================================================

describe('discord-read-messages: reading messages', () => {
  test('reads messages successfully', async () => {
    const { ctx } = buildContext(
      { DISCORD_BOT_TOKEN: 'token' },
      { ok: true, status: 200, body: SAMPLE_MESSAGES },
    );

    const result = await execute({ channelId: '111222333' }, ctx);

    expect(result.success).toBe(true);
    const res = result.result as { channelId: string; count: number; messages: unknown[] };
    expect(res.channelId).toBe('111222333');
    expect(res.count).toBe(3);
    expect(res.messages).toHaveLength(3);
  });

  test('returns empty array when no messages', async () => {
    const { ctx } = buildContext(
      { DISCORD_BOT_TOKEN: 'token' },
      { ok: true, status: 200, body: [] },
    );

    const result = await execute({ channelId: '111222333' }, ctx);

    expect(result.success).toBe(true);
    const res = result.result as { count: number };
    expect(res.count).toBe(0);
  });

  test('maps message fields correctly', async () => {
    const { ctx } = buildContext(
      { DISCORD_BOT_TOKEN: 'token' },
      { ok: true, status: 200, body: SAMPLE_MESSAGES },
    );

    const result = await execute({ channelId: '111222333' }, ctx);
    expect(result.success).toBe(true);

    const res = result.result as { messages: Array<Record<string, unknown>> };
    const first = res.messages[0];
    expect(first.id).toBe('300');
    expect(first.author).toBe('Alice');
    expect(first.authorId).toBe('user1');
    expect(first.content).toBe('Hello world!');
    expect(first.pinned).toBe(false);
  });

  test('includes attachment info when present', async () => {
    const { ctx } = buildContext(
      { DISCORD_BOT_TOKEN: 'token' },
      { ok: true, status: 200, body: [SAMPLE_MESSAGES[1]] },
    );

    const result = await execute({ channelId: '111222333' }, ctx);
    expect(result.success).toBe(true);

    const res = result.result as { messages: Array<Record<string, unknown>> };
    const msg = res.messages[0];
    expect(msg.attachments).toEqual([
      { filename: 'screenshot.png', url: 'https://cdn.discord.app/att1.png', contentType: 'image/png', size: 102400 },
    ]);
  });

  test('includes reaction info when present', async () => {
    const { ctx } = buildContext(
      { DISCORD_BOT_TOKEN: 'token' },
      { ok: true, status: 200, body: [SAMPLE_MESSAGES[1]] },
    );

    const result = await execute({ channelId: '111222333' }, ctx);
    expect(result.success).toBe(true);

    const res = result.result as { messages: Array<Record<string, unknown>> };
    const msg = res.messages[0];
    expect(msg.reactions).toEqual([{ emoji: '👍', count: 3 }]);
  });

  test('includes reply reference when present', async () => {
    const { ctx } = buildContext(
      { DISCORD_BOT_TOKEN: 'token' },
      { ok: true, status: 200, body: [SAMPLE_MESSAGES[2]] },
    );

    const result = await execute({ channelId: '111222333' }, ctx);
    expect(result.success).toBe(true);

    const res = result.result as { messages: Array<Record<string, unknown>> };
    const msg = res.messages[0];
    expect(msg.replyTo).toBe('Bob');
    expect(msg.replyToContent).toBe('Check this image');
  });

  test('uses global_name when available, falls back to username', async () => {
    const { ctx } = buildContext(
      { DISCORD_BOT_TOKEN: 'token' },
      {
        ok: true,
        status: 200,
        body: [
          {
            id: '1',
            channel_id: '111222333',
            author: { id: 'u1', username: 'cooluser' },
            content: 'no global name',
            timestamp: '2024-01-15T12:00:00.000Z',
            edited_timestamp: null,
            type: 0,
          },
        ],
      },
    );

    const result = await execute({ channelId: '111222333' }, ctx);
    expect(result.success).toBe(true);

    const res = result.result as { messages: Array<Record<string, unknown>> };
    expect(res.messages[0].author).toBe('cooluser');
  });
});

// ========================================================================
// Pagination
// ========================================================================

describe('discord-read-messages: pagination', () => {
  test('default limit is 50', async () => {
    const { ctx, calls } = buildContext(
      { DISCORD_BOT_TOKEN: 'token' },
      { ok: true, status: 200, body: [] },
    );

    await execute({ channelId: '111222333' }, ctx);

    expect(calls[0].url).toContain('limit=50');
  });

  test('passes custom limit', async () => {
    const { ctx, calls } = buildContext(
      { DISCORD_BOT_TOKEN: 'token' },
      { ok: true, status: 200, body: [] },
    );

    await execute({ channelId: '111222333', limit: 10 }, ctx);

    expect(calls[0].url).toContain('limit=10');
  });

  test('clamps limit to max 100', async () => {
    const { ctx, calls } = buildContext(
      { DISCORD_BOT_TOKEN: 'token' },
      { ok: true, status: 200, body: [] },
    );

    await execute({ channelId: '111222333', limit: 500 }, ctx);

    expect(calls[0].url).toContain('limit=100');
  });

  test('clamps limit to min 1', async () => {
    const { ctx, calls } = buildContext(
      { DISCORD_BOT_TOKEN: 'token' },
      { ok: true, status: 200, body: [] },
    );

    await execute({ channelId: '111222333', limit: 0 }, ctx);

    expect(calls[0].url).toContain('limit=1');
  });

  test('passes before cursor', async () => {
    const { ctx, calls } = buildContext(
      { DISCORD_BOT_TOKEN: 'token' },
      { ok: true, status: 200, body: [] },
    );

    await execute({ channelId: '111222333', before: '999' }, ctx);

    expect(calls[0].url).toContain('before=999');
  });

  test('passes after cursor', async () => {
    const { ctx, calls } = buildContext(
      { DISCORD_BOT_TOKEN: 'token' },
      { ok: true, status: 200, body: [] },
    );

    await execute({ channelId: '111222333', after: '100' }, ctx);

    expect(calls[0].url).toContain('after=100');
  });

  test('passes around cursor', async () => {
    const { ctx, calls } = buildContext(
      { DISCORD_BOT_TOKEN: 'token' },
      { ok: true, status: 200, body: [] },
    );

    await execute({ channelId: '111222333', around: '555' }, ctx);

    expect(calls[0].url).toContain('around=555');
  });
});

// ========================================================================
// Request Verification
// ========================================================================

describe('discord-read-messages: request', () => {
  test('uses GET method', async () => {
    const { ctx, calls } = buildContext(
      { DISCORD_BOT_TOKEN: 'token' },
      { ok: true, status: 200, body: [] },
    );

    await execute({ channelId: '111222333' }, ctx);

    expect(calls[0].method).toBe('GET');
  });

  test('sends bot token in Authorization header', async () => {
    const { ctx, calls } = buildContext(
      { DISCORD_BOT_TOKEN: 'my-secret-token' },
      { ok: true, status: 200, body: [] },
    );

    await execute({ channelId: '111222333' }, ctx);

    expect(calls[0].headers['Authorization']).toBe('Bot my-secret-token');
  });
});

// ========================================================================
// Error Handling
// ========================================================================

describe('discord-read-messages: errors', () => {
  test('returns error on 401 unauthorized', async () => {
    const { ctx } = buildContext(
      { DISCORD_BOT_TOKEN: 'bad-token' },
      { ok: false, status: 401, body: { message: '401: Unauthorized', code: 0 } },
    );

    const result = await execute({ channelId: '111222333' }, ctx);

    expect(result.success).toBe(false);
    expect(result.error).toContain('401');
    expect(result.error).toContain('Unauthorized');
  });

  test('returns error on 403 forbidden (missing permissions)', async () => {
    const { ctx } = buildContext(
      { DISCORD_BOT_TOKEN: 'token' },
      { ok: false, status: 403, body: { message: 'Missing Access', code: 50001 } },
    );

    const result = await execute({ channelId: '111222333' }, ctx);

    expect(result.success).toBe(false);
    expect(result.error).toContain('Missing Access');
    expect(result.error).toContain('50001');
  });

  test('returns error on 429 rate limited', async () => {
    const { ctx } = buildContext(
      { DISCORD_BOT_TOKEN: 'token' },
      { ok: false, status: 429, body: { message: 'You are being rate limited.', code: 0, retry_after: 2.5 } },
    );

    const result = await execute({ channelId: '111222333' }, ctx);

    expect(result.success).toBe(false);
    expect(result.error).toContain('rate limited');
  });

  test('handles fetch throwing (network failure)', async () => {
    const { ctx } = buildContext(
      { DISCORD_BOT_TOKEN: 'token' },
      null,
      new Error('ECONNREFUSED'),
    );

    const result = await execute({ channelId: '111222333' }, ctx);

    expect(result.success).toBe(false);
    expect(result.error).toContain('Failed to reach Discord API');
    expect(result.error).toContain('ECONNREFUSED');
  });

  test('handles non-JSON response gracefully', async () => {
    const baseCtx = createMockContext(new VirtualFS());
    const ctx: ToolContext = {
      ...baseCtx,
      env: {
        get: () => undefined,
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

    const result = await execute({ channelId: '111222333' }, ctx);

    expect(result.success).toBe(false);
    expect(result.error).toContain('500');
    expect(result.error).toContain('unexpected response format');
  });

  test('handles non-array response body', async () => {
    const { ctx } = buildContext(
      { DISCORD_BOT_TOKEN: 'token' },
      { ok: true, status: 200, body: { not: 'an array' } },
    );

    const result = await execute({ channelId: '111222333' }, ctx);

    expect(result.success).toBe(false);
    expect(result.error).toContain('Unexpected response format');
  });

  test('throws when DISCORD_BOT_TOKEN is not set', async () => {
    const { ctx } = buildContext({}, { ok: true, status: 200, body: [] });

    const result = await execute({ channelId: '111222333' }, ctx);

    expect(result.success).toBe(false);
    expect(result.error).toContain('DISCORD_BOT_TOKEN');
  });

  test('does not leak token in error messages', async () => {
    const { ctx } = buildContext(
      { DISCORD_BOT_TOKEN: 'super-secret-token' },
      null,
      new Error('ECONNREFUSED'),
    );

    const result = await execute({ channelId: '111222333' }, ctx);

    expect(result.success).toBe(false);
    expect(result.error).not.toContain('super-secret-token');
  });
});
