import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import { mkdirSync, readFileSync, rmSync, writeFileSync, existsSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

import {
  fetchRepository,
  fetchRepositoryWithVersions,
  getToolByName,
  collectEnvVars,
  type ToolRepository,
} from '@/infrastructure/tools/tool-repository';

function createValidRegistry(tempDir: string): ToolRepository {
  return {
    version: 3,
    format: 'source',
    registry: {
      baseUrl: 'https://example.com/releases/download',
      urlTemplate: '{baseUrl}/tool-{name}%2Fv{version}/{name}.tar.gz',
      versionUrlTemplate: `file://${tempDir}/{name}.VERSION`,
    },
    tools: [
      {
        name: 'test-tool',
        description: 'A test tool',
      },
      {
        name: 'tool-with-env',
        description: 'Tool with env vars',
        envVars: [
          { name: 'API_KEY', required: true, sensitive: true },
        ],
      },
    ],
  };
}

describe('tool-repository', () => {
  let tempDir: string;
  let originalRegistryUrl: string | undefined;

  beforeEach(() => {
    tempDir = join(tmpdir(), `jean2-test-repo-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`);
    mkdirSync(tempDir, { recursive: true });
    originalRegistryUrl = process.env.JEAN2_TOOL_REGISTRY_URL;

    writeFileSync(join(tempDir, 'test-tool.VERSION'), '1.0.0\n');
    writeFileSync(join(tempDir, 'tool-with-env.VERSION'), '2.0.0\n');
  });

  afterEach(() => {
    if (existsSync(tempDir)) {
      rmSync(tempDir, { recursive: true, force: true });
    }
    if (originalRegistryUrl !== undefined) {
      process.env.JEAN2_TOOL_REGISTRY_URL = originalRegistryUrl;
    } else {
      delete process.env.JEAN2_TOOL_REGISTRY_URL;
    }
  });

  function setLocalRegistry(data: unknown): string {
    const registryPath = join(tempDir, 'repositoryv3.json');
    writeFileSync(registryPath, JSON.stringify(data, null, 2));
    process.env.JEAN2_TOOL_REGISTRY_URL = `file://${registryPath}`;
    return registryPath;
  }

  describe('fetchRepository', () => {
    test('parses a valid v3 internal source registry', async () => {
      const validRegistry = createValidRegistry(tempDir);
      setLocalRegistry(validRegistry);

      const repo = await fetchRepository();

      expect(repo.version).toBe(3);
      expect(repo.format).toBe('source');
      expect(repo.tools).toHaveLength(2);
      expect(repo.registry.baseUrl).toBe('https://example.com/releases/download');
      expect(repo.tools[0].name).toBe('test-tool');
      expect(repo.tools[1].name).toBe('tool-with-env');
    });

    test('rejects wrong version', async () => {
      setLocalRegistry({
        ...createValidRegistry(tempDir),
        version: 2,
      });

      await expect(fetchRepository()).rejects.toThrow('expected version 3');
    });

    test('rejects wrong format', async () => {
      setLocalRegistry({
        ...createValidRegistry(tempDir),
        format: 'bundled',
      });

      await expect(fetchRepository()).rejects.toThrow('expected format "source"');
    });

    test('rejects non-object input', async () => {
      setLocalRegistry('not an object');
      await expect(fetchRepository()).rejects.toThrow('expected a JSON object');
    });

    test('rejects null input', async () => {
      setLocalRegistry(null);
      await expect(fetchRepository()).rejects.toThrow('expected a JSON object');
    });

    test('rejects missing registry block', async () => {
      const bad = createValidRegistry(tempDir) as unknown as Record<string, unknown>;
      delete bad.registry;
      setLocalRegistry(bad);

      await expect(fetchRepository()).rejects.toThrow('registry is required');
    });

    test('rejects missing registry.baseUrl', async () => {
      const bad = createValidRegistry(tempDir);
      (bad.registry as unknown as Record<string, unknown>).baseUrl = '';
      setLocalRegistry(bad);

      await expect(fetchRepository()).rejects.toThrow('registry.baseUrl is required');
    });

    test('rejects missing registry.urlTemplate', async () => {
      const bad = createValidRegistry(tempDir);
      (bad.registry as unknown as Record<string, unknown>).urlTemplate = '';
      setLocalRegistry(bad);

      await expect(fetchRepository()).rejects.toThrow('registry.urlTemplate is required');
    });

    test('rejects missing registry.versionUrlTemplate', async () => {
      const bad = createValidRegistry(tempDir);
      (bad.registry as unknown as Record<string, unknown>).versionUrlTemplate = '';
      setLocalRegistry(bad);

      await expect(fetchRepository()).rejects.toThrow('registry.versionUrlTemplate is required');
    });

    test('rejects non-array tools', async () => {
      setLocalRegistry({
        ...createValidRegistry(tempDir),
        tools: 'not an array',
      });

      await expect(fetchRepository()).rejects.toThrow('tools must be an array');
    });

    test('rejects tool with missing name', async () => {
      setLocalRegistry({
        ...createValidRegistry(tempDir),
        tools: [{ description: 'desc' }],
      });

      await expect(fetchRepository()).rejects.toThrow('tools[0].name is required');
    });

    test('rejects tool with empty name', async () => {
      setLocalRegistry({
        ...createValidRegistry(tempDir),
        tools: [{ name: '', description: 'desc' }],
      });

      await expect(fetchRepository()).rejects.toThrow('tools[0].name is required');
    });

    test('rejects tool with missing description', async () => {
      setLocalRegistry({
        ...createValidRegistry(tempDir),
        tools: [{ name: 'tool' }],
      });

      await expect(fetchRepository()).rejects.toThrow('tools[0].description is required');
    });

    test('rejects malformed envVars', async () => {
      setLocalRegistry({
        ...createValidRegistry(tempDir),
        tools: [
          {
            name: 'tool',
            description: 'desc',
            envVars: 'bad',
          },
        ],
      });

      await expect(fetchRepository()).rejects.toThrow('tools[0].envVars must be an array');
    });

    test('rejects a non-boolean hasSecurity value', async () => {
      setLocalRegistry({
        ...createValidRegistry(tempDir),
        tools: [{ name: 'tool', description: 'desc', hasSecurity: 'yes' }],
      });

      await expect(fetchRepository()).rejects.toThrow('tools[0].hasSecurity must be a boolean');
    });
  });

  describe('fetchRepositoryWithVersions', () => {
    test('returns tools with dynamically resolved versions and artifact urls', async () => {
      setLocalRegistry(createValidRegistry(tempDir));

      const tools = await fetchRepositoryWithVersions();
      expect(tools).toHaveLength(2);
      expect(tools[0].name).toBe('test-tool');
      expect(tools[0].version).toBe('1.0.0');
      expect(tools[0].artifactUrl).toBe(
        'https://example.com/releases/download/tool-test-tool%2Fv1.0.0/test-tool.tar.gz',
      );

      expect(tools[1].name).toBe('tool-with-env');
      expect(tools[1].version).toBe('2.0.0');
    });
  });

  describe('getToolByName', () => {
    test('returns the matching resolved tool', async () => {
      setLocalRegistry(createValidRegistry(tempDir));

      const tool = await getToolByName('test-tool');
      expect(tool).not.toBeNull();
      expect(tool!.name).toBe('test-tool');
      expect(tool!.version).toBe('1.0.0');
      expect(tool!.artifactUrl).toContain('/tool-test-tool%2Fv1.0.0/test-tool.tar.gz');
    });

    test('returns null for unknown tool', async () => {
      setLocalRegistry(createValidRegistry(tempDir));

      const tool = await getToolByName('nonexistent');
      expect(tool).toBeNull();
    });
  });

  describe('collectEnvVars', () => {
    test('returns env vars for tool with envVars', async () => {
      setLocalRegistry(createValidRegistry(tempDir));

      const envVars = await collectEnvVars('tool-with-env');
      expect(envVars).toHaveLength(1);
      expect(envVars[0].key).toBe('API_KEY');
      expect(envVars[0].sensitive).toBe(true);
      expect(envVars[0].configured).toBe(false);
    });

    test('returns empty array for tool without envVars', async () => {
      setLocalRegistry(createValidRegistry(tempDir));

      const envVars = await collectEnvVars('test-tool');
      expect(envVars).toHaveLength(0);
    });

    test('returns empty array for unknown tool', async () => {
      setLocalRegistry(createValidRegistry(tempDir));

      const envVars = await collectEnvVars('nonexistent');
      expect(envVars).toHaveLength(0);
    });
  });

  describe('checked-in catalog shape', () => {
    test('external catalog carries no recommended flag; the baseline ships built-in', () => {
      const repositoryPath = join(import.meta.dir, '../../../../tools/repositoryv3.json');
      const raw = JSON.parse(readFileSync(repositoryPath, 'utf8')) as {
        tools: Array<Record<string, unknown>>;
      };
      const flagged = raw.tools.filter((tool) => 'recommended' in tool);

      expect(flagged).toEqual([]);
    });

    test('does not advertise integrations removed from the external catalog', () => {
      const repositoryPath = join(import.meta.dir, '../../../../tools/repositoryv3.json');
      const raw = JSON.parse(readFileSync(repositoryPath, 'utf8')) as {
        metadata?: { categories?: Record<string, unknown> };
        tools: Array<{ name: string }>;
      };
      const names = raw.tools.map((tool) => tool.name);
      const manifestPath = join(import.meta.dir, '../../../../tools/manifest.json');
      const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as { tools: string[] };

      expect(names.some((name) => name.startsWith('gmail-'))).toBe(false);
      expect(names.some((name) => name.startsWith('discord-'))).toBe(false);
      expect(names).not.toContain('file-to-markdown');
      expect(names.some((name) => name.startsWith('tavily-'))).toBe(false);
      expect(manifest.tools.some((name) => name.startsWith('tavily-'))).toBe(false);
      expect(raw.metadata?.categories).not.toHaveProperty('communication');
      expect(raw.metadata?.categories).not.toHaveProperty('filesystem');
      expect(raw.metadata?.categories).not.toHaveProperty('web');
    });
  });

  describe('repository with envConfig', () => {
    test('parses envConfig section', async () => {
      const withConfig: ToolRepository = {
        ...createValidRegistry(tempDir),
        envConfig: {
          API_KEY: {
            description: 'An API key',
            sensitive: true,
            required: true,
            usedBy: ['test-tool'],
          },
        },
      };
      setLocalRegistry(withConfig);

      const repo = await fetchRepository();
      expect(repo.envConfig).toBeDefined();
      expect((repo.envConfig as Record<string, unknown>).API_KEY).toBeDefined();
    });
  });

  describe('metadata, categories, and capabilities', () => {
    test('accepts a repository without metadata, category, or capabilities', async () => {
      setLocalRegistry(createValidRegistry(tempDir));

      const repo = await fetchRepository();
      expect(repo.metadata).toBeUndefined();
      expect(repo.tools[0].category).toBeUndefined();
      expect(repo.tools[0].capabilities).toBeUndefined();
    });

    test('parses valid metadata with categories and capabilities', async () => {
      const reg = {
        ...createValidRegistry(tempDir),
        metadata: {
          categories: {
            filesystem: {
              label: 'Filesystem',
              description: 'Read and write files.',
              order: 10,
            },
          },
          capabilities: {
            'interactive-user-input': {
              label: 'Interactive user input',
              description: 'Needs a user.',
            },
          },
        },
        tools: [
          {
            name: 'test-tool',
            description: 'A test tool',
            category: 'filesystem',
            capabilities: ['interactive-user-input'],
          },
          {
            name: 'tool-with-env',
            description: 'Tool with env vars',
            category: 'filesystem',
            envVars: [
              { name: 'API_KEY', required: true, sensitive: true },
            ],
          },
        ],
      };
      setLocalRegistry(reg);

      const repo = await fetchRepository();
      expect(repo.metadata?.categories?.filesystem.label).toBe('Filesystem');
      expect(repo.metadata?.capabilities?.['interactive-user-input'].label).toBe('Interactive user input');
      expect(repo.tools[0].category).toBe('filesystem');
      expect(repo.tools[0].capabilities).toEqual(['interactive-user-input']);
    });

    test('version resolution preserves category and capabilities', async () => {
      const reg = {
        ...createValidRegistry(tempDir),
        metadata: {
          categories: { filesystem: { label: 'Filesystem' } },
          capabilities: { 'interactive-user-input': { label: 'Interactive user input' } },
        },
        tools: [
          {
            name: 'test-tool',
            description: 'A test tool',
            category: 'filesystem',
            capabilities: ['interactive-user-input'],
          },
        ],
      };
      setLocalRegistry(reg);

      const tools = await fetchRepositoryWithVersions();
      expect(tools[0].category).toBe('filesystem');
      expect(tools[0].capabilities).toEqual(['interactive-user-input']);
    });

    test('rejects non-object metadata', async () => {
      setLocalRegistry({
        ...createValidRegistry(tempDir),
        metadata: 'bad',
      });
      await expect(fetchRepository()).rejects.toThrow('metadata must be an object');
    });

    test('rejects empty category id', async () => {
      setLocalRegistry({
        ...createValidRegistry(tempDir),
        metadata: { categories: { '': { label: 'X' } } },
      });
      await expect(fetchRepository()).rejects.toThrow('contains an empty category id');
    });

    test('rejects empty capability id', async () => {
      setLocalRegistry({
        ...createValidRegistry(tempDir),
        metadata: { capabilities: { '': { label: 'X' } } },
      });
      await expect(fetchRepository()).rejects.toThrow('contains an empty capability id');
    });

    test('rejects category missing label', async () => {
      setLocalRegistry({
        ...createValidRegistry(tempDir),
        metadata: { categories: { fs: { description: 'X' } } },
      });
      await expect(fetchRepository()).rejects.toThrow('metadata.categories.fs.label is required');
    });

    test('rejects empty category label', async () => {
      setLocalRegistry({
        ...createValidRegistry(tempDir),
        metadata: { categories: { fs: { label: '' } } },
      });
      await expect(fetchRepository()).rejects.toThrow('metadata.categories.fs.label is required');
    });

    test('rejects category description of wrong type', async () => {
      setLocalRegistry({
        ...createValidRegistry(tempDir),
        metadata: { categories: { fs: { label: 'X', description: 5 } } },
      });
      await expect(fetchRepository()).rejects.toThrow('description must be a string');
    });

    test('rejects category order that is not a finite number', async () => {
      setLocalRegistry({
        ...createValidRegistry(tempDir),
        metadata: { categories: { fs: { label: 'X', order: Number.POSITIVE_INFINITY } } },
      });
      await expect(fetchRepository()).rejects.toThrow('order must be a finite number');
    });

    test('rejects capability missing label', async () => {
      setLocalRegistry({
        ...createValidRegistry(tempDir),
        metadata: { capabilities: { interactive: { description: 'X' } } },
      });
      await expect(fetchRepository()).rejects.toThrow('metadata.capabilities.interactive.label is required');
    });

    test('rejects empty capability label', async () => {
      setLocalRegistry({
        ...createValidRegistry(tempDir),
        metadata: { capabilities: { interactive: { label: '' } } },
      });
      await expect(fetchRepository()).rejects.toThrow('metadata.capabilities.interactive.label is required');
    });

    test('rejects capability description of wrong type', async () => {
      setLocalRegistry({
        ...createValidRegistry(tempDir),
        metadata: { capabilities: { interactive: { label: 'X', description: 5 } } },
      });
      await expect(fetchRepository()).rejects.toThrow('description must be a string');
    });

    test('rejects tool category of wrong type', async () => {
      setLocalRegistry({
        ...createValidRegistry(tempDir),
        tools: [{ name: 'tool', description: 'd', category: 5 }],
      });
      await expect(fetchRepository()).rejects.toThrow('category must be a non-empty string');
    });

    test('rejects empty tool category', async () => {
      setLocalRegistry({
        ...createValidRegistry(tempDir),
        tools: [{ name: 'tool', description: 'd', category: '' }],
      });
      await expect(fetchRepository()).rejects.toThrow('category must be a non-empty string');
    });

    test('rejects tool capabilities that are not an array', async () => {
      setLocalRegistry({
        ...createValidRegistry(tempDir),
        tools: [{ name: 'tool', description: 'd', capabilities: 'bad' }],
      });
      await expect(fetchRepository()).rejects.toThrow('capabilities must be an array');
    });

    test('rejects empty capability entry', async () => {
      setLocalRegistry({
        ...createValidRegistry(tempDir),
        tools: [{ name: 'tool', description: 'd', capabilities: [''] }],
      });
      await expect(fetchRepository()).rejects.toThrow('capabilities[0] must be a non-empty string');
    });

    test('rejects non-string capability entry', async () => {
      setLocalRegistry({
        ...createValidRegistry(tempDir),
        tools: [{ name: 'tool', description: 'd', capabilities: [5] }],
      });
      await expect(fetchRepository()).rejects.toThrow('capabilities[0] must be a non-empty string');
    });

    test('rejects duplicate tool capabilities', async () => {
      setLocalRegistry({
        ...createValidRegistry(tempDir),
        tools: [{ name: 'tool', description: 'd', capabilities: ['a', 'a'] }],
      });
      await expect(fetchRepository()).rejects.toThrow('duplicates capability "a"');
    });

    test('rejects tool category that references undefined category', async () => {
      setLocalRegistry({
        ...createValidRegistry(tempDir),
        metadata: { categories: { fs: { label: 'Filesystem' } } },
        tools: [{ name: 'tool', description: 'd', category: 'web' }],
      });
      await expect(fetchRepository()).rejects.toThrow('references undefined category "web"');
    });

    test('rejects inherited object property as a category reference', async () => {
      setLocalRegistry({
        ...createValidRegistry(tempDir),
        metadata: { categories: {} },
        tools: [{ name: 'tool', description: 'd', category: 'constructor' }],
      });
      await expect(fetchRepository()).rejects.toThrow('references undefined category "constructor"');
    });

    test('rejects tool capability that references undefined capability', async () => {
      setLocalRegistry({
        ...createValidRegistry(tempDir),
        metadata: { capabilities: { foo: { label: 'Foo' } } },
        tools: [{ name: 'tool', description: 'd', capabilities: ['bar'] }],
      });
      await expect(fetchRepository()).rejects.toThrow('references undefined capability "bar"');
    });

    test('rejects inherited object property as a capability reference', async () => {
      setLocalRegistry({
        ...createValidRegistry(tempDir),
        metadata: { capabilities: {} },
        tools: [{ name: 'tool', description: 'd', capabilities: ['toString'] }],
      });
      await expect(fetchRepository()).rejects.toThrow('references undefined capability "toString"');
    });

    test('accepts tool category without a category metadata catalog', async () => {
      setLocalRegistry({
        ...createValidRegistry(tempDir),
        tools: [{ name: 'tool', description: 'd', category: 'web' }],
      });

      const repo = await fetchRepository();
      expect(repo.tools[0].category).toBe('web');
    });

    test('accepts tool capabilities without a capability metadata catalog', async () => {
      setLocalRegistry({
        ...createValidRegistry(tempDir),
        tools: [{ name: 'tool', description: 'd', capabilities: ['unknown-cap'] }],
      });

      const repo = await fetchRepository();
      expect(repo.tools[0].capabilities).toEqual(['unknown-cap']);
    });
  });
});
