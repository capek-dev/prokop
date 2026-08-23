import type { ToolDefinition, ToolContext, ToolResult } from '@capekai/tool';

interface ListChannelsInput {
  guildId?: string;
}

const DISCORD_API_BASE = 'https://discord.com/api/v10';

const CHANNEL_TYPES: Record<number, string> = {
  0: 'text',
  2: 'voice',
  4: 'category',
  5: 'announcement',
  10: 'thread',
  13: 'stage',
  15: 'forum',
};

export const definition: ToolDefinition = {
  name: 'discord-list-channels',
  description: 'List channels in a Discord server (guild) via bot token.\n\nWhen to use:\n- Discovering channel IDs within a specific server\n- Finding the right channel to send messages to or read from\n- Understanding the channel structure of a server\n\nWhen NOT to use:\n- Listing servers the bot is in (use discord-list-guilds instead)\n- Reading messages from a channel (use discord-read-messages instead)\n\nParameters:\n- guildId (optional): The Discord server (guild) ID. Falls back to DISCORD_DEFAULT_GUILD_ID env var if not provided.\n\nNotes:\n- Returns channel id, name, type (text/voice/category/etc.), and category name for each channel\n- Requires a Discord bot token set as DISCORD_BOT_TOKEN env var\n- The bot must have VIEW_CHANNELS permission in the target guild\n- To find guild IDs, use discord-list-guilds or enable Developer Mode in Discord (Settings > Advanced > Developer Mode), then right-click a server and select "Copy ID"',
  inputSchema: {
    type: 'object',
    properties: {
      guildId: {
        type: 'string',
        description: 'Discord server (guild) ID. Falls back to DISCORD_DEFAULT_GUILD_ID env var.',
      },
    },
  },
  timeout: 30000,
  env: [
    'DISCORD_BOT_TOKEN',
    'DISCORD_DEFAULT_GUILD_ID',
  ],
};

interface DiscordChannel {
  id: string;
  name: string;
  type: number;
  parent_id: string | null;
  topic?: string | null;
  position?: number;
  nsfw?: boolean;
}

export async function execute(input: ListChannelsInput, ctx: ToolContext): Promise<ToolResult> {
  try {
    const token = ctx.env.require('DISCORD_BOT_TOKEN');
    const guildId = input.guildId || ctx.env.get('DISCORD_DEFAULT_GUILD_ID');

    if (!guildId) {
      return {
        success: false,
        error: 'No guild ID provided. Set guildId parameter or DISCORD_DEFAULT_GUILD_ID env var.',
      };
    }

    let response: Response;
    try {
      response = await ctx.fetch(`${DISCORD_API_BASE}/guilds/${guildId}/channels`, {
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

    const channels = responseBody as DiscordChannel[];

    if (!Array.isArray(channels)) {
      return { success: false, error: 'Unexpected response format from Discord API' };
    }

    const categoryMap = new Map<string, string>();
    for (const ch of channels) {
      if (ch.type === 4 && ch.name) {
        categoryMap.set(ch.id, ch.name);
      }
    }

    return {
      success: true,
      result: {
        guildId,
        count: channels.length,
        channels: channels.map((ch) => ({
          id: ch.id,
          name: ch.name,
          type: CHANNEL_TYPES[ch.type] ?? `unknown(${ch.type})`,
          category: ch.parent_id ? (categoryMap.get(ch.parent_id) ?? null) : null,
          topic: ch.topic ?? null,
        })),
      },
    };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    ctx.logger.error(`discord-list-channels failed: ${message}`);
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
