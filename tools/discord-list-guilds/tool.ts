import type { ToolDefinition, ToolContext, ToolResult } from '@capekai/tool';

const DISCORD_API_BASE = 'https://discord.com/api/v10';

export const definition: ToolDefinition = {
  name: 'discord-list-guilds',
  description: 'List Discord servers (guilds) the bot is a member of.\n\nWhen to use:\n- Discovering which servers the bot has access to\n- Finding a guild ID to pass to discord-list-channels\n- Checking bot membership before performing guild actions\n\nWhen NOT to use:\n- Listing channels within a guild (use discord-list-channels instead)\n- Reading messages (use discord-read-messages instead)\n\nParameters: none\n\nNotes:\n- Returns guild id, name, and icon URL for each server\n- Requires a Discord bot token set as DISCORD_BOT_TOKEN env var\n- The bot only sees servers it has been added to',
  inputSchema: {
    type: 'object',
    properties: {},
  },
  timeout: 30000,
  env: [
    'DISCORD_BOT_TOKEN',
  ],
};

interface DiscordGuild {
  id: string;
  name: string;
  icon: string | null;
  owner_id?: string;
  member_count?: number;
  premium_subscription_count?: number;
}

export async function execute(_input: Record<string, never>, ctx: ToolContext): Promise<ToolResult> {
  try {
    const token = ctx.env.require('DISCORD_BOT_TOKEN');

    let response: Response;
    try {
      response = await ctx.fetch(`${DISCORD_API_BASE}/users/@me/guilds`, {
        method: 'GET',
        headers: { 'Authorization': `Bot ${token}` },
      });
    } catch (fetchErr: unknown) {
      const msg = fetchErr instanceof Error ? fetchErr.message : String(fetchErr);
      return { success: false, error: `Failed to reach Discord API: ${msg}` };
    }

    let responseBody: unknown;
    try {
      responseBody = await response.json();
    } catch {
      return {
        success: false,
        error: `Discord API error (${response.status}): unexpected response format`,
      };
    }

    if (!response.ok) {
      const errorMsg = extractDiscordError(responseBody, response.status);
      return { success: false, error: errorMsg };
    }

    const guilds = responseBody as DiscordGuild[];

    if (!Array.isArray(guilds)) {
      return { success: false, error: 'Unexpected response format from Discord API' };
    }

    return {
      success: true,
      result: {
        count: guilds.length,
        guilds: guilds.map((g) => ({
          id: g.id,
          name: g.name,
          iconUrl: g.icon
            ? `https://cdn.discordapp.com/icons/${g.id}/${g.icon}.png`
            : null,
        })),
      },
    };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    ctx.logger.error(`discord-list-guilds failed: ${message}`);
    return { success: false, error: message };
  }
}

function extractDiscordError(body: unknown, status: number): string {
  if (
    body &&
    typeof body === 'object' &&
    'message' in body &&
    typeof (body as { message: unknown }).message === 'string'
  ) {
    const discordError = body as { message: string; code?: number };
    let msg = `Discord API error (${status}): ${discordError.message}`;
    if (discordError.code !== undefined) {
      msg += ` [code: ${discordError.code}]`;
    }
    return msg;
  }
  return `Discord API error (${status})`;
}
