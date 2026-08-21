import type { ToolDefinition, ToolContext, ToolResult } from '@prokopai/sdk';

interface Input {
  url: string;
  instructions?: string;
  selectPaths?: string[];
  excludePaths?: string[];
  selectDomains?: string[];
  excludeDomains?: string[];
}

export const definition: ToolDefinition = {
  name: 'tavily-map',
  description: 'Discover and map URLs on a website without extracting content using the Tavily API.\n\nWhen to use:\n- Discovering all URLs on a website or web application\n- Building site maps for documentation or analysis\n- Finding pages matching specific patterns (using selectPaths)\n- Surveying the structure of a website before deeper exploration\n- When you only need URLs, not the actual page content\n\nWhen NOT to use:\n- If you need the actual content from pages (use tavily-crawl instead)\n- For single page lookups where webfetch would be more efficient\n\nParameters:\n- url (required): The root URL to begin mapping. Include the protocol (https://)\n- instructions (optional): Natural language instructions to guide the mapper (e.g., "find all blog posts" or "focus on documentation pages")\n- selectPaths (optional): Array of regex patterns to include only URLs matching specific paths (e.g., `/docs/.*`, `/blog/.*`)\n- excludePaths (optional): Array of regex patterns to exclude URLs matching specific paths (e.g., `/admin/.*`, `/private/.*`)\n- selectDomains (optional): Array of regex patterns to restrict mapping to specific domains (e.g., ^docs\\.example\\.com$)\n- excludeDomains (optional): Array of regex patterns to exclude specific domains from mapping\n\nNotes:\n- Mapping is cheaper than crawling since no content extraction is performed\n- maxDepth, maxBreadth, limit, allowExternal are controlled via environment variables\n- Use selectPaths and excludePaths to filter results to relevant pages',
  inputSchema: {
    type: 'object',
    properties: {
      url: {
        type: 'string',
        description: 'The URL to map',
      },
      instructions: {
        type: 'string',
        description: 'Custom instructions for mapping',
      },
      selectPaths: {
        type: 'array',
        items: { type: 'string' },
        description: 'Specific paths to include',
      },
      excludePaths: {
        type: 'array',
        items: { type: 'string' },
        description: 'Paths to exclude',
      },
      selectDomains: {
        type: 'array',
        items: { type: 'string' },
        description: 'Specific domains to include',
      },
      excludeDomains: {
        type: 'array',
        items: { type: 'string' },
        description: 'Domains to exclude',
      },
    },
    required: ['url'],
  },
  timeout: 120000,
  env: [
    'TAVILY_API_KEY',
    'TAVILY_MAX_DEPTH',
    'TAVILY_MAX_BREADTH',
    'TAVILY_LIMIT',
    'TAVILY_ALLOW_EXTERNAL',
  ],
};

export async function execute(input: Input, ctx: ToolContext): Promise<ToolResult> {
  try {
    if (!input.url || input.url.trim() === '') {
      return { success: false, error: 'URL is required' };
    }

    const apiKey = ctx.env.require('TAVILY_API_KEY');

    const { tavily } = await import('@tavily/core');
    const client = tavily({ apiKey });

    const maxDepth = ctx.env.get('TAVILY_MAX_DEPTH');
    const maxBreadth = ctx.env.get('TAVILY_MAX_BREADTH');
    const limit = ctx.env.get('TAVILY_LIMIT');
    const allowExternal = ctx.env.get('TAVILY_ALLOW_EXTERNAL') === 'true';

    const options: Record<string, unknown> = {};

    if (maxDepth !== undefined) options.maxDepth = Number(maxDepth);
    if (maxBreadth !== undefined) options.maxBreadth = Number(maxBreadth);
    if (limit !== undefined) options.limit = Number(limit);
    options.allowExternal = allowExternal;
    if (input.instructions !== undefined) options.instructions = input.instructions;
    if (input.selectPaths !== undefined) options.selectPaths = input.selectPaths;
    if (input.excludePaths !== undefined) options.excludePaths = input.excludePaths;
    if (input.selectDomains !== undefined) options.selectDomains = input.selectDomains;
    if (input.excludeDomains !== undefined) options.excludeDomains = input.excludeDomains;

    const response = await client.map(input.url, options);

    return {
      success: true,
      result: {
        baseUrl: input.url,
        results: response.results || [],
      },
    };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return { success: false, error: message };
  }
}
