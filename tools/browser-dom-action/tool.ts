import type { ToolDefinition, ToolContext, ToolResult } from '@prokopai/sdk';

interface DomActionParams {
  action: 'click' | 'type' | 'select' | 'clear' | 'scroll' | 'hover' | 'press_enter' | 'check' | 'uncheck';
  selector?: string;
  text?: string;
  value?: string;
  x?: number;
  y?: number;
  delay?: number;
}

export const definition: ToolDefinition = {
  name: 'browser_dom_action',
  description:
    'Perform a DOM interaction on the active browser tab. Supports: click (by selector or text), type into inputs, select dropdown options, clear inputs, scroll, hover, press Enter, check/uncheck checkboxes. ' +
    'Requires a connected ProkopaiBrowser extension. ' +
    'Use browser_read_active_tab first to understand the page, then use browser_dom_action to interact with it. ' +
    'All actions return scrollX, scrollY, viewportWidth, and viewportHeight for orientation context. ' +
    'Clicks dispatch with real element coordinates (clientX/clientY) for compatibility with position-aware handlers.',
  inputSchema: {
    type: 'object',
    properties: {
      action: {
        type: 'string',
        enum: ['click', 'type', 'select', 'clear', 'scroll', 'hover', 'press_enter', 'check', 'uncheck'],
        description:
          'The DOM action to perform. ' +
          '"click" - click an element (provide selector or text). ' +
          '"type" - type a value into an input field (provide selector and value). ' +
          '"select" - select an option in a dropdown (provide selector and value). ' +
          '"clear" - clear an input field (provide selector). ' +
          '"scroll" - scroll the page or to an element. ' +
          '"hover" - hover over an element. ' +
          '"press_enter" - press Enter key on an element. ' +
          '"check" / "uncheck" - toggle a checkbox.',
      },
      selector: {
        type: 'string',
        description:
          'CSS selector to identify the target element. ' +
          'Examples: "#buy-now-btn", "input[name=\'qty\']", "select.shipping-method", "button.add-to-cart". ' +
          'Use browser_discover_elements to find the right selectors.',
      },
      text: {
        type: 'string',
        description:
          'For click action: find element by visible text content (case-insensitive). ' +
          'Example: "Add to cart", "Buy Now", "Proceed to checkout". ' +
          'Used as fallback when selector is not provided.',
      },
      value: {
        type: 'string',
        description:
          'Value to type into input (for "type" action) or select (for "select" action). ' +
          'Examples: "2" for quantity, "US" for country, "express" for shipping.',
      },
      x: {
        type: 'number',
        description: 'Horizontal scroll amount in pixels (for scroll action when no selector).',
      },
      y: {
        type: 'number',
        description: 'Vertical scroll amount in pixels (for scroll action when no selector).',
      },
      delay: {
        type: 'number',
        description: 'Delay in ms after the action before returning (default: 100). Increase for slow pages.',
      },
    },
    required: ['action'],
  },
  timeout: 30000,
};

export async function execute(
  input: Record<string, unknown>,
  ctx: ToolContext,
): Promise<ToolResult> {
  const params = input as unknown as DomActionParams;

  if (!params.action) {
    return { success: false, error: 'Missing required parameter: action' };
  }

  const approved = await ctx.ask({
    type: 'permission',
    question: `Perform "${params.action}" action in browser?`,
    description: `Execute a "${params.action}" DOM action on the active browser tab.` +
      (params.selector ? ` Target: ${params.selector}.` : '') +
      (params.text ? ` Text: "${params.text}".` : '') +
      (params.value ? ` Value: "${params.value}".` : ''),
    risk: 'medium',
    resource: 'browser',
    action: 'interact',
    scope: { type: 'custom', value: params.action, label: `${params.action} action` },
    allowedScopes: ['once', 'session'],
  });
  if (!approved) return { success: false, error: 'USER_REJECTION' };

  try {
    const executionResult = await ctx.ask({
      type: 'client_capability',
      target: 'client',
      capability: 'browser_dom_action',
      metadata: {
        task: 'browser.dom_action',
        params: {
          action: params.action,
          selector: params.selector,
          text: params.text,
          value: params.value,
          x: params.x,
          y: params.y,
          delay: params.delay,
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
        error: `DOM action failed: ${result.error ?? 'unknown error'}`,
      };
    }

    return {
      success: true,
      result: {
        action: params.action,
        selector: params.selector ?? null,
        elementFound: result.elementFound ?? true,
        currentValue: result.currentValue ?? null,
        pageChanged: result.pageChanged ?? true,
      },
    };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);

    if (message.includes('timed out') || message.includes('did not respond')) {
      return {
        success: false,
        error:
          'Browser action timed out. Ensure the ProkopaiBrowser extension is installed, connected, and the active tab is accessible.',
      };
    }

    return {
      success: false,
      error: `Browser action failed: ${message}`,
    };
  }
}
