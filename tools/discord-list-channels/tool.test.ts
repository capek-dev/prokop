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

const SAMPLE_CHANNELS = [
  { id: '1', name: 'Information', type: 4, parent_id: null, topic: null },
  { id: '2', name: 'general', type: 0, parent_id: null, topic: 'General chat' },
  { id: '3', name: 'announcements', type: 5, parent_id: '1', topic: 'Server announcements' },
  { id: '4', name: 'voice-chat', type: 2, parent_id: null, topic: null },
  { id: '5', name: 'dev-log', type: 0, parent_id: '1', topic: null },
];

// ========================================================================
// Tool Definition
// ========================================================================

describe('discord-list-channels: definition', () => {
  test('has correct name', () => {
    expect(definition.name).toBe('discord-list-channels');
  });

  test('declares required env vars', () => {
    expect(definition.env).toContain('DISCORD_BOT_TOKEN');
    expect(definition.env).toContain('DISCORD_DEFAULT_GUILD_ID');
  });

  test('has timeout set', () => {
    expect(definition.timeout).toBe(30000);
  });

  test('input schema has guildId property', () => {
    const schema = definition.inputSchema as { properties: Record<string, unknown> };
    expect(schema.properties).toHaveProperty('guildId');
  });
});

// ========================================================================
// Validation
// ========================================================================

describe('discord-list-channels: validation', () => {
  test('fails when no guild ID from param or env', async () => {
    const { ctx } = buildContext({ DISCORD_BOT_TOKEN: 'token' }, null);
    const result = await execute({}, ctx);
    expect(result.success).toBe(false);
    expect(result.error).toContain('No guild ID');
  });

  test('falls back to DISCORD_DEFAULT_GUILD_ID env', async () => {
    const { ctx, calls } = buildContext(
      { DISCORD_BOT_TOKEN: 'token', DISCORD_DEFAULT_GUILD_ID: '999' },
      { ok: true, status: 200, body: [] },
    );
    const result = await execute({}, ctx);
    expect(result.success).toBe(true);
    expect(calls[0].url).toContain('guilds/999/channels');
  });
});

// ========================================================================
// Listing Channels
// ========================================================================

describe('discord-list-channels: listing', () => {
  test('lists channels successfully', async () => {
    const { ctx } = buildContext(
      { DISCORD_BOT_TOKEN: 'token' },
      { ok: true, status: 200, body: SAMPLE_CHANNELS },
    );

    const result = await execute({ guildId: '111' }, ctx);

    expect(result.success).toBe(true);
    const res = result.result as { count: number; channels: Array<Record<string, unknown>> };
    expect(res.count).toBe(5);
    expect(res.channels).toHaveLength(5);
  });

  test('maps channel types correctly', async () => {
    const { ctx } = buildContext(
      { DISCORD_BOT_TOKEN: 'token' },
      { ok: true, status: 200, body: SAMPLE_CHANNELS },
    );

    const result = await execute({ guildId: '111' }, ctx);
    expect(result.success).toBe(true);

    const res = result.result as { channels: Array<Record<string, unknown>> };
    const types = res.channels.map((ch) => ch.type);
    expect(types).toContain('category');
    expect(types).toContain('text');
    expect(types).toContain('announcement');
    expect(types).toContain('voice');
  });

  test('resolves category names from parent_id', async () => {
    const { ctx } = buildContext(
      { DISCORD_BOT_TOKEN: 'token' },
      { ok: true, status: 200, body: SAMPLE_CHANNELS },
    );

    const result = await execute({ guildId: '111' }, ctx);
    expect(result.success).toBe(true);

    const res = result.result as { channels: Array<Record<string, unknown>> };
    const announcements = res.channels.find((ch) => ch.name === 'announcements');
    expect(announcements?.category).toBe('Information');

    const devLog = res.channels.find((ch) => ch.name === 'dev-log');
    expect(devLog?.category).toBe('Information');
  });

  test('returns null category for channels without parent', async () => {
    const { ctx } = buildContext(
      { DISCORD_BOT_TOKEN: 'token' },
      { ok: true, status: 200, body: SAMPLE_CHANNELS },
    );

    const result = await execute({ guildId: '111' }, ctx);
    expect(result.success).toBe(true);

    const res = result.result as { channels: Array<Record<string, unknown>> };
    const general = res.channels.find((ch) => ch.name === 'general');
    expect(general?.category).toBeNull();
  });

  test('returns empty array when guild has no channels', async () => {
    const { ctx } = buildContext(
      { DISCORD_BOT_TOKEN: 'token' },
      { ok: true, status: 200, body: [] },
    );

    const result = await execute({ guildId: '111' }, ctx);

    expect(result.success).toBe(true);
    const res = result.result as { count: number };
    expect(res.count).toBe(0);
  });

  test('handles unknown channel types gracefully', async () => {
    const { ctx } = buildContext(
      { DISCORD_BOT_TOKEN: 'token' },
      { ok: true, status: 200, body: [{ id: '1', name: 'mystery', type: 99, parent_id: null }] },
    );

    const result = await execute({ guildId: '111' }, ctx);
    expect(result.success).toBe(true);

    const res = result.result as { channels: Array<Record<string, unknown>> };
    expect(res.channels[0].type).toBe('unknown(99)');
  });

  test('includes topic when present', async () => {
    const { ctx } = buildContext(
      { DISCORD_BOT_TOKEN: 'token' },
      { ok: true, status: 200, body: SAMPLE_CHANNELS },
    );

    const result = await execute({ guildId: '111' }, ctx);
    expect(result.success).toBe(true);

    const res = result.result as { channels: Array<Record<string, unknown>> };
    const general = res.channels.find((ch) => ch.name === 'general');
    expect(general?.topic).toBe('General chat');
  });
});

