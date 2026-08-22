/**
 * Tool-installation domain: tool repository schema and release URL policy.
 *
 * Owns the exact registry schema (version 3, format "source"), its
 * validation error messages, and the artifact/version URL template
 * resolution. The network fetch implementation stays in
 * `tools/tool-repository.ts` and consumes these rules; this module performs
 * no I/O.
 */

export interface ToolEnvVar {
  name: string;
  required?: boolean;
  sensitive?: boolean;
}

export interface ToolRegistryConfig {
  baseUrl: string;
  urlTemplate: string;
  versionUrlTemplate: string;
}

export interface ToolCategoryMetadata {
  label: string;
  description?: string;
  order?: number;
}

export interface ToolCapabilityMetadata {
  label: string;
  description?: string;
}

export interface ToolRepositoryMetadata {
  categories?: Record<string, ToolCategoryMetadata>;
  capabilities?: Record<string, ToolCapabilityMetadata>;
}

export interface ToolCatalogEntry {
  name: string;
  description: string;
  category?: string;
  capabilities?: string[];
  envVars?: ToolEnvVar[];
  hasSecurity?: boolean;
}

export interface RepositoryTool {
  name: string;
  description: string;
  version: string;
  artifactUrl: string;
  category?: string;
  capabilities?: string[];
  envVars?: ToolEnvVar[];
  hasSecurity?: boolean;
}

export interface ToolRepository {
  version: 3;
  format: 'source';
  registry: ToolRegistryConfig;
  tools: ToolCatalogEntry[];
  metadata?: ToolRepositoryMetadata;
  envConfig?: Record<string, unknown>;
}

export class RepositorySchemaError extends Error {
  constructor(message: string) {
    super(`Invalid tool repository schema: ${message}`);
    this.name = 'RepositorySchemaError';
  }
}

function validateToolEnvVars(tool: Record<string, unknown>, idx: string): void {
  if (tool.envVars === undefined) {
    return;
  }

  if (!Array.isArray(tool.envVars)) {
    throw new RepositorySchemaError(`${idx}.envVars must be an array`);
  }

  for (let j = 0; j < tool.envVars.length; j++) {
    const env = tool.envVars[j] as Record<string, unknown>;
    const envIdx = `${idx}.envVars[${j}]`;

    if (typeof env.name !== 'string' || !env.name) {
      throw new RepositorySchemaError(`${envIdx}.name is required`);
    }
    if (env.required !== undefined && typeof env.required !== 'boolean') {
      throw new RepositorySchemaError(`${envIdx}.required must be a boolean`);
    }
    if (env.sensitive !== undefined && typeof env.sensitive !== 'boolean') {
      throw new RepositorySchemaError(`${envIdx}.sensitive must be a boolean`);
    }
  }
}

function validateMetadataCategories(
  categories: Record<string, unknown>,
  prefix: string,
): void {
  for (const [categoryId, value] of Object.entries(categories)) {
    if (!categoryId) {
      throw new RepositorySchemaError(`${prefix} contains an empty category id`);
    }
    if (!value || typeof value !== 'object') {
      throw new RepositorySchemaError(`${prefix}.${categoryId} must be an object`);
    }
    const category = value as Record<string, unknown>;
    const catIdx = `${prefix}.${categoryId}`;
    if (typeof category.label !== 'string' || !category.label) {
      throw new RepositorySchemaError(`${catIdx}.label is required`);
    }
    if (category.description !== undefined && typeof category.description !== 'string') {
      throw new RepositorySchemaError(`${catIdx}.description must be a string`);
    }
    if (category.order !== undefined && (typeof category.order !== 'number' || !Number.isFinite(category.order))) {
      throw new RepositorySchemaError(`${catIdx}.order must be a finite number`);
    }
  }
}

function validateMetadataCapabilities(
  capabilities: Record<string, unknown>,
  prefix: string,
): void {
  for (const [capabilityId, value] of Object.entries(capabilities)) {
    if (!capabilityId) {
      throw new RepositorySchemaError(`${prefix} contains an empty capability id`);
    }
    if (!value || typeof value !== 'object') {
      throw new RepositorySchemaError(`${prefix}.${capabilityId} must be an object`);
    }
    const capability = value as Record<string, unknown>;
    const capIdx = `${prefix}.${capabilityId}`;
    if (typeof capability.label !== 'string' || !capability.label) {
      throw new RepositorySchemaError(`${capIdx}.label is required`);
    }
    if (capability.description !== undefined && typeof capability.description !== 'string') {
      throw new RepositorySchemaError(`${capIdx}.description must be a string`);
    }
  }
}

function validateMetadata(metadata: Record<string, unknown>): void {
  const prefix = 'metadata';
  if (metadata.categories !== undefined) {
    if (!metadata.categories || typeof metadata.categories !== 'object' || Array.isArray(metadata.categories)) {
      throw new RepositorySchemaError(`${prefix}.categories must be an object`);
    }
    validateMetadataCategories(
      metadata.categories as Record<string, unknown>,
      `${prefix}.categories`,
    );
  }
  if (metadata.capabilities !== undefined) {
    if (!metadata.capabilities || typeof metadata.capabilities !== 'object' || Array.isArray(metadata.capabilities)) {
      throw new RepositorySchemaError(`${prefix}.capabilities must be an object`);
    }
    validateMetadataCapabilities(
      metadata.capabilities as Record<string, unknown>,
      `${prefix}.capabilities`,
    );
  }
}

