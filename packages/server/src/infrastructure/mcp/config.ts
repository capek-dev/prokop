import { readFile } from 'fs/promises';
import { join } from 'path';
import type {
  McpConfig,
  McpServerConfig,
  McpLocalServerConfig,
  McpRemoteServerConfig,
} from '@jean2/sdk';

const MCP_CONFIG_PATH = '.jean2/mcp.json';

export async function loadMcpConfig(workspacePath: string): Promise<McpConfig> {
  const configPath = join(workspacePath, MCP_CONFIG_PATH);

  try {
    const content = await readFile(configPath, 'utf-8');
    const config = JSON.parse(content) as McpConfig;

    if (!config.servers || typeof config.servers !== 'object') {
      return { servers: {} };
    }

    return config;
  } catch (_err: unknown) {
    return { servers: {} };
  }
}

export async function getMcpServers(
  workspacePath: string,
): Promise<Record<string, McpServerConfig>> {
  const config = await loadMcpConfig(workspacePath);
  const servers: Record<string, McpServerConfig> = {};

  for (const [name, serverConfig] of Object.entries(config.servers)) {
    if (serverConfig.enabled !== false) {
      servers[name] = serverConfig;
    }
  }

  return servers;
}

export function isLocalConfig(
  config: McpServerConfig,
): config is McpLocalServerConfig {
  return config.type === 'local';
}

export function isRemoteConfig(
  config: McpServerConfig,
): config is McpRemoteServerConfig {
  return config.type === 'remote';
}
