import { z } from 'zod';
import * as discover from './tools/browser-discover-elements/tool';
import * as dom from './tools/browser-dom-action/tool';
import * as navigate from './tools/browser-navigate/tool';
import * as read from './tools/browser-read-active-tab/tool';
import * as screenshot from './tools/browser-screenshot/tool';
import * as tabs from './tools/browser-tab-manage/tool';

export const browserTools = [read, discover, screenshot, navigate, dom, tabs] as const;
const schemas = new Map(browserTools.map(tool => [tool.definition.name,
  z.fromJSONSchema({ ...tool.definition.inputSchema, additionalProperties: false })]));

export function validateBrowserInput(name: string, input: Record<string, unknown>): void {
  const schema = schemas.get(name);
  if (!schema || !schema.safeParse(input).success) throw new Error('Invalid browser tool arguments');
  for (const key of ['tabId', 'windowId', 'tabIndex']) {
    if (input[key] !== undefined && (!Number.isSafeInteger(input[key]) || Number(input[key]) < 0)) {
      throw new Error('Invalid browser tab or window identifier');
    }
  }
  for (const key of ['timeout', 'delay']) {
    if (input[key] !== undefined && (Number(input[key]) < 0 || Number(input[key]) > 120_000)) {
      throw new Error('Browser delay or timeout must be between 0 and 120000 ms');
    }
  }
  if (typeof input.url === 'string' && input.url !== 'about:blank') {
    const url = new URL(input.url);
    if (!['http:', 'https:'].includes(url.protocol)) throw new Error('Use an HTTP or HTTPS browser URL');
  }
}
