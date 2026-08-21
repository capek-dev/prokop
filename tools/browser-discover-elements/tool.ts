import type { ToolDefinition, ToolContext, ToolResult } from '@prokopai/sdk';

export const definition: ToolDefinition = {
  name: 'browser_discover_elements',
  description:
    'Discover all interactive elements (buttons, links, inputs, selects, etc.) on the active browser tab. ' +
    'Returns a list of elements with their CSS selectors, text content, attributes, ' +
    'bounding rectangles (x, y, width, height, top, right, bottom, left), ' +
    'visibility flags (isVisible, isInViewport), and viewport dimensions. ' +
    'Use this before browser_dom_action to find the correct selectors and understand element layout. ' +
    'Requires a connected Jean2Browser extension.',
  inputSchema: {
    type: 'object',
    properties: {},
  },
  timeout: 15000,
};

export async function execute(
  _input: Record<string, unknown>,
  ctx: ToolContext,
): Promise<ToolResult> {
  const approved = await ctx.ask({
    type: 'permission',
    question: 'Discover interactive browser elements?',
    description: 'List all interactive elements (buttons, links, inputs, etc.) on the active browser tab.',
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
      capability: 'browser_discover_elements',
      metadata: {
        task: 'browser.discover_elements',
      },
    });

    if (!executionResult || typeof executionResult !== 'object') {
      return {
        success: false,
        error: 'Extension returned an invalid response.',
      };
    }

    const result = executionResult as Record<string, unknown>;
    const elements = result.elements as Record<string, unknown>[] | undefined;

    if (!elements || !Array.isArray(elements)) {
      return {
        success: false,
        error: 'Extension returned invalid element list.',
      };
    }

    return {
      success: true,
      result: {
        elementCount: elements.length,
        elements,
      },
    };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);

    if (message.includes('timed out') || message.includes('did not respond')) {
      return {
        success: false,
        error:
          'Element discovery timed out. Ensure the Jean2Browser extension is installed and connected.',
      };
    }

    return {
      success: false,
      error: `Element discovery failed: ${message}`,
    };
  }
}