// ========================================================================
// Request Verification
// ========================================================================

describe('discord-list-channels: request', () => {
  test('uses correct endpoint', async () => {
    const { ctx, calls } = buildContext(
      { DISCORD_BOT_TOKEN: 'token' },
      { ok: true, status: 200, body: [] },
    );

    await execute({ guildId: '111' }, ctx);

    expect(calls[0].url).toBe('https://discord.com/api/v10/guilds/111/channels');
  });

  test('uses GET method', async () => {
    const { ctx, calls } = buildContext(
      { DISCORD_BOT_TOKEN: 'token' },
      { ok: true, status: 200, body: [] },
    );

    await execute({ guildId: '111' }, ctx);

    expect(calls[0].method).toBe('GET');
  });

  test('sends bot token in Authorization header', async () => {
    const { ctx, calls } = buildContext(
      { DISCORD_BOT_TOKEN: 'my-token' },
      { ok: true, status: 200, body: [] },
    );

    await execute({ guildId: '111' }, ctx);

    expect(calls[0].headers['Authorization']).toBe('Bot my-token');
  });
});

// ========================================================================
// Error Handling
// ========================================================================

describe('discord-list-channels: errors', () => {
  test('returns error on 403 forbidden (bot not in guild)', async () => {
    const { ctx } = buildContext(
      { DISCORD_BOT_TOKEN: 'token' },
      { ok: false, status: 403, body: { message: 'Missing Access', code: 50001 } },
    );

    const result = await execute({ guildId: '111' }, ctx);

    expect(result.success).toBe(false);
    expect(result.error).toContain('Missing Access');
    expect(result.error).toContain('50001');
  });

  test('handles fetch throwing (network failure)', async () => {
    const { ctx } = buildContext(
      { DISCORD_BOT_TOKEN: 'token' },
      null,
      new Error('ECONNREFUSED'),
    );

    const result = await execute({ guildId: '111' }, ctx);

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

    const result = await execute({ guildId: '111' }, ctx);

    expect(result.success).toBe(false);
    expect(result.error).toContain('500');
    expect(result.error).toContain('unexpected response format');
  });

  test('handles non-array response body', async () => {
    const { ctx } = buildContext(
      { DISCORD_BOT_TOKEN: 'token' },
      { ok: true, status: 200, body: { not: 'an array' } },
    );

    const result = await execute({ guildId: '111' }, ctx);

    expect(result.success).toBe(false);
    expect(result.error).toContain('Unexpected response format');
  });

  test('throws when DISCORD_BOT_TOKEN is not set', async () => {
    const { ctx } = buildContext({}, { ok: true, status: 200, body: [] });

    const result = await execute({ guildId: '111' }, ctx);

    expect(result.success).toBe(false);
    expect(result.error).toContain('DISCORD_BOT_TOKEN');
  });

  test('does not leak token in error messages', async () => {
    const { ctx } = buildContext(
      { DISCORD_BOT_TOKEN: 'super-secret-token' },
      null,
      new Error('ECONNREFUSED'),
    );

    const result = await execute({ guildId: '111' }, ctx);

    expect(result.success).toBe(false);
    expect(result.error).not.toContain('super-secret-token');
  });
});
