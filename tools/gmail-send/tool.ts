import type { ToolDefinition, ToolContext, ToolResult } from '@prokopai/sdk';

interface SendInput {
  to: string;
  subject: string;
  body: string;
  cc?: string;
  bcc?: string;
  replyToMessageId?: string;
}

export const definition: ToolDefinition = {
  name: 'gmail-send',
  description:
    'Send an email from the connected Gmail account. This is a HIGH RISK action that requires explicit user approval before sending.\n\n' +
    'When to use:\n' +
    '- Sending a new email\n' +
    '- Replying to a message (provide replyToMessageId to set In-Reply-To and References headers)\n\n' +
    'When NOT to use:\n' +
    '- Creating a draft for the user to review (use gmail-draft instead)\n\n' +
    'The tool will ALWAYS ask for user confirmation before sending, showing the recipient, subject, and body.\n\n' +
    'Requires: Gmail account connected via Settings > OAuth Providers.',
  inputSchema: {
    type: 'object',
    properties: {
      to: {
        type: 'string',
        description: 'Recipient email address(es). Comma-separated for multiple recipients.',
      },
      subject: {
        type: 'string',
        description: 'Email subject line.',
      },
      body: {
        type: 'string',
        description: 'Email body content (plain text).',
      },
      cc: {
        type: 'string',
        description: 'CC recipient(s). Comma-separated for multiple.',
      },
      bcc: {
        type: 'string',
        description: 'BCC recipient(s). Comma-separated for multiple.',
      },
      replyToMessageId: {
        type: 'string',
        description: 'Message ID being replied to (sets threading headers: In-Reply-To, References).',
      },
    },
    required: ['to', 'subject', 'body'],
  },
  timeout: 30000,
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

async function getMessageHeadersForReply(
  accessToken: string,
  messageId: string,
  fetchFn: typeof globalThis.fetch,
): Promise<{ messageIdHeader?: string; references?: string; subject?: string }> {
  const url = new URL(`${GMAIL_API_BASE}/messages/${messageId}`);
  url.searchParams.set('format', 'metadata');
  url.searchParams.set('metadataHeaders', 'Message-Id');
  url.searchParams.set('metadataHeaders', 'Subject');
  url.searchParams.set('metadataHeaders', 'References');

  const response = await fetchFn(url.toString(), {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!response.ok) {
    throw new Error(`Failed to fetch reply-to message ${messageId}: ${response.status}`);
  }

  const data = (await response.json()) as {
    payload?: {
      headers?: Array<{ name: string; value: string }>;
    };
  };

  const headers = data.payload?.headers || [];
  return {
    messageIdHeader: headers.find((h) => h.name.toLowerCase() === 'message-id')?.value,
    references: headers.find((h) => h.name.toLowerCase() === 'references')?.value,
    subject: headers.find((h) => h.name.toLowerCase() === 'subject')?.value,
  };
}

function buildRfc2822Message(
  to: string,
  subject: string,
  body: string,
  cc?: string,
  bcc?: string,
  replyHeaders?: { messageIdHeader?: string; references?: string; subject?: string },
): string {
  const lines: string[] = [
    `To: ${to}`,
    `Subject: ${subject}`,
  ];

  if (cc) lines.push(`Cc: ${cc}`);
  if (bcc) lines.push(`Bcc: ${bcc}`);

  if (replyHeaders?.messageIdHeader) {
    lines.push(`In-Reply-To: ${replyHeaders.messageIdHeader}`);
    const refs = replyHeaders.references
      ? `${replyHeaders.references} ${replyHeaders.messageIdHeader}`
      : replyHeaders.messageIdHeader;
    lines.push(`References: ${refs}`);
  }

  lines.push('Content-Type: text/plain; charset=UTF-8');
  lines.push('Content-Transfer-Encoding: 8bit');
  lines.push('');
  lines.push(body);

  return lines.join('\r\n');
}

export async function execute(input: SendInput, ctx: ToolContext): Promise<ToolResult> {
  try {
    const accessToken = await readGmailToken(ctx);

    // Fetch original message headers for reply threading.
    let replyHeaders: { messageIdHeader?: string; references?: string; subject?: string } | undefined;
    if (input.replyToMessageId) {
      try {
        replyHeaders = await getMessageHeadersForReply(accessToken, input.replyToMessageId, ctx.fetch);
      } catch (err: unknown) {
        ctx.logger.warn(`Could not fetch reply-to message: ${err instanceof Error ? err.message : String(err)}`);
      }
    }

    // Build the email preview for approval.
    const previewSubject = replyHeaders?.subject && replyHeaders.subject.toLowerCase().startsWith('re:')
      ? replyHeaders.subject
      : input.subject;

    const previewBody = [
      `To: ${input.to}`,
      ...(input.cc ? [`Cc: ${input.cc}`] : []),
      `Subject: ${previewSubject}`,
      '',
      input.body,
    ].join('\n');

    // HIGH RISK: Ask for explicit permission before sending.
    const approved = await ctx.ask({
      target: 'human',
      type: 'confirm',
      question: 'Send this email?',
      description: previewBody,
      defaultValue: false,
    });

    if (!approved) {
      return { success: false, error: 'USER_REJECTION' };
    }

    // Build RFC 2822 message.
    const rawMessage = buildRfc2822Message(
      input.to,
      previewSubject,
      input.body,
      input.cc,
      input.bcc,
      replyHeaders,
    );
    const encoded = Buffer.from(rawMessage, 'utf-8').toString('base64url');

    const response = await ctx.fetch(`${GMAIL_API_BASE}/messages/send`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ raw: encoded }),
    });

    if (response.status === 401) {
      return { success: false, error: 'Gmail authorization failed. The access token may be expired. Wait a moment for the background refresh, or reconnect Gmail.' };
    }
    if (!response.ok) {
      const errorText = await response.text().catch(() => 'Unknown error');
      return { success: false, error: `Gmail API error (${response.status}): ${errorText}` };
    }

    const data = (await response.json()) as { id: string; threadId?: string; labelIds?: string[] };

    return {
      success: true,
      result: {
        messageId: data.id,
        ...(data.threadId && { threadId: data.threadId }),
        sent: true,
      },
    };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    ctx.logger.error(`gmail-send failed: ${message}`);
    return { success: false, error: message };
  }
}
