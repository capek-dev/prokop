import type { ToolDefinition, ToolContext, ToolResult } from '@prokopai/sdk';

interface ActiveTabResult {
  title: string;
  url: string;
  text: string;
}

export const definition: ToolDefinition = {
  name: 'browser_read_active_tab',
  description:
    'Read the active browser tab. Returns the page title, URL, and visible text content. ' +
    'Requires a connected ProkopaiBrowser extension.',
  inputSchema: {
    type: 'object',
    properties: {},
  },
  timeout: 120000,
};

export async function execute(
  _input: Record<string, unknown>,
  ctx: ToolContext,
): Promise<ToolResult> {
  const approved = await ctx.ask({
    type: 'permission',
    question: 'Read active browser tab?',
    description: 'Read the title, URL, and visible text content of the active browser tab.',
    risk: 'low',
    resource: 'browser',
    action: 'read',
    allowedScopes: ['once', 'session'],
  });
  if (!approved) return { success: false, error: 'USER_REJECTION' };

  try {
    const executionResult = await ctx.ask({
      type: 'client_capability',
      target: 'client',
      capability: 'active_tab_read',
      metadata: {
        task: 'browser.read_active_tab',
      },
    });

    if (!executionResult || typeof executionResult !== 'object') {
      return {
        success: false,
        error: 'Extension returned an invalid response.',
      };
    }

    const result = executionResult as ActiveTabResult;

    if (!result.title && !result.url && !result.text) {
      return {
        success: false,
        error: 'Extension returned empty result.',
      };
    }

    return {
      success: true,
      result: {
        title: result.title || '',
        url: result.url || '',
        text: result.text || '',
      },
    };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);

    if (message.includes('timed out') || message.includes('did not respond')) {
      return {
        success: false,
        error:
          'Browser read timed out. Ensure the ProkopaiBrowser extension is installed, connected, and the active tab is accessible.',
      };
    }

    return {
      success: false,
      error: `Browser read failed: ${message}`,
    };
  }
}
