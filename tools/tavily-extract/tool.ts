import type { ToolDefinition, ToolContext, ToolResult } from '@prokopai/sdk';
import type { MarkdownVisualization } from '@prokopai/sdk';
import { tavily } from '@tavily/core';

interface Input {
  urls: string[];
  query?: string;
}

interface ExtractResult {
  url: string;
  rawContent: string;
  images?: string[];
  favicon?: string;
}

interface FailedResult {
  url: string;
  error: string;
}

export const definition: ToolDefinition = {
  name: 'tavily-extract',
  description: `Extract clean content from a list of URLs using the Tavily search API.

## When to Use

- Extracting clean, readable content from multiple web pages
- Getting well-formatted markdown or text from web articles
- Batch fetching content from multiple URLs with automatic reranking
- When you need content organized by relevance to a query

## When NOT to Use

- If you just need to fetch raw HTML from a single URL (use \`webfetch\` instead)
- If you need to scrape dynamic content that requires JavaScript rendering

## Usage

**Parameters:**

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| \`urls\` | string[] | Yes | - | List of URLs to extract content from (max 20) |
| \`query\` | string | No | - | User intent for reranking extracted content chunks |

**Output:**

- \`results\`: Array of successfully extracted URLs with \`rawContent\`, optionally \`images\` and \`favicon\`
- \`failedResults\`: Array of URLs that failed to extract with error messages
- \`error\`: Top-level error message if the entire operation failed

## Credits and Batching

- Every 5 successfully extracted URLs costs 1 credit (basic) or 2 credits (advanced)
- Batches are processed in groups of 5 URLs
- Failed URLs do not count toward credit usage
- Plan your queries efficiently to minimize API calls

## Example

\`\`\`json
{
  "urls": [
    "https://example.com/article",
    "https://example.org/docs"
  ],
  "query": "user wants to understand the main topic"
}
\`\`\``,
  inputSchema: {
    type: 'object',
    properties: {
      urls: {
        type: 'array',
        items: { type: 'string' },
        description: 'List of URLs to extract content from (max 20)',
      },
      query: {
        type: 'string',
        description: 'User intent for reranking extracted content chunks',
      },
    },
    required: ['urls'],
  },
  timeout: 60000,
  env: [
    'TAVILY_API_KEY',
    'TAVILY_EXTRACT_DEPTH',
    'TAVILY_INCLUDE_IMAGES',
    'TAVILY_CHUNKS_PER_SOURCE',
    'TAVILY_FORMAT',
  ],
};

export async function execute(input: Input, ctx: ToolContext): Promise<ToolResult> {
  try {
    if (!input.urls || input.urls.length === 0) {
      return { success: false, error: 'No URLs provided' };
    }

    if (input.urls.length > 20) {
      return { success: false, error: 'Maximum 20 URLs allowed' };
    }

    const apiKey = ctx.env.get('TAVILY_API_KEY');
    if (!apiKey) {
      return { success: false, error: 'TAVILY_API_KEY environment variable is not set' };
    }

    const extractDepth = ctx.env.get('TAVILY_EXTRACT_DEPTH') || 'basic';
    const includeImages = ctx.env.get('TAVILY_INCLUDE_IMAGES') === 'true';
    const chunksPerSource = ctx.env.get('TAVILY_CHUNKS_PER_SOURCE');
    const format = ctx.env.get('TAVILY_FORMAT') || 'markdown';

    const client = tavily({ apiKey });

    const options: {
      query?: string;
      extractDepth?: 'basic' | 'advanced';
      includeImages?: boolean;
      chunksPerSource?: number;
      format?: 'markdown' | 'text';
    } = {};

    if (input.query) options.query = input.query;
    options.extractDepth = extractDepth as 'basic' | 'advanced';
    options.format = format as 'markdown' | 'text';
    options.includeImages = includeImages;
    if (chunksPerSource) options.chunksPerSource = parseInt(chunksPerSource, 10);

    const response = await client.extract(input.urls, options);

    const results: ExtractResult[] = response.results.map((r) => ({
      url: r.url,
      rawContent: r.rawContent,
      ...(r.images && { images: r.images }),
      ...(r.favicon && { favicon: r.favicon }),
    }));

    const failedResults: FailedResult[] = (response.failedResults || []).map((r) => ({
      url: r.url,
      error: r.error,
    }));

    const _totalResults = results.length + failedResults.length;
    const content = results.map(r => `## ${r.url}\n\n${r.rawContent}`).join('\n\n');

    const visualization: MarkdownVisualization = {
      type: 'markdown',
      content: content || `Extracted content from ${results.length} URL(s). ${failedResults.length} failed.`,
    };

    return {
      success: true,
      result: { results, failedResults },
      visualization,
    };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return { success: false, error: message };
  }
}
