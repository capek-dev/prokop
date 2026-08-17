import type { ToolEnvVarStatus } from '@jean2/sdk';
import {
  applyRepositoryTemplate,
  resolveArtifactUrlFor,
  resolveVersionUrlFor,
  validateToolRepositoryShape,
  type RepositoryTool,
  type ToolRepository,
} from '@/domains/tool-installation';

export {
  RepositorySchemaError,
  type ToolCategoryMetadata,
  type ToolCapabilityMetadata,
  type ToolCatalogEntry,
  type ToolEnvVar,
  type ToolRegistryConfig,
  type ToolRepositoryMetadata,
  type RepositoryTool,
  type ToolRepository,
} from '@/domains/tool-installation';

const DEFAULT_REGISTRY_URL =
  'https://raw.githubusercontent.com/jean2ai/jean2/main/tools/repositoryv3.json';
const REPOSITORY_TIMEOUT = 10000;

function getRegistryUrl(): string {
  return process.env.JEAN2_TOOL_REGISTRY_URL || DEFAULT_REGISTRY_URL;
}

async function fetchText(url: string): Promise<string> {
  const response = await fetch(url, {
    signal: AbortSignal.timeout(REPOSITORY_TIMEOUT),
  });

  if (!response.ok) {
    throw new Error(`Failed to fetch ${url}: ${response.status} ${response.statusText}`);
  }

  return response.text();
}

async function fetchToolVersion(
  registry: ToolRepository['registry'],
  toolName: string,
): Promise<string> {
  const versionUrl = resolveVersionUrlFor(registry, toolName);

  const version = (await fetchText(versionUrl)).trim();
  if (!version) {
    throw new Error(`Empty version for tool ${toolName}`);
  }

  return version;
}

export async function fetchRepository(): Promise<ToolRepository> {
  const url = getRegistryUrl();
  const response = await fetch(url, {
    signal: AbortSignal.timeout(REPOSITORY_TIMEOUT),
  });

  if (!response.ok) {
    throw new Error(
      `Failed to fetch tool repository: ${response.status} ${response.statusText}`,
    );
  }

  const data = await response.json();
  return validateToolRepositoryShape(data);
}

export async function fetchRepositoryWithVersions(): Promise<RepositoryTool[]> {
  const repo = await fetchRepository();

  return Promise.all(
    repo.tools.map(async (tool) => {
      const version = await fetchToolVersion(repo.registry, tool.name);
      const artifactUrl = resolveArtifactUrlFor(repo.registry, tool.name, version);

      return {
        name: tool.name,
        description: tool.description,
        version,
        artifactUrl,
        category: tool.category,
        capabilities: tool.capabilities,
        recommended: tool.recommended,
        envVars: tool.envVars,
        hasSecurity: tool.hasSecurity,
      } satisfies RepositoryTool;
    }),
  );
}

export async function collectEnvVars(toolName: string): Promise<ToolEnvVarStatus[]> {
  const repo = await fetchRepository();
  const tool = repo.tools.find((t) => t.name === toolName);

  if (!tool?.envVars) {
    return [];
  }

  return tool.envVars.map((env) => ({
    key: env.name,
    configured: false,
    sensitive: env.sensitive ?? false,
  }));
}

export async function getToolByName(toolName: string): Promise<RepositoryTool | null> {
  const tools = await fetchRepositoryWithVersions();
  return tools.find((t) => t.name === toolName) ?? null;
}

export { applyRepositoryTemplate };
