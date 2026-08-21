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
  name: 'tavily-crawl',
  description: 'Crawl a website and extract content from multiple pages using the Tavily API.\n\nWhen to use:\n- Crawling documentation sites (API docs, README files, knowledge bases)\n- Exploring website structure with full content extraction\n- Gathering content from multiple related pages on a domain\n- Building a corpus of web content for analysis or training\n- Research tasks requiring comprehensive site exploration\n\nWhen NOT to use:\n- For simple URL list discovery without content extraction (use tavily-map instead)\n- For single page fetching (use webfetch instead)\n- For real-time search queries (use tavily-search instead)\n\nParameters:\n- url (required): Root URL to begin the crawl\n- instructions (optional): Natural language instructions to guide content discovery\n- selectPaths (optional): Regex patterns to include only matching URLs\n- excludePaths (optional): Regex patterns to exclude matching URLs\n- selectDomains (optional): Regex patterns to restrict to specific domains (e.g. ^docs\\.example\\.com$)\n- excludeDomains (optional): Regex patterns to exclude specific domains\n\nNotes:\n- Default timeout is 180 seconds (3 minutes). Large crawls may need this increased.\n- Crawl operations use Tavily credits\n- Output includes URL, raw content, images, and favicon for each page\n- Cost-related parameters (maxDepth, maxBreadth, limit, etc.) are controlled via environment variables',
  inputSchema: {
    type: 'object',
    properties: {
      url: {
        type: 'string',
        description: 'The URL to crawl',
      },
      instructions: {
        type: 'string',
        description: 'Custom instructions for content extraction',
      },
      selectPaths: {
        type: 'array',
        items: { type: 'string' },
        description: 'Specific paths to extract from the page',
      },
      excludePaths: {
        type: 'array',
        items: { type: 'string' },
        description: 'Paths to exclude from extraction',
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
    'TAVILY_EXTRACT_DEPTH',
    'TAVILY_ALLOW_EXTERNAL',
    'TAVILY_INCLUDE_IMAGES',
    'TAVILY_FORMAT',
    'TAVILY_CHUNKS_PER_SOURCE',
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
    const extractDepth = ctx.env.get('TAVILY_EXTRACT_DEPTH') || 'basic';
    const allowExternal = ctx.env.get('TAVILY_ALLOW_EXTERNAL') === 'true';
    const includeImages = ctx.env.get('TAVILY_INCLUDE_IMAGES') === 'true';
    const format = ctx.env.get('TAVILY_FORMAT') || 'markdown';
    const chunksPerSource = ctx.env.get('TAVILY_CHUNKS_PER_SOURCE');

    const options: Record<string, unknown> = {};

    if (maxDepth !== undefined) options.maxDepth = Number(maxDepth);
    if (maxBreadth !== undefined) options.maxBreadth = Number(maxBreadth);
    if (limit !== undefined) options.limit = Number(limit);
    options.extractDepth = extractDepth;
    options.format = format;
    options.allowExternal = allowExternal;
    options.includeImages = includeImages;
    if (chunksPerSource !== undefined) options.chunksPerSource = Number(chunksPerSource);
    if (input.instructions !== undefined) options.instructions = input.instructions;
    if (input.selectPaths !== undefined) options.selectPaths = input.selectPaths;
    if (input.excludePaths !== undefined) options.excludePaths = input.excludePaths;
    if (input.selectDomains !== undefined) options.selectDomains = input.selectDomains;
    if (input.excludeDomains !== undefined) options.excludeDomains = input.excludeDomains;

    const response = await client.crawl(input.url, options);

    return {
      success: true,
      result: {
        baseUrl: input.url,
        results: response.results.map((result) => ({
          url: result.url || '',
          rawContent: result.rawContent || '',
          images: result.images,
          favicon: result.favicon,
        })),
      },
    };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return { success: false, error: message };
  }
}