function validateToolCategoryAndCapabilities(
  tool: Record<string, unknown>,
  idx: string,
  categories: Record<string, unknown> | undefined,
  capabilities: Record<string, unknown> | undefined,
): void {
  if (tool.category !== undefined) {
    if (typeof tool.category !== 'string' || !tool.category) {
      throw new RepositorySchemaError(`${idx}.category must be a non-empty string`);
    }
    if (categories && !Object.hasOwn(categories, tool.category)) {
      throw new RepositorySchemaError(
        `${idx}.category references undefined category "${tool.category}"`,
      );
    }
  }
  if (tool.capabilities !== undefined) {
    if (!Array.isArray(tool.capabilities)) {
      throw new RepositorySchemaError(`${idx}.capabilities must be an array`);
    }
    const seen = new Set<string>();
    for (let k = 0; k < tool.capabilities.length; k++) {
      const cap = tool.capabilities[k];
      const capIdx = `${idx}.capabilities[${k}]`;
      if (typeof cap !== 'string' || !cap) {
        throw new RepositorySchemaError(`${capIdx} must be a non-empty string`);
      }
      if (seen.has(cap)) {
        throw new RepositorySchemaError(`${capIdx} duplicates capability "${cap}"`);
      }
      seen.add(cap);
      if (capabilities && !Object.hasOwn(capabilities, cap)) {
        throw new RepositorySchemaError(
          `${capIdx} references undefined capability "${cap}"`,
        );
      }
    }
  }
}

/** Validate an untrusted parsed registry document. Throws
 * `RepositorySchemaError` with the exact pre-domain message for any
 * violation; returns the typed repository on success. */
export function validateToolRepositoryShape(data: unknown): ToolRepository {
  if (!data || typeof data !== 'object') {
    throw new RepositorySchemaError('expected a JSON object');
  }

  const repo = data as Record<string, unknown>;

  if (repo.version !== 3) {
    throw new RepositorySchemaError(`expected version 3, got ${repo.version}`);
  }

  if (repo.format !== 'source') {
    throw new RepositorySchemaError(
      `expected format "source", got "${repo.format}"`,
    );
  }

  if (!repo.registry || typeof repo.registry !== 'object') {
    throw new RepositorySchemaError('registry is required');
  }

  const registry = repo.registry as Record<string, unknown>;
  if (typeof registry.baseUrl !== 'string' || !registry.baseUrl) {
    throw new RepositorySchemaError('registry.baseUrl is required');
  }
  if (typeof registry.urlTemplate !== 'string' || !registry.urlTemplate) {
    throw new RepositorySchemaError('registry.urlTemplate is required');
  }
  if (typeof registry.versionUrlTemplate !== 'string' || !registry.versionUrlTemplate) {
    throw new RepositorySchemaError('registry.versionUrlTemplate is required');
  }

  if (!Array.isArray(repo.tools)) {
    throw new RepositorySchemaError('tools must be an array');
  }

  let metadataCategories: Record<string, unknown> | undefined;
  let metadataCapabilities: Record<string, unknown> | undefined;
  if (repo.metadata !== undefined) {
    if (!repo.metadata || typeof repo.metadata !== 'object' || Array.isArray(repo.metadata)) {
      throw new RepositorySchemaError('metadata must be an object');
    }
    validateMetadata(repo.metadata as Record<string, unknown>);
    const m = repo.metadata as Record<string, unknown>;
    if (m.categories !== undefined) {
      metadataCategories = m.categories as Record<string, unknown>;
    }
    if (m.capabilities !== undefined) {
      metadataCapabilities = m.capabilities as Record<string, unknown>;
    }
  }

  for (let i = 0; i < repo.tools.length; i++) {
    const tool = repo.tools[i] as Record<string, unknown>;
    const idx = `tools[${i}]`;

    if (typeof tool.name !== 'string' || !tool.name) {
      throw new RepositorySchemaError(`${idx}.name is required`);
    }
    if (typeof tool.description !== 'string' || !tool.description) {
      throw new RepositorySchemaError(`${idx}.description is required`);
    }
    if (tool.hasSecurity !== undefined && typeof tool.hasSecurity !== 'boolean') {
      throw new RepositorySchemaError(`${idx}.hasSecurity must be a boolean`);
    }

    validateToolEnvVars(tool, idx);
    validateToolCategoryAndCapabilities(tool, idx, metadataCategories, metadataCapabilities);
  }

  return data as ToolRepository;
}

/** `{name}`/`{baseUrl}`/`{version}` template substitution policy. */
export function applyRepositoryTemplate(template: string, values: Record<string, string>): string {
  let resolved = template;

  for (const [key, value] of Object.entries(values)) {
    resolved = resolved.replaceAll(`{${key}}`, value);
  }

  return resolved;
}

export function resolveArtifactUrlFor(
  registry: ToolRegistryConfig,
  toolName: string,
  version: string,
): string {
  return applyRepositoryTemplate(registry.urlTemplate, {
    baseUrl: registry.baseUrl,
    name: toolName,
    version,
  });
}

export function resolveVersionUrlFor(
  registry: ToolRegistryConfig,
  toolName: string,
): string {
  return applyRepositoryTemplate(registry.versionUrlTemplate, {
    baseUrl: registry.baseUrl,
    name: toolName,
    version: '',
  });
}
