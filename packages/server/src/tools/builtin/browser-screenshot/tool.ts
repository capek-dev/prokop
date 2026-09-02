import type { ToolDefinition, ToolContext, ToolResult } from '@capekai/tool';

export const definition: ToolDefinition = {
  name: 'browser_screenshot',
  description:
    'Capture a screenshot of a tab selected by tabId, or the most recently active non-PWA browser tab. Returns a base64-encoded PNG image. ' +
    'Use this to visually verify the current state of a page after performing actions. ' +
    'Requires a connected ProkopaiBrowser extension.',
  inputSchema: {
    type: 'object',
    properties: {
      tabId: {
        type: 'number',
        description: 'Optional tab ID from browser_tab_manage. Defaults to the most recently active non-PWA browser tab.',
      },
    },
  },
  timeout: 15000,
};

export async function execute(
  input: Record<string, unknown>,
  ctx: ToolContext,
): Promise<ToolResult> {
  const approved = await ctx.ask({
    type: 'permission',
    question: 'Take browser screenshot?',
    description: 'Capture a screenshot of the selected browser tab as a PNG image.',
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
      capability: 'browser_screenshot',
      metadata: {
        task: 'browser.screenshot',
        params: { tabId: input.tabId },
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
        error: `Screenshot failed: ${result.error ?? 'unknown error'}`,
      };
    }

    return {
      success: true,
      result: {
        dataUrl: result.dataUrl ?? '',
      },
    };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);

    if (message.includes('timed out') || message.includes('did not respond')) {
      return {
        success: false,
        error:
          'Screenshot timed out. Ensure the ProkopaiBrowser extension is installed and connected.',
      };
    }

    return {
      success: false,
      error: `Screenshot failed: ${message}`,
    };
  }
}
