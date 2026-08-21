import type { ToolDefinition, ToolContext, ToolResult } from '@prokopai/sdk';

interface GmailMessage {
  id: string;
  threadId?: string;
  subject: string;
  from: string;
  to?: string;
  date: string;
  snippet: string;
  labelIds: string[];
  unread: boolean;
}

interface SearchInput {
  query: string;
  maxResults?: number;
  includeBody?: boolean;
}

export const definition: ToolDefinition = {
  name: 'gmail-search',
  description:
    'Search and list emails from the connected Gmail account.\n\n' +
    'When to use:\n' +
    '- Finding emails by keyword, sender, date, or other criteria\n' +
    '- Listing recent inbox messages\n' +
    '- Checking for unread emails or emails with specific labels\n\n' +
    'When NOT to use:\n' +
    '- Reading the full body of a specific known message (use gmail-read instead)\n\n' +
    'The query parameter supports Gmail search operators. Examples:\n' +
    '- "is:unread" - unread emails\n' +
    '- "from:someone@example.com" - emails from a specific sender\n' +
    '- "subject:invoice" - emails with a keyword in the subject\n' +
    '- "newer_than:7d" - emails from the last 7 days\n' +
    '- "has:attachment" - emails with attachments\n' +
    '- "label:work" - emails with a specific label\n' +
    '- "category:primary" - only primary inbox\n' +
    '- "-category:promotions" - exclude promotions\n' +
    '- "category:social" - social updates only\n' +
    '- "in:inbox category:updates" - inbox updates tab\n' +
    '- "" (empty) - all recent emails\n\n' +
    'Requires: Gmail account connected via Settings > OAuth Providers.',
  inputSchema: {
    type: 'object',
    properties: {
      query: {
        type: 'string',
        description:
          'Gmail search query. Use "" or "in:inbox" for recent inbox emails. Supports Gmail operators like from:, subject:, is:unread, newer_than:, has:attachment, label:.',
      },
      maxResults: {
        type: 'number',
        description: 'Maximum number of results to return (default: 10, max: 50)',
      },
      includeBody: {
        type: 'boolean',
        description: 'If true, include the plain text body of each email (default: false). Use sparingly as it increases response size.',
      },
    },
    required: ['query'],
  },
  timeout: 30000,
};

const GMAIL_API_BASE = 'https://gmail.googleapis.com/gmail/v1/users/me';
const TOKEN_FILE_PATH = '~/.jean2/providers/gmail.json';

interface StoredToken {
  access: string;
  expires: number;
  email?: string;
}

async function readGmailToken(ctx: ToolContext): Promise<StoredToken> {
  let tokenData: string;
  try {
    tokenData = await ctx.fs.readFile(TOKEN_FILE_PATH, 'utf-8');
  } catch {
    throw new Error(
      'Gmail is not connected. Connect your Gmail account in Settings > OAuth Providers.',
    );
  }

  let token: StoredToken;
  try {
    token = JSON.parse(tokenData);
  } catch {
    throw new Error('Gmail token file is corrupted. Try disconnecting and reconnecting Gmail.');
  }

  if (!token.access) {
    throw new Error('Gmail token is missing an access token. Try reconnecting Gmail.');
  }

  // The background refresh timer on the server keeps the token fresh.
  // If the token is expired (server was off for a long time), warn but still try.
  if (token.expires && token.expires < Date.now()) {
    ctx.logger.warn('Gmail access token appears expired. The server background refresh should update it shortly.');
  }

  return token;
}

function extractHeaderValue(
  headers: Array<{ name: string; value: string }>,
  name: string,
): string {
  const header = headers.find((h) => h.name.toLowerCase() === name.toLowerCase());
  return header?.value || '';
}

