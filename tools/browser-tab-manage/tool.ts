import type { ToolDefinition, ToolContext, ToolResult } from '@prokopai/sdk';

export const definition: ToolDefinition = {
  name: 'browser_tab_manage',
  description:
    'Manage browser tabs: list all tabs, create a new tab, close a tab, or switch to a tab. ' +
    'Use this alongside browser_navigate and browser_dom_action to work across multiple tabs. ' +
    'Requires a connected Jean2Browser extension.',
  inputSchema: {
    type: 'object',
    properties: {
      action: {
        type: 'string',
        enum: ['list', 'create', 'close', 'switch'],
        description:
          '"list" — return all tabs in the current window. ' +
          '"create" — open a new tab (optionally with a URL). ' +
          '"close" — close a tab by tabId, tabIndex, or the active tab if neither is provided. ' +
          '"switch" — switch to a tab by tabId or tabIndex.',
      },
      url: {
        type: 'string',
        description: 'URL to open when creating a new tab (default: about:blank).',
      },
      tabId: {
        type: 'number',
        description: 'Tab ID to close or switch to. Get tab IDs from the list action.',
      },
      tabIndex: {
        type: 'number',
        description: 'Zero-based tab index to close or switch to.',
      },
      active: {
        type: 'boolean',
        description: 'Whether a newly created tab should become active (default: true).',
      },
    },
    required: ['action'],
  },
  timeout: 15000,
};

export async function execute(
  input: Record<string, unknown>,
  ctx: ToolContext,
): Promise<ToolResult> {
  const action = input.action as string;

  if (!action) {
    return { success: false, error: 'Missing required parameter: action' };
  }

  const isReadAction = action === 'list';
  const risk: 'low' | 'medium' = isReadAction ? 'low' : 'medium';
  const actionLabel = action === 'create' ? `Open new tab${input.url ? ` (${input.url})` : ''}`
    : action === 'close' ? `Close tab (tabId: ${input.tabId ?? input.tabIndex ?? 'active'})`
    : action === 'switch' ? `Switch to tab (tabId: ${input.tabId ?? input.tabIndex})`
    : 'List browser tabs';

  const approved = await ctx.ask({
    type: 'permission',
    question: `${actionLabel}?`,
    description: `${isReadAction ? 'List' : 'Manage'} browser tabs in the current window.`,
    risk,
    resource: 'browser',
    action: isReadAction ? 'read' : 'write',
    scope: { type: 'custom', value: `tab:${action}`, label: actionLabel },
    allowedScopes: ['once', 'session'],
  });
  if (!approved) return { success: false, error: 'USER_REJECTION' };

  try {
    const executionResult = await ctx.ask({
      type: 'client_capability',
      target: 'client',
      capability: 'browser_tab_manage',
      metadata: {
        task: 'browser.tab_manage',
        params: {
          action,
          url: input.url,
          tabId: input.tabId,
          tabIndex: input.tabIndex,
          active: input.active,
        },
      },
    });

    if (!executionResult || typeof executionResult !== 'object') {
      return {
        success: false,
        error: 'Extension returned an invalid response.',
      };
    }

    const result = executionResult as Record<string, unknown>;

    if (!result.success) {
      return {
        success: false,
        error: `Tab action failed: ${result.error ?? 'unknown error'}`,
      };
    }

    return {
      success: true,
      result,
    };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);

    if (message.includes('timed out') || message.includes('did not respond')) {
      return {
        success: false,
        error:
          'Tab action timed out. Ensure the Jean2Browser extension is installed and connected.',
      };
    }

    return {
      success: false,
      error: `Tab action failed: ${message}`,
    };
  }
}
