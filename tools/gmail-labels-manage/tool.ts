import type { ToolDefinition, ToolContext, ToolResult } from '@prokopai/sdk';

interface ManageInput {
  action: 'create' | 'update' | 'delete';
  /** Name for a new label, or new name when renaming. Required for create. */
  name?: string;
  /** Label ID to update or delete. Required for update/delete. */
  labelId?: string;
}

export const definition: ToolDefinition = {
  name: 'gmail-labels-manage',
  description:
    'Create, rename, or delete Gmail labels. Use this to set up a label structure for organizing emails.\n\n' +
    'When to use:\n' +
    '- Creating a new label (e.g. "Bills", "Travel", "Action Required")\n' +
    '- Renaming an existing label\n' +
    '- Deleting a label you no longer need\n\n' +
    'When NOT to use:\n' +
    '- Listing existing labels (use gmail-labels)\n' +
    '- Applying labels to messages (use gmail-modify)\n\n' +
    'Operations:\n' +
    '- create: Makes a new label. Requires name.\n' +
    '- update: Renames a label. Requires labelId and name.\n' +
    '- delete: Permanently removes a label from ALL messages. Requires labelId.\n\n' +
    'Risk levels:\n' +
    '- create: low risk (no data affected)\n' +
    '- update: medium risk (renames affect all messages with that label)\n' +
    '- delete: high risk (removes the label from every message that had it)\n\n' +
    'Requires: Gmail account connected via Settings > OAuth Providers.',
  inputSchema: {
    type: 'object',
    properties: {
      action: {
        type: 'string',
        enum: ['create', 'update', 'delete'],
        description: 'The label management action to perform.',
      },
      name: {
        type: 'string',
        description: 'Label name. Required for create. New name when updating.',
      },
      labelId: {
        type: 'string',
        description: 'Label ID to update or delete (from gmail-labels).',
      },
    },
    required: ['action'],
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

export async function execute(input: ManageInput, ctx: ToolContext): Promise<ToolResult> {
  try {
    if (!input.action) {
      return { success: false, error: 'action is required (create, update, or delete).' };
    }

    // Validate inputs per action.
    if (input.action === 'create' && !input.name) {
      return { success: false, error: 'name is required for create action.' };
    }
    if ((input.action === 'update' || input.action === 'delete') && !input.labelId) {
      return { success: false, error: `labelId is required for ${input.action} action.` };
    }
    if (input.action === 'update' && !input.name) {
      return { success: false, error: 'name (new name) is required for update action.' };
    }

    // Permission check with dynamic risk.
    const riskMap = { create: 'low', update: 'medium', delete: 'high' } as const;
    const risk = riskMap[input.action];

    const descMap = {
      create: `Create label "${input.name}"`,
      update: `Rename label ${input.labelId} to "${input.name}"`,
      delete: `Delete label ${input.labelId} (removes from ALL messages)`,
    };
    const operationDesc = descMap[input.action];

    const approved = await ctx.ask({
      target: 'permission',
      type: 'permission',
      question: `Gmail: ${operationDesc}`,
      description: input.action === 'delete'
        ? 'This will permanently remove the label from every message that has it.'
        : undefined,
      risk,
      resource: 'gmail',
      action: input.action === 'delete' ? 'high-risk-label-delete' : `label-${input.action}`,
    });

    if (!approved) {
      return { success: false, error: 'USER_REJECTION' };
    }

    const accessToken = await readGmailToken(ctx);

    if (input.action === 'create') {
      const response = await ctx.fetch(`${GMAIL_API_BASE}/labels`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          name: input.name,
          messageListVisibility: 'show',
          labelListVisibility: 'labelShow',
        }),
      });

      if (response.status === 401) {
        return { success: false, error: 'Gmail authorization failed. The access token may be expired. Wait a moment for the background refresh, or reconnect Gmail.' };
      }
      if (!response.ok) {
        const errorText = await response.text().catch(() => 'Unknown error');
        return { success: false, error: `Gmail API error (${response.status}): ${errorText}` };
      }

      const data = (await response.json()) as { id: string; name: string; type?: string };

      return {
        success: true,
        result: {
          action: 'create',
          label: { id: data.id, name: data.name, type: data.type || 'user' },
          created: true,
        },
      };
    }

    if (input.action === 'update') {
      const response = await ctx.fetch(`${GMAIL_API_BASE}/labels/${input.labelId}`, {
        method: 'PATCH',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ name: input.name }),
      });

      if (response.status === 401) {
        return { success: false, error: 'Gmail authorization failed. The access token may be expired. Wait a moment for the background refresh, or reconnect Gmail.' };
      }
      if (!response.ok) {
        const errorText = await response.text().catch(() => 'Unknown error');
        return { success: false, error: `Gmail API error (${response.status}): ${errorText}` };
      }

      const data = (await response.json()) as { id: string; name: string };

      return {
        success: true,
        result: {
          action: 'update',
          label: { id: data.id, name: data.name },
          updated: true,
        },
      };
    }

    // delete
    const response = await ctx.fetch(`${GMAIL_API_BASE}/labels/${input.labelId}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${accessToken}` },
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
        action: 'delete',
        labelId: input.labelId,
        deleted: true,
      },
    };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    ctx.logger.error(`gmail-labels-manage failed: ${message}`);
    return { success: false, error: message };
  }
}
