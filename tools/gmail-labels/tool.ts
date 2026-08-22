import type { ToolDefinition, ToolContext, ToolResult } from '@prokopai/sdk';

export const definition: ToolDefinition = {
  name: 'gmail-labels',
  description:
    'List all labels in the connected Gmail account, including system labels (INBOX, UNREAD, STARRED, etc.) and user-created labels.\n\n' +
    'When to use:\n' +
    '- Before applying labels with gmail-modify, to get the exact label IDs\n' +
    '- Seeing what labels/categories exist for sorting\n' +
    '- Checking which labels are system vs user-created\n\n' +
    'Returns each label with: id, name, type (system/user), and message counts.\n' +
    'Note: Gmail category tabs (Primary, Social, Promotions, Updates, Forums) are labels like CATEGORY_PROMOTIONS.\n\n' +
    'Requires: Gmail account connected via Settings > OAuth Providers.',
  inputSchema: {
    type: 'object',
    properties: {},
  },
  timeout: 15000,
};

const GMAIL_API_BASE = 'https://gmail.googleapis.com/gmail/v1/users/me';
// Canonical prokopai path first; legacy jean2 fallback while installs migrate.
const TOKEN_FILE_PATHS = ['~/.prokopai/providers/gmail.json', '~/.jean2/providers/gmail.json'];

async function readTokenFromCandidates(ctx: ToolContext): Promise<string> {
  let lastError: unknown = new Error('no token file candidates');
  for (const candidate of TOKEN_FILE_PATHS) {
    try {
      return await ctx.fs.readFile(candidate, 'utf-8');
    } catch (err) {
      lastError = err;
    }
  }
  throw lastError;
}

async function readGmailToken(ctx: ToolContext): Promise<string> {
  let tokenData: string;
  try {
    tokenData = await readTokenFromCandidates(ctx);
  } catch {
    throw new Error('Gmail is not connected. Connect your Gmail account in Settings > OAuth Providers.');
  }
  const token = JSON.parse(tokenData);
  if (!token.access) {
    throw new Error('Gmail token is missing an access token. Try reconnecting Gmail.');
  }
  return token.access;
}

export async function execute(_input: Record<string, unknown>, ctx: ToolContext): Promise<ToolResult> {
  try {
    const accessToken = await readGmailToken(ctx);

    const response = await ctx.fetch(`${GMAIL_API_BASE}/labels`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });

    if (response.status === 401) {
      return { success: false, error: 'Gmail authorization failed. The access token may be expired. Wait a moment for the background refresh, or reconnect Gmail.' };
    }
    if (!response.ok) {
      const errorText = await response.text().catch(() => 'Unknown error');
      return { success: false, error: `Gmail API error (${response.status}): ${errorText}` };
    }

    const data = (await response.json()) as {
      labels?: Array<{
        id: string;
        name: string;
        type?: string;
        messageListVisibility?: string;
        labelListVisibility?: string;
        messagesTotal?: number;
        messagesUnread?: number;
      }>;
    };

    const labels = (data.labels || []).map((label) => ({
      id: label.id,
      name: label.name,
      type: label.type || 'user',
      ...(typeof label.messagesTotal === 'number' && { messagesTotal: label.messagesTotal }),
      ...(typeof label.messagesUnread === 'number' && { messagesUnread: label.messagesUnread }),
    }));

    return {
      success: true,
      result: { count: labels.length, labels },
    };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    ctx.logger.error(`gmail-labels failed: ${message}`);
    return { success: false, error: message };
  }
}
