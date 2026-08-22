import type { ToolDefinition, ToolContext, ToolResult } from '@prokopai/sdk';

interface ModifyInput {
  messageIds: string[];
  addLabelIds?: string[];
  removeLabelIds?: string[];
}

export const definition: ToolDefinition = {
  name: 'gmail-modify',
  description:
    'Modify labels on Gmail messages: archive, mark read/unread, star, apply custom labels, or trash.\n\n' +
    'When to use:\n' +
    '- Archiving emails (remove INBOX label)\n' +
    '- Marking emails as read/unread (add/remove UNREAD label)\n' +
    '- Starring emails (add STARRED label)\n' +
    '- Applying or removing custom labels for sorting/organization\n' +
    '- Moving to trash (add TRASH label)\n\n' +
    'When NOT to use:\n' +
    '- Listing available labels (use gmail-labels first)\n' +
    '- Searching emails (use gmail-search)\n\n' +
    'Common label IDs:\n' +
    '- INBOX, UNREAD, STARRED, IMPORTANT, TRASH, SPAM\n' +
    '- CATEGORY_PRIMARY, CATEGORY_PROMOTIONS, CATEGORY_SOCIAL, CATEGORY_UPDATES, CATEGORY_FORUMS\n' +
    '- Custom labels have IDs like "Label_1", "Label_2" (use gmail-labels to list them)\n\n' +
    'Supports batch operations on multiple message IDs at once.\n\n' +
    'Requires: Gmail account connected via Settings > OAuth Providers.',
  inputSchema: {
    type: 'object',
    properties: {
      messageIds: {
        type: 'array',
        items: { type: 'string' },
        description: 'One or more message IDs to modify (from gmail-search or gmail-read results).',
      },
      addLabelIds: {
        type: 'array',
        items: { type: 'string' },
        description: 'Label IDs to add to the messages.',
      },
      removeLabelIds: {
        type: 'array',
        items: { type: 'string' },
        description: 'Label IDs to remove from the messages.',
      },
    },
    required: ['messageIds'],
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

function describeOperation(addLabelIds?: string[], removeLabelIds?: string[]): string {
  const add = addLabelIds || [];
  const remove = removeLabelIds || [];
  const actions: string[] = [];

  if (add.includes('TRASH')) actions.push('Move to TRASH');
  if (remove.includes('INBOX') && !add.includes('TRASH')) actions.push('Archive (remove from Inbox)');
  if (add.includes('STARRED')) actions.push('Star');
  if (remove.includes('STARRED')) actions.push('Unstar');
  if (add.includes('UNREAD')) actions.push('Mark as unread');
  if (remove.includes('UNREAD')) actions.push('Mark as read');
  if (add.includes('IMPORTANT')) actions.push('Mark as important');
  if (remove.includes('IMPORTANT')) actions.push('Remove importance');

  const customAdd = add.filter(l => !['TRASH', 'STARRED', 'UNREAD', 'IMPORTANT', 'SPAM'].includes(l));
  const customRemove = remove.filter(l => !['INBOX', 'STARRED', 'UNREAD', 'IMPORTANT'].includes(l));

  if (customAdd.length > 0) actions.push(`Add labels: ${customAdd.join(', ')}`);
  if (customRemove.length > 0) actions.push(`Remove labels: ${customRemove.join(', ')}`);

  return actions.length > 0 ? actions.join('; ') : 'No changes';
}

export async function execute(input: ModifyInput, ctx: ToolContext): Promise<ToolResult> {
  try {
    if (!input.messageIds || input.messageIds.length === 0) {
      return { success: false, error: 'messageIds is required and must be non-empty.' };
    }
    if (!input.addLabelIds && !input.removeLabelIds) {
      return { success: false, error: 'At least one of addLabelIds or removeLabelIds must be provided.' };
    }

    const addLabels = input.addLabelIds || [];
    const removeLabels = input.removeLabelIds || [];

    const isHighRisk = addLabels.includes('TRASH') || removeLabels.includes('INBOX');

    const operationDesc = describeOperation(addLabels, removeLabels);
    const messageCount = input.messageIds.length;

    const approved = await ctx.ask({
      target: 'permission',
      type: 'permission',
      question: `Gmail: ${operationDesc}`,
      description: `${messageCount} message${messageCount > 1 ? 's' : ''} will be modified.`,
      risk: isHighRisk ? 'high' : 'medium',
      resource: 'gmail',
      action: isHighRisk ? 'high-risk-modify' : 'modify',
    });

    if (!approved) {
      return { success: false, error: 'USER_REJECTION' };
    }

    const accessToken = await readGmailToken(ctx);

    // Gmail supports batch modify (POST /messages/batchModify) for up to 1000 IDs.
    if (input.messageIds.length === 1) {
      // Single message: use individual endpoint for simpler response.
      const messageId = input.messageIds[0];
      const url = `${GMAIL_API_BASE}/messages/${messageId}/modify`;

      const response = await ctx.fetch(url, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          ...(input.addLabelIds && { addLabelIds: input.addLabelIds }),
          ...(input.removeLabelIds && { removeLabelIds: input.removeLabelIds }),
        }),
      });

      if (response.status === 401) {
        return { success: false, error: 'Gmail authorization failed. The access token may be expired. Wait a moment for the background refresh, or reconnect Gmail.' };
      }
      if (!response.ok) {
        const errorText = await response.text().catch(() => 'Unknown error');
        return { success: false, error: `Gmail API error (${response.status}): ${errorText}` };
      }

      return {
        success: true,
        result: {
          modified: 1,
          messageIds: [messageId],
        },
      };
    }

    // Batch modify.
    const url = `${GMAIL_API_BASE}/messages/batchModify`;
    const response = await ctx.fetch(url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        ids: input.messageIds,
        ...(input.addLabelIds && { addLabelIds: input.addLabelIds }),
        ...(input.removeLabelIds && { removeLabelIds: input.removeLabelIds }),
      }),
    });

    if (response.status === 401) {
      return { success: false, error: 'Gmail authorization failed. The access token may be expired. Wait a moment for the background refresh, or reconnect Gmail.' };
    }
    if (!response.ok) {
      const errorText = await response.text().catch(() => 'Unknown error');
      return { success: false, error: `Gmail API error (${response.status}): ${errorText}` };
    }

    return {
      success: true,
      result: {
        modified: input.messageIds.length,
        messageIds: input.messageIds,
      },
    };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    ctx.logger.error(`gmail-modify failed: ${message}`);
    return { success: false, error: message };
  }
}
