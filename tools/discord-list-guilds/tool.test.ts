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

const SAMPLE_GUILDS = [
  { id: '111', name: 'My Server', icon: 'abc123', owner_id: '1' },
  { id: '222', name: 'Another Server', icon: null, owner_id: '2' },
];

// ========================================================================
// Tool Definition
// ========================================================================

describe('discord-list-guilds: definition', () => {
  test('has correct name', () => {
    expect(definition.name).toBe('discord-list-guilds');
  });

  test('declares DISCORD_BOT_TOKEN env var', () => {
    expect(definition.env).toContain('DISCORD_BOT_TOKEN');
  });

  test('has timeout set', () => {
    expect(definition.timeout).toBe(30000);
  });

  test('input schema has no required properties', () => {
    const schema = definition.inputSchema as { properties: Record<string, unknown>; required?: string[] };
    expect(schema.properties).toEqual({});
    expect(schema.required ?? []).toHaveLength(0);
  });
});

// ========================================================================
// Listing Guilds
// ========================================================================

describe('discord-list-guilds: listing', () => {
  test('lists guilds successfully', async () => {
    const { ctx } = buildContext(
      { DISCORD_BOT_TOKEN: 'token' },
      { ok: true, status: 200, body: SAMPLE_GUILDS },
    );

    const result = await execute({}, ctx);

    expect(result.success).toBe(true);
    const res = result.result as { count: number; guilds: Array<{ id: string; name: string; iconUrl: string | null }> };
    expect(res.count).toBe(2);
    expect(res.guilds[0].id).toBe('111');
    expect(res.guilds[0].name).toBe('My Server');
    expect(res.guilds[0].iconUrl).toBe('https://cdn.discordapp.com/icons/111/abc123.png');
  });

  test('returns null iconUrl when guild has no icon', async () => {
    const { ctx } = buildContext(
      { DISCORD_BOT_TOKEN: 'token' },
      { ok: true, status: 200, body: [SAMPLE_GUILDS[1]] },
    );

    const result = await execute({}, ctx);

    expect(result.success).toBe(true);
    const res = result.result as { guilds: Array<{ iconUrl: string | null }> };
    expect(res.guilds[0].iconUrl).toBeNull();
  });

  test('returns empty array when bot is in no guilds', async () => {
    const { ctx } = buildContext(
      { DISCORD_BOT_TOKEN: 'token' },
      { ok: true, status: 200, body: [] },
    );

    const result = await execute({}, ctx);

    expect(result.success).toBe(true);
    const res = result.result as { count: number };
    expect(res.count).toBe(0);
  });
});

// ========================================================================
// Request Verification
// ========================================================================

describe('discord-list-guilds: request', () => {
  test('uses correct endpoint', async () => {
    const { ctx, calls } = buildContext(
      { DISCORD_BOT_TOKEN: 'token' },
      { ok: true, status: 200, body: [] },
    );

    await execute({}, ctx);

    expect(calls[0].url).toBe('https://discord.com/api/v10/users/@me/guilds');
  });

  test('uses GET method', async () => {
    const { ctx, calls } = buildContext(
      { DISCORD_BOT_TOKEN: 'token' },
      { ok: true, status: 200, body: [] },
    );

    await execute({}, ctx);

    expect(calls[0].method).toBe('GET');
  });

  test('sends bot token in Authorization header', async () => {
    const { ctx, calls } = buildContext(
      { DISCORD_BOT_TOKEN: 'my-token' },
      { ok: true, status: 200, body: [] },
    );

    await execute({}, ctx);

    expect(calls[0].headers['Authorization']).toBe('Bot my-token');
  });
});

// ========================================================================
// Error Handling
// ========================================================================

describe('discord-list-guilds: errors', () => {
  test('returns error on 401 unauthorized', async () => {
    const { ctx } = buildContext(
      { DISCORD_BOT_TOKEN: 'bad-token' },
      { ok: false, status: 401, body: { message: '401: Unauthorized', code: 0 } },
    );

    const result = await execute({}, ctx);

    expect(result.success).toBe(false);
    expect(result.error).toContain('401');
    expect(result.error).toContain('Unauthorized');
  });

  test('handles fetch throwing (network failure)', async () => {
    const { ctx } = buildContext(
      { DISCORD_BOT_TOKEN: 'token' },
      null,
      new Error('ECONNREFUSED'),
    );

    const result = await execute({}, ctx);

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

    const result = await execute({}, ctx);

    expect(result.success).toBe(false);
    expect(result.error).toContain('500');
    expect(result.error).toContain('unexpected response format');
  });

  test('handles non-array response body', async () => {
    const { ctx } = buildContext(
      { DISCORD_BOT_TOKEN: 'token' },
      { ok: true, status: 200, body: { not: 'an array' } },
    );

    const result = await execute({}, ctx);

    expect(result.success).toBe(false);
    expect(result.error).toContain('Unexpected response format');
  });

  test('throws when DISCORD_BOT_TOKEN is not set', async () => {
    const { ctx } = buildContext({}, { ok: true, status: 200, body: [] });

    const result = await execute({}, ctx);

    expect(result.success).toBe(false);
    expect(result.error).toContain('DISCORD_BOT_TOKEN');
  });

  test('does not leak token in error messages', async () => {
    const { ctx } = buildContext(
      { DISCORD_BOT_TOKEN: 'super-secret-token' },
      null,
      new Error('ECONNREFUSED'),
    );

    const result = await execute({}, ctx);

    expect(result.success).toBe(false);
    expect(result.error).not.toContain('super-secret-token');
  });
});
