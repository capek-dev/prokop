import type { ToolDefinition, ToolContext, ToolResult } from '@capekai/tool';

export const definition: ToolDefinition = {
  name: 'browser_navigate',
  description:
    'Navigate a tab selected by tabId, or the most recently active non-PWA browser tab, to a URL. Waits for the page to finish loading before returning the new URL and title. ' +
    'Requires a connected ProkopaiBrowser extension.',
  inputSchema: {
    type: 'object',
    properties: {
      tabId: {
        type: 'number',
        description: 'Optional tab ID from browser_tab_manage. Defaults to the most recently active non-PWA browser tab.',
      },
      url: {
        type: 'string',
        description: 'The URL to navigate to. Must be a valid http or https URL.',
      },
      waitForLoad: {
        type: 'boolean',
        description: 'Whether to wait for the page to finish loading (default: true). Set to false for faster navigation when you don\'t need to wait.',
      },
      timeout: {
        type: 'number',
        description: 'Maximum time in ms to wait for the page to load (default: 10000).',
      },
    },
    required: ['url'],
  },
  timeout: 30000,
};

export async function execute(
  input: Record<string, unknown>,
  ctx: ToolContext,
): Promise<ToolResult> {
  const url = input.url as string;
  const waitForLoad = input.waitForLoad as boolean | undefined;
  const timeout = input.timeout as number | undefined;
  const tabId = input.tabId as number | undefined;

  if (!url) {
    return { success: false, error: 'Missing required parameter: url' };
  }

  if (!url.startsWith('http://') && !url.startsWith('https://')) {
    return { success: false, error: 'URL must start with http:// or https://' };
  }

  const approved = await ctx.ask({
    type: 'permission',
    question: `Navigate browser to ${url}?`,
    description: 'Navigate the selected browser tab to a new URL. This will leave the current page.',
    risk: 'medium',
    resource: 'browser',
    action: 'navigate',
    scope: { type: 'custom', value: url, label: url },
    allowedScopes: ['once', 'session'],
  });
  if (!approved) return { success: false, error: 'USER_REJECTION' };

  try {
    const executionResult = await ctx.ask({
      type: 'client_capability',
      target: 'client',
      capability: 'browser_navigate',
      metadata: {
        task: 'browser.navigate',
        params: {
          tabId,
          url,
          waitForLoad: waitForLoad ?? true,
          timeout: timeout ?? 10000,
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
        error: `Navigation failed: ${result.error ?? 'unknown error'}`,
      };
    }

    return {
      success: true,
      result: {
        url: result.url ?? url,
        title: result.title ?? '',
      },
    };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);

    if (message.includes('timed out') || message.includes('did not respond')) {
      return {
        success: false,
        error:
          'Navigation timed out. Ensure the ProkopaiBrowser extension is installed and connected.',
      };
    }

    return {
      success: false,
      error: `Navigation failed: ${message}`,
    };
  }
}
