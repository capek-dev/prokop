import type { ToolDefinition, ToolContext, ToolResult } from '@capekai/tool';

interface ReadMessagesInput {
  channelId?: string;
  limit?: number;
  before?: string;
  after?: string;
  around?: string;
}

const DISCORD_API_BASE = 'https://discord.com/api/v10';
const MAX_LIMIT = 100;

export const definition: ToolDefinition = {
  name: 'discord-read-messages',
  description: 'Read message history from a Discord channel via bot token.\n\nWhen to use:\n- Reading recent messages from a channel for context or summarization\n- Reviewing conversations before responding\n- Extracting information discussed in a channel\n- Monitoring a channel for specific content\n\nWhen NOT to use:\n- Sending messages (use discord-send-message instead)\n- Searching across an entire guild (use the search endpoint instead)\n- Real-time message monitoring (this is a polling tool, not a Gateway connection)\n\nParameters:\n- channelId (optional): The Discord channel ID to read from. Falls back to DISCORD_DEFAULT_CHANNEL_ID env var if not provided.\n- limit (optional): Number of messages to retrieve (1-100, default 50)\n- before (optional): Get messages before this message ID (for backward pagination)\n- after (optional): Get messages after this message ID (for forward pagination)\n- around (optional): Get messages around this message ID (limit must be <= 100, returns limit messages centered around this ID)\n\nNotes:\n- Messages are returned newest-first (Discord default)\n- Requires a Discord bot token set as DISCORD_BOT_TOKEN env var\n- The bot must have READ_MESSAGE_HISTORY and VIEW_CHANNELS permissions in the target channel\n- The MESSAGE_CONTENT privileged intent must be enabled, or message content will be empty for messages from other users\n- To find channel IDs, enable Developer Mode in Discord (Settings > Advanced > Developer Mode), then right-click a channel and select "Copy ID"',
  inputSchema: {
    type: 'object',
    properties: {
      channelId: {
        type: 'string',
        description: 'Discord channel ID to read messages from. Falls back to DISCORD_DEFAULT_CHANNEL_ID env var.',
      },
      limit: {
        type: 'integer',
        description: 'Number of messages to retrieve (1-100, default 50)',
        minimum: 1,
        maximum: MAX_LIMIT,
      },
      before: {
        type: 'string',
        description: 'Get messages before this message ID (backward pagination)',
      },
      after: {
        type: 'string',
        description: 'Get messages after this message ID (forward pagination)',
      },
      around: {
        type: 'string',
        description: 'Get messages around this message ID',
      },
    },
  },
  timeout: 30000,
  env: [
    'DISCORD_BOT_TOKEN',
    'DISCORD_DEFAULT_CHANNEL_ID',
  ],
};

interface DiscordAttachment {
  id: string;
  filename: string;
  url: string;
  contentType?: string;
  size: number;
}

interface DiscordReaction {
  emoji: { name: string; id?: string };
  count: number;
}

interface DiscordAuthor {
  id: string;
  username: string;
  global_name?: string;
  bot?: boolean;
}

interface DiscordMessage {
  id: string;
  channel_id: string;
  author: DiscordAuthor;
  content: string;
  timestamp: string;
  edited_timestamp: string | null;
  attachments?: DiscordAttachment[];
  embeds?: unknown[];
  reactions?: DiscordReaction[];
  type: number;
  referenced_message?: DiscordMessage | null;
  mention_everyone?: boolean;
  pinned?: boolean;
}

function mapMessage(msg: DiscordMessage) {
  const result: Record<string, unknown> = {
    id: msg.id,
    author: msg.author?.global_name || msg.author?.username || 'Unknown',
    authorId: msg.author?.id,
    content: msg.content || '',
    timestamp: msg.timestamp,
    editedTimestamp: msg.edited_timestamp,
    pinned: msg.pinned ?? false,
  };

  if (msg.attachments?.length) {
    result.attachments = msg.attachments.map((a) => ({
      filename: a.filename,
      url: a.url,
      contentType: a.contentType,
      size: a.size,
    }));
  }

  if (msg.reactions?.length) {
    result.reactions = msg.reactions.map((r) => ({
      emoji: r.emoji.name,
      count: r.count,
    }));
  }

  if (msg.referenced_message) {
    result.replyTo = msg.referenced_message.author?.global_name || msg.referenced_message.author?.username;
    result.replyToContent = msg.referenced_message.content?.slice(0, 200) || '';
  }

  return result;
}

export async function execute(input: ReadMessagesInput, ctx: ToolContext): Promise<ToolResult> {
  try {
    const token = ctx.env.require('DISCORD_BOT_TOKEN');
    const channelId = input.channelId || ctx.env.get('DISCORD_DEFAULT_CHANNEL_ID');

    if (!channelId) {
      return {
        success: false,
        error: 'No channel ID provided. Set channelId parameter or DISCORD_DEFAULT_CHANNEL_ID env var.',
      };
    }

    const params = new URLSearchParams();
    const limit = input.limit ?? 50;
    params.set('limit', String(Math.min(Math.max(limit, 1), MAX_LIMIT)));
    if (input.before) params.set('before', input.before);
    if (input.after) params.set('after', input.after);
    if (input.around) params.set('around', input.around);

    let response: Response;
    try {
      response = await ctx.fetch(
        `${DISCORD_API_BASE}/channels/${channelId}/messages?${params}`,
        {
          method: 'GET',
          headers: { 'Authorization': `Bot ${token}` },
        },
      );
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

    const messages = responseBody as DiscordMessage[];

    if (!Array.isArray(messages)) {
      return { success: false, error: 'Unexpected response format from Discord API' };
    }

    return {
      success: true,
      result: {
        channelId,
        count: messages.length,
        messages: messages.map(mapMessage),
      },
    };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    ctx.logger.error(`discord-read-messages failed: ${message}`);
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
