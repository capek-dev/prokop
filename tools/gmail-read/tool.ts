import type { ToolDefinition, ToolContext, ToolResult } from '@prokopai/sdk';

interface ReadInput {
  messageId?: string;
  threadId?: string;
}

interface GmailHeader {
  name: string;
  value: string;
}

interface AttachmentInfo {
  filename: string;
  mimeType: string;
  size: number;
  attachmentId: string;
}

interface ReadMessage {
  id: string;
  threadId?: string;
  subject: string;
  from: string;
  to: string;
  cc?: string;
  date: string;
  snippet: string;
  body: string;
  html?: string;
  attachments: AttachmentInfo[];
  labelIds: string[];
  unread: boolean;
}

interface MessagePayload {
  mimeType?: string;
  filename?: string;
  headers?: GmailHeader[];
  body?: { data?: string; size?: number; attachmentId?: string };
  parts?: MessagePayload[];
}

export const definition: ToolDefinition = {
  name: 'gmail-read',
  description:
    'Read the full content of a Gmail message or an entire email thread.\n\n' +
    'When to use:\n' +
    '- Reading the full body of a specific message (after finding it via gmail-search)\n' +
    '- Reading all messages in a thread (previous replies + latest)\n' +
    '- Getting attachment metadata (filename, size, type)\n\n' +
    'When NOT to use:\n' +
    '- Searching/listing emails (use gmail-search instead)\n\n' +
    'Provide either messageId (single message) or threadId (entire thread).\n' +
    'For threads, returns all messages in chronological order.\n\n' +
    'Requires: Gmail account connected via Settings > OAuth Providers.',
  inputSchema: {
    type: 'object',
    properties: {
      messageId: {
        type: 'string',
        description: 'The ID of a specific message to read (from gmail-search results).',
      },
      threadId: {
        type: 'string',
        description: 'The ID of a thread to read in full. Returns all messages in the thread.',
      },
    },
  },
  timeout: 30000,
};

const GMAIL_API_BASE = 'https://gmail.googleapis.com/gmail/v1/users/me';
const TOKEN_FILE_PATH = '~/.jean2/providers/gmail.json';

async function readGmailToken(ctx: ToolContext): Promise<string> {
  let tokenData: string;
  try {
    tokenData = await ctx.fs.readFile(TOKEN_FILE_PATH, 'utf-8');
  } catch {
    throw new Error('Gmail is not connected. Connect your Gmail account in Settings > OAuth Providers.');
  }
  const token = JSON.parse(tokenData);
  if (!token.access) {
    throw new Error('Gmail token is missing an access token. Try reconnecting Gmail.');
  }
  return token.access;
}

function getHeader(headers: GmailHeader[], name: string): string {
  return headers.find((h) => h.name.toLowerCase() === name.toLowerCase())?.value || '';
}

function decodeBase64Url(data: string): string {
  try {
    return Buffer.from(data, 'base64url').toString('utf-8');
  } catch {
    return '';
  }
}

function findPartByMimeType(payload: MessagePayload, mimeType: string): MessagePayload | undefined {
  if (payload.mimeType === mimeType && payload.body?.data) {
    return payload;
  }
  if (payload.parts) {
    for (const part of payload.parts) {
      const found = findPartByMimeType(part, mimeType);
      if (found) return found;
    }
  }
  return undefined;
}

function extractAttachments(payload: MessagePayload | undefined): AttachmentInfo[] {
  const attachments: AttachmentInfo[] = [];
  if (!payload) return attachments;

  function walk(part: MessagePayload): void {
    if (part.filename || (part.body?.attachmentId && part.body?.size && part.body.size > 0)) {
      if (part.filename) {
        attachments.push({
          filename: part.filename,
          mimeType: part.mimeType || 'application/octet-stream',
          size: part.body?.size || 0,
          attachmentId: part.body?.attachmentId || '',
        });
      }
      return;
    }
    if (part.parts) {
      for (const subPart of part.parts) {
        walk(subPart);
      }
    }
  }

  if (payload.parts) {
    for (const part of payload.parts) {
      walk(part);
    }
  }
  return attachments;
}