function parseMessage(
  msg: {
    id: string;
    threadId?: string;
    snippet?: string;
    labelIds?: string[];
    payload?: {
      headers?: Array<{ name: string; value: string }>;
      body?: { data?: string };
      parts?: Array<{ mimeType: string; body?: { data?: string } }>;
    };
  },
  includeBody: boolean,
): GmailMessage {
  const headers = msg.payload?.headers || [];
  const subject = extractHeaderValue(headers, 'Subject');
  const from = extractHeaderValue(headers, 'From');
  const to = extractHeaderValue(headers, 'To');
  const date = extractHeaderValue(headers, 'Date');
  const labelIds = msg.labelIds || [];
  const unread = labelIds.includes('UNREAD');

  let body: string | undefined;
  if (includeBody && msg.payload) {
    // Try plain text part first, then fall back to the main body.
    const textPart = msg.payload.parts?.find((p) => p.mimeType === 'text/plain');
    const bodyData = textPart?.body?.data || msg.payload.body?.data;
    if (bodyData) {
      try {
        body = Buffer.from(bodyData, 'base64url').toString('utf-8');
      } catch {
        // Body decoding failure is non-fatal.
      }
    }
  }

  return {
    id: msg.id,
    ...(msg.threadId && { threadId: msg.threadId }),
    subject,
    from,
    ...(to && { to }),
    date,
    snippet: msg.snippet || '',
    labelIds,
    unread,
    ...(body && { body }),
  };
}

export async function execute(input: SearchInput, ctx: ToolContext): Promise<ToolResult> {
  try {
    const token = await readGmailToken(ctx);
    const maxResults = Math.min(Math.max(input.maxResults ?? 10, 1), 50);
    const includeBody = input.includeBody ?? false;

    // Step 1: List messages matching the query.
    const listUrl = new URL(`${GMAIL_API_BASE}/messages`);
    listUrl.searchParams.set('maxResults', String(maxResults));
    if (input.query) {
      listUrl.searchParams.set('q', input.query);
    }

    const listResponse = await ctx.fetch(listUrl.toString(), {
      headers: { Authorization: `Bearer ${token.access}` },
    });

    if (listResponse.status === 401) {
      return {
        success: false,
        error:
          'Gmail authorization failed. The access token may be expired. Wait a moment for the background refresh to update it, or reconnect Gmail.',
      };
    }

    if (!listResponse.ok) {
      const errorText = await listResponse.text().catch(() => 'Unknown error');
      return { success: false, error: `Gmail API error (${listResponse.status}): ${errorText}` };
    }

    const listData = (await listResponse.json()) as {
      messages?: Array<{ id: string; threadId?: string }>;
      resultSizeEstimate?: number;
    };

    if (!listData.messages || listData.messages.length === 0) {
      return {
        success: true,
        result: {
          query: input.query,
          count: 0,
          messages: [],
        },
      };
    }

    // Step 2: Fetch metadata for each message.
    // We use format=metadata with relevant headers to keep payloads small.
    // If includeBody is true, we fetch full payload instead.
    const format = includeBody ? 'full' : 'metadata';
    const metaHeaders = ['Subject', 'From', 'To', 'Date'];

    const messagePromises = listData.messages.map(async (msg) => {
      const detailUrl = new URL(`${GMAIL_API_BASE}/messages/${msg.id}`);
      detailUrl.searchParams.set('format', format);
      if (!includeBody) {
        detailUrl.searchParams.set('metadataHeaders', metaHeaders.join(','));
      }

      const detailResponse = await ctx.fetch(detailUrl.toString(), {
        headers: { Authorization: `Bearer ${token.access}` },
      });

      if (!detailResponse.ok) {
        ctx.logger.warn(`Failed to fetch message ${msg.id}: ${detailResponse.status}`);
        return null;
      }

      const detail = (await detailResponse.json()) as {
        id: string;
        threadId?: string;
        snippet?: string;
        labelIds?: string[];
        payload?: {
          headers?: Array<{ name: string; value: string }>;
          body?: { data?: string };
          parts?: Array<{ mimeType: string; body?: { data?: string } }>;
        };
      };
      return parseMessage(detail, includeBody);
    });

    const results = await Promise.all(messagePromises);
    const messages = results.filter((m): m is GmailMessage => m !== null);

    return {
      success: true,
      result: {
        query: input.query,
        count: messages.length,
        messages,
      },
    };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    ctx.logger.error(`gmail-search failed: ${message}`);
    return { success: false, error: message };
  }
}
