import type { ToolDefinition, ToolContext, ToolResult } from '@prokopai/sdk';
import type { NoneVisualization } from '@prokopai/sdk';
import { createWebfetchPermissionAsk } from '@prokopai/sdk';
import TurndownService from 'turndown';

interface Input {
  url: string;
  format?: 'markdown' | 'text' | 'html';
  timeout?: number;
}

const MAX_RESPONSE_SIZE = 5 * 1024 * 1024;
const DEFAULT_TIMEOUT = 30;
const MAX_TIMEOUT = 120;

export const definition: ToolDefinition = {
  name: 'webfetch',
  description: 'Fetch content from a URL and convert to readable format.\n\n## Permission Model\n\nThis tool requires explicit permission for:\n- HTTP URLs (unencrypted)\n- Private/localhost IPs (blocked)',
  inputSchema: {
    type: 'object',
    properties: {
      url: {
        type: 'string',
        description: 'The URL to fetch content from (must start with http:// or https://)',
      },
      format: {
        type: 'string',
        description: 'Output format: markdown (default), text, or html',
        enum: ['markdown', 'text', 'html'],
      },
      timeout: {
        type: 'number',
        description: 'Timeout in seconds (max 120)',
      },
    },
    required: ['url'],
  },
  timeout: 120000,
};

function isPrivateIP(hostname: string): boolean {
  let cleanHostname = hostname;
  if (hostname.startsWith('[') && hostname.endsWith(']')) {
    cleanHostname = hostname.slice(1, -1);
  }

  if (cleanHostname === 'localhost' || cleanHostname === 'localhost.localdomain') {
    return true;
  }

  const ipv4Regex = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/;
  const match = cleanHostname.match(ipv4Regex);

  if (match) {
    const [, a, b, _c, _d] = match.map(Number);

    if (a === 10) return true;
    if (a === 172 && b >= 16 && b <= 31) return true;
    if (a === 192 && b === 168) return true;
    if (a === 127) return true;
    if (a === 169 && b === 254) return true;
    if (a === 0) return true;
  }

  if (cleanHostname === '::1' || cleanHostname === '::') return true;

  if (cleanHostname.startsWith('fc') || cleanHostname.startsWith('fd') || cleanHostname.startsWith('fe80:')) {
    return true;
  }

  return false;
}

function stripHtmlTags(html: string): string {
  return html
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, ' ')
    .trim();
}

export async function execute(input: Input, ctx: ToolContext): Promise<ToolResult> {
  try {
    let urlObj: URL;
    try {
      urlObj = new URL(input.url);
    } catch {
      return { success: false, error: `Invalid URL: ${input.url}` };
    }

    if (!['http:', 'https:'].includes(urlObj.protocol)) {
      return { success: false, error: `Only HTTP and HTTPS URLs are allowed. Blocked: ${urlObj.protocol}` };
    }

    if (isPrivateIP(urlObj.hostname)) {
      return { success: false, error: `Access to private IP addresses and localhost is not allowed: ${urlObj.hostname}` };
    }

    const blockedHostnames = [
      'metadata.google.internal',
      '169.254.169.254',
      'metadata.azure.com',
      'metadata.googleusercontent.com',
    ];

    if (blockedHostnames.includes(urlObj.hostname)) {
      return { success: false, error: `Access to cloud metadata endpoints is not allowed: ${urlObj.hostname}` };
    }

    // Permission ask for HTTP URLs using canonical structured helper
    if (urlObj.protocol !== 'https:') {
      const permAsk = createWebfetchPermissionAsk({
        url: input.url,
        host: urlObj.hostname,
        risk: 'medium',
        isHttp: urlObj.protocol === 'http:',
      });

      const approved = await ctx.ask(permAsk);
      if (!approved) return { success: false, error: 'USER_REJECTION' };
    }

    const timeoutSeconds = Math.min(input.timeout ?? DEFAULT_TIMEOUT, MAX_TIMEOUT);
    const timeoutMs = timeoutSeconds * 1000;

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const response = await ctx.fetch(input.url, {
        signal: controller.signal,
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
          'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
          'Accept-Language': 'en-US,en;q=0.5',
        },
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        return { success: false, error: `Request failed with status code: ${response.status}` };
      }

      const contentType = response.headers.get('content-type') || '';
      const contentLength = response.headers.get('content-length');

      if (contentLength && parseInt(contentLength) > MAX_RESPONSE_SIZE) {
        return { success: false, error: `Response too large: ${contentLength} bytes (max 5MB)` };
      }

      const content = await response.text();

      if (content.length > MAX_RESPONSE_SIZE) {
        return { success: false, error: `Response too large: ${content.length} bytes (max 5MB)` };
      }

      let title = input.url;
      const titleMatch = content.match(/<title[^>]*>([^<]+)<\/title>/i);
      if (titleMatch) {
        title = titleMatch[1].trim();
      }

      let outputContent: string;

      if (input.format === 'html') {
        outputContent = content;
      } else if (input.format === 'markdown' && contentType.includes('text/html')) {
        const turndown = new TurndownService();
        outputContent = turndown.turndown(content);
      } else if (input.format === 'text') {
        outputContent = stripHtmlTags(content);
      } else {
        outputContent = content;
      }

      const displayUrl = input.url.length > 80 ? input.url.substring(0, 77) + '...' : input.url;

      const visualization: NoneVisualization = {
        type: 'none',
        message: `Fetched: ${displayUrl}`,
      };

      return {
        success: true,
        result: { content: outputContent, title, contentType },
        visualization,
      };
    } finally {
      clearTimeout(timeoutId);
    }
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return { success: false, error: message };
  }
}