function parseMessage(msg: {
  id: string;
  threadId?: string;
  snippet?: string;
  labelIds?: string[];
  payload?: MessagePayload;
}): ReadMessage {
  const headers = msg.payload?.headers || [];
  const attachments = extractAttachments(msg.payload);

  const textPart = msg.payload ? findPartByMimeType(msg.payload, 'text/plain') : undefined;
  const plainBody = textPart?.body?.data ? decodeBase64Url(textPart.body.data) : '';

  const htmlPart = msg.payload ? findPartByMimeType(msg.payload, 'text/html') : undefined;
  const htmlBody = htmlPart?.body?.data ? decodeBase64Url(htmlPart.body.data) : undefined;

  const body = plainBody || (msg.payload?.body?.data ? decodeBase64Url(msg.payload.body.data) : '');

  return {
    id: msg.id,
    ...(msg.threadId && { threadId: msg.threadId }),
    subject: getHeader(headers, 'Subject'),
    from: getHeader(headers, 'From'),
    to: getHeader(headers, 'To'),
    ...(getHeader(headers, 'Cc') && { cc: getHeader(headers, 'Cc') }),
    date: getHeader(headers, 'Date'),
    snippet: msg.snippet || '',
    body,
    ...(htmlBody && { html: htmlBody }),
    attachments,
    labelIds: msg.labelIds || [],
    unread: (msg.labelIds || []).includes('UNREAD'),
  };
}

export async function execute(input: ReadInput, ctx: ToolContext): Promise<ToolResult> {
  try {
    if (!input.messageId && !input.threadId) {
      return { success: false, error: 'Either messageId or threadId is required.' };
    }

    const accessToken = await readGmailToken(ctx);

    if (input.threadId) {
      const url = new URL(`${GMAIL_API_BASE}/threads/${input.threadId}`);
      url.searchParams.set('format', 'full');

      const response = await ctx.fetch(url.toString(), {
        headers: { Authorization: `Bearer ${accessToken}` },
      });

      if (response.status === 401) {
        return { success: false, error: 'Gmail authorization failed. The access token may be expired. Wait a moment for the background refresh, or reconnect Gmail.' };
      }
      if (!response.ok) {
        const errorText = await response.text().catch(() => 'Unknown error');
        return { success: false, error: `Gmail API error (${response.status}): ${errorText}` };
      }

      const thread = (await response.json()) as {
        id: string;
        messages?: Array<{ id: string; threadId?: string; snippet?: string; labelIds?: string[]; payload?: MessagePayload }>;
      };

      if (!thread.messages || thread.messages.length === 0) {
        return { success: false, error: 'Thread is empty or not found.' };
      }

      const messages = thread.messages.map(parseMessage);

      return {
        success: true,
        result: {
          threadId: thread.id,
          count: messages.length,
          messages,
        },
      };
    }

    const url = new URL(`${GMAIL_API_BASE}/messages/${input.messageId}`);
    url.searchParams.set('format', 'full');

    const response = await ctx.fetch(url.toString(), {
      headers: { Authorization: `Bearer ${accessToken}` },
    });

    if (response.status === 401) {
      return { success: false, error: 'Gmail authorization failed. The access token may be expired. Wait a moment for the background refresh, or reconnect Gmail.' };
    }
    if (!response.ok) {
      const errorText = await response.text().catch(() => 'Unknown error');
      return { success: false, error: `Gmail API error (${response.status}): ${errorText}` };
    }

    const msg = (await response.json()) as {
      id: string;
      threadId?: string;
      snippet?: string;
      labelIds?: string[];
      payload?: MessagePayload;
    };

    return {
      success: true,
      result: parseMessage(msg),
    };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    ctx.logger.error(`gmail-read failed: ${message}`);
    return { success: false, error: message };
  }
}
