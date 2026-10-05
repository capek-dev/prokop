import { z } from 'zod';
import { BUILTIN_BROWSER_MCP_NAME } from '@prokopai/sdk';

export const mcpNameSchema = z.string().trim().min(1).max(100)
  .regex(/^[a-zA-Z0-9][a-zA-Z0-9_. -]*$/)
  .refine(name => !['__proto__', 'constructor', 'prototype'].includes(name));
const strings = z.record(z.string().min(1), z.string());
const common = {
  enabled: z.boolean().optional(),
  timeout: z.number().int().min(100).max(300_000).optional(),
  disabledTools: z.array(z.string().min(1).max(256)).max(10_000).optional(),
};
const httpUrl = z.url().refine(value => {
  const url = new URL(value);
  return ['http:', 'https:'].includes(url.protocol) && !url.username && !url.password;
}, 'Use an HTTP or HTTPS URL without embedded credentials');
export const mcpServerConfigSchema = z.discriminatedUnion('type', [
  z.object({ ...common, type: z.literal('builtin'), id: z.literal('browser') }).strict(),
  z.object({ ...common, type: z.literal('local'), command: z.array(z.string().max(8192))
    .min(1).max(100).refine(command => !!command[0]?.trim()), env: strings.optional() }).strict(),
  z.object({ ...common, type: z.literal('remote'), url: httpUrl, headers: strings.optional(),
    oauth: z.union([z.boolean(), z.object({ clientId: z.string().optional(),
      clientSecret: z.string().optional(), scope: z.string().optional() }).strict()]).optional() }).strict(),
]);
export const mcpConfigSchema = z.object({ servers: z.record(mcpNameSchema, mcpServerConfigSchema) }).loose()
  .refine(config => Object.entries(config.servers).every(([name, server]) =>
    (server.type === 'builtin') === (name === BUILTIN_BROWSER_MCP_NAME)),
  'Prokop Browser is reserved for the built-in browser integration');
