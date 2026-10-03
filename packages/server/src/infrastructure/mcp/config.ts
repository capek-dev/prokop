import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { McpConfig, McpServerConfig, McpLocalServerConfig, McpRemoteServerConfig } from '@prokopai/sdk';
import { resolveWorkspaceDir } from '@/infrastructure/runtime/workspace-dirs';
import { mcpConfigSchema, mcpNameSchema, mcpServerConfigSchema } from '@/domains/mcp/config';

const writes = new Map<string, Promise<unknown>>();

export async function loadMcpConfig(workspacePath: string): Promise<McpConfig> {
  const path = join(resolveWorkspaceDir(workspacePath), 'mcp.json');
  let content: string;
  try { content = await readFile(path, 'utf8'); }
  catch (error: unknown) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return { servers: {} };
    throw new Error('Unable to read MCP configuration', { cause: error });
  }
  try { return mcpConfigSchema.parse(JSON.parse(content)); }
  catch { throw new Error('Invalid mcp.json configuration. Fix the file before saving MCP settings.'); }
}

/** Serialize read-modify-write operations and replace only complete, validated files. */
export async function updateMcpConfig(workspacePath: string, name: string, config: McpServerConfig | null): Promise<void> {
  mcpNameSchema.parse(name);
  if (config !== null) mcpServerConfigSchema.parse(config);
  const directory = resolveWorkspaceDir(workspacePath);
  const previous = writes.get(directory) ?? Promise.resolve();
  const next = previous.catch(() => {}).then(async () => {
    const current = await loadMcpConfig(workspacePath);
    if (config === null) delete current.servers[name];
    else current.servers[name] = config;
    await mkdir(directory, { recursive: true });
    const temporary = join(directory, `mcp.${crypto.randomUUID()}.tmp`);
    await writeFile(temporary, JSON.stringify(current, null, 2) + '\n', { mode: 0o600, flag: 'wx' });
    await rename(temporary, join(directory, 'mcp.json'));
  });
  writes.set(directory, next);
  try { await next; } finally { if (writes.get(directory) === next) writes.delete(directory); }
}

export async function getMcpServers(workspacePath: string): Promise<Record<string, McpServerConfig>> {
  return (await loadMcpConfig(workspacePath)).servers;
}

export function isLocalConfig(config: McpServerConfig): config is McpLocalServerConfig {
  return config.type === 'local';
}

export function isRemoteConfig(config: McpServerConfig): config is McpRemoteServerConfig {
  return config.type === 'remote';
}
