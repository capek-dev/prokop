import type { ToolDefinition, ToolContext, ToolResult } from '@prokopai/sdk';
import { tavily } from '@tavily/core';

interface SearchInput {
  query: string;
  topic?: 'general' | 'news' | 'finance';
  timeRange?: 'day' | 'week' | 'month' | 'year';
  startDate?: string;
  endDate?: string;
  includeRawContent?: boolean;
  includeDomains?: string[];
  excludeDomains?: string[];
  country?: string;
  exactMatch?: boolean;
}

export const definition: ToolDefinition = {
  name: 'tavily-search',
  description: 'Perform web searches using Tavily\'s search API.\n\nWhen to use:\n- Searching the web for current information\n- Finding relevant articles, documentation, or resources\n- Research tasks requiring up-to-date web content\n- When you need categorized results (general, news, or finance)\n\nWhen NOT to use:\n- For simple URL content fetching (use webfetch instead)\n- For very short, fact-based queries that can be answered from training data\n- When the query is ambiguous and requires clarification first\n\nParameters:\n- query (required): The search query to execute\n- topic (optional): Search category - general (default), news, or finance\n- timeRange (optional): Filter by publish date - day, week, month, or year (mutually exclusive with startDate/endDate)\n- startDate (optional): Return results after this date (YYYY-MM-DD format)\n- endDate (optional): Return results before this date (YYYY-MM-DD format)\n- includeRawContent (optional): Include cleaned HTML content of each result\n- includeDomains (optional): List of domains to include (max 300)\n- excludeDomains (optional): List of domains to exclude (max 150)\n- country (optional): Boost results from a specific country (full name e.g. \'united states\'). Only with topic=general.\n- exactMatch (optional): Only return results containing exact quoted phrase(s) from the query\n\nNotes:\n- Tavily has a free tier with usage limits\n- Default search uses basic depth (1 credit per query)',
  inputSchema: {
    type: 'object',
    properties: {
      query: {
        type: 'string',
        description: 'The search query',
      },
      topic: {
        type: 'string',
        description: "Topic filter: 'general', 'news', or 'finance'",
        enum: ['general', 'news', 'finance'],
      },
      timeRange: {
        type: 'string',
        description: "Time range filter: 'day', 'week', 'month', or 'year'",
        enum: ['day', 'week', 'month', 'year'],
      },
      startDate: {
        type: 'string',
        description: 'Start date for results (ISO format)',
      },
      endDate: {
        type: 'string',
        description: 'End date for results (ISO format)',
      },
      includeRawContent: {
        type: 'boolean',
        description: 'Include raw content from each result',
      },
      includeDomains: {
        type: 'array',
        items: { type: 'string' },
        description: 'List of domains to include',
      },
      excludeDomains: {
        type: 'array',
        items: { type: 'string' },
        description: 'List of domains to exclude',
      },
      country: {
        type: 'string',
        description: 'Country code for search results',
      },
      exactMatch: {
        type: 'boolean',
        description: 'Enable exact match for the query',
      },
    },
    required: ['query'],
  },
  timeout: 60000,
  env: [
    'TAVILY_API_KEY',
    'TAVILY_SEARCH_DEPTH',
    'TAVILY_MAX_RESULTS',
    'TAVILY_INCLUDE_ANSWER',
    'TAVILY_INCLUDE_IMAGES',
    'TAVILY_INCLUDE_IMAGE_DESCRIPTIONS',
    'TAVILY_CHUNKS_PER_SOURCE',
  ],
};

export async function execute(input: SearchInput, ctx: ToolContext): Promise<ToolResult> {
  try {
    if (!input.query || input.query.trim() === '') {
      return { success: false, error: 'Query is required' };
    }

    const apiKey = ctx.env.require('TAVILY_API_KEY');

    const client = tavily({ apiKey });

    const searchDepth = ctx.env.get('TAVILY_SEARCH_DEPTH') || 'basic';
    const maxResults = Number(ctx.env.get('TAVILY_MAX_RESULTS')) || 5;
    const includeAnswer = ctx.env.get('TAVILY_INCLUDE_ANSWER') === 'true';
    const includeImages = ctx.env.get('TAVILY_INCLUDE_IMAGES') === 'true';
    const includeImageDescriptions = ctx.env.get('TAVILY_INCLUDE_IMAGE_DESCRIPTIONS') === 'true';
    const chunksPerSource = ctx.env.get('TAVILY_CHUNKS_PER_SOURCE')
      ? Number(ctx.env.get('TAVILY_CHUNKS_PER_SOURCE'))
      : undefined;

    const options: Record<string, unknown> = {};

    if (input.topic !== undefined) options.topic = input.topic;
    options.searchDepth = searchDepth;
    options.maxResults = maxResults;
    if (input.timeRange !== undefined) options.timeRange = input.timeRange;
    if (input.startDate !== undefined) options.startDate = input.startDate;
    if (input.endDate !== undefined) options.endDate = input.endDate;
    if (chunksPerSource !== undefined) options.chunksPerSource = chunksPerSource;
    options.includeAnswer = includeAnswer;
    if (input.includeRawContent !== undefined) options.includeRawContent = input.includeRawContent;
    options.includeImages = includeImages;
    options.includeImageDescriptions = includeImageDescriptions;
    if (input.includeDomains !== undefined) options.includeDomains = input.includeDomains;
    if (input.excludeDomains !== undefined) options.excludeDomains = input.excludeDomains;
    if (input.country !== undefined) options.country = input.country;
    if (input.exactMatch !== undefined) options.exactMatch = input.exactMatch;

    const response = await client.search(input.query, options);

    const results = response.results.map((result) => ({
      title: result.title,
      url: result.url,
      content: result.content,
      score: result.score,
    }));

    const output: {
      answer?: string;
      results: Array<{ title: string; url: string; content: string; score: number }>;
    } = { results };

    if (response.answer) {
      output.answer = response.answer;
    }

    return { success: true, result: output };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    ctx.logger.error(`tavily-search failed: ${message}`);
    return { success: false, error: message };
  }
}
