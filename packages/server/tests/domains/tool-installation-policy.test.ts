import { describe, expect, test } from 'bun:test';
import { join } from 'path';
import {
  buildSourceInstallManifest,
  buildUrlInstallManifest,
  defaultEntry,
  INSTALL_STRATEGY_SOURCE_NPM,
  INSTALL_STRATEGY_SOURCE_NPM_BUNDLE,
  isPreviousEntry,
  isStagingEntry,
  readVersionValue,
  requireArtifactPackageJson,
  toolInstallDir,
  TOOL_RUNTIME,
  validateToolModuleExports,
  VERSION_FILE,
} from '@/domains/tool-installation';
import {
  excludeInstalledTools,
  selectRecommendedTools,
  validateInstallOptions,
} from '@/domains/tool-installation';
import {
  applyRepositoryTemplate,
  RepositorySchemaError,
  resolveArtifactUrlFor,
  resolveVersionUrlFor,
  validateToolRepositoryShape,
  type RepositoryTool,
  type ToolRepository,
} from '@/domains/tool-installation';

describe('tool-installation domain: layout and version policy', () => {
  test('pins the layout and staging naming rules', () => {
    expect(VERSION_FILE).toBe('VERSION');
    expect(toolInstallDir('/tools', 'demo')).toBe(join('/tools', 'demo'));
    expect(isStagingEntry('demo.staging')).toBe(true);
    expect(isStagingEntry('demo')).toBe(false);
    expect(isPreviousEntry('demo.previous')).toBe(true);
    expect(isPreviousEntry('demo')).toBe(false);
  });

  test('reads version values with the exact trim and empty fallback', () => {
    expect(readVersionValue('1.2.3\n')).toBe('1.2.3');
    expect(readVersionValue('  \n')).toBeNull();
    expect(readVersionValue(null)).toBeNull();
  });

  test('pins the entry fallback and the exact module export contract', () => {
    expect(defaultEntry(true)).toBe('tool.js');
    expect(defaultEntry(false)).toBe('tool.ts');

    expect(validateToolModuleExports({ definition: { name: 'demo' }, execute: () => {} })).toBe('demo');
    expect(() => validateToolModuleExports({ execute: () => {} })).toThrow(
      'Tool must export "definition" and "execute"',
    );
    expect(() => validateToolModuleExports({ definition: {}, execute: () => {} })).toThrow(
      'tool.definition.name is required',
    );
    expect(() => validateToolModuleExports({ definition: { name: 'x' } })).toThrow(
      'Tool must export "definition" and "execute"',
    );
  });
});

describe('tool-installation domain: install manifest policy', () => {
  test('builds the source manifest with the exact fields and strategy', () => {
    const manifest = buildSourceInstallManifest({
      toolName: 'demo',
      version: '1.0.0',
      installedAt: '2026-08-16T00:00:00.000Z',
      sourcePath: '/src/demo',
      entry: 'tool.js',
      sdkVersion: '1.2.3',
      sdkIntegrity: 'sha512-abc',
    });
    expect(manifest).toEqual({
      toolName: 'demo',
      toolVersion: '1.0.0',
      installedAt: '2026-08-16T00:00:00.000Z',
      sourcePath: '/src/demo',
      entry: 'tool.js',
      runtime: TOOL_RUNTIME,
      installStrategy: INSTALL_STRATEGY_SOURCE_NPM,
      sdkVersion: '1.2.3',
      sdkIntegrity: 'sha512-abc',
    });

    const withoutSdk = buildSourceInstallManifest({
      toolName: 'demo',
      version: null,
      installedAt: 't',
      sourcePath: '/s',
      entry: 'tool.ts',
    });
    expect(withoutSdk.sdkVersion).toBeUndefined();
    expect(withoutSdk.sdkIntegrity).toBeUndefined();
    expect(withoutSdk.toolVersion).toBeNull();
    expect(withoutSdk.installStrategy).toBe('source+npm');
  });

  test('builds the url manifest with the bundle strategy and optional checksum', () => {
    const manifest = buildUrlInstallManifest({
      toolName: 'demo',
      version: '2.0.0',
      installedAt: 't',
      sourceUrl: 'https://example.com/demo.tar.gz',
      artifactSha256: 'sha256-abc',
      entry: 'tool.js',
    });
    expect(manifest).toEqual({
      toolName: 'demo',
      toolVersion: '2.0.0',
      installedAt: 't',
      sourceUrl: 'https://example.com/demo.tar.gz',
      artifactSha256: 'sha256-abc',
      entry: 'tool.js',
      runtime: TOOL_RUNTIME,
      installStrategy: INSTALL_STRATEGY_SOURCE_NPM_BUNDLE,
    });

    const noChecksum = buildUrlInstallManifest({
      toolName: 'demo',
      version: '1',
      installedAt: 't',
      sourceUrl: 'u',
      entry: 'tool.js',
    });
    expect(noChecksum.artifactSha256).toBeUndefined();
    expect(noChecksum.installStrategy).toBe('source+npm+bundle');
  });

  test('requires package.json in downloadable artifacts', () => {
    expect(requireArtifactPackageJson({ hasPackageJson: true })).toBe(true);
    expect(requireArtifactPackageJson({ hasPackageJson: false })).toBe(false);
  });
});

describe('tool-installation domain: selection policy', () => {
  const tools = [
    { name: 'a', description: '', version: '1', artifactUrl: 'u', recommended: true },
    { name: 'b', description: '', version: '1', artifactUrl: 'u' },
  ] as RepositoryTool[];

  test('excludes installed tools in repository order', () => {
    expect(excludeInstalledTools(tools, ['b']).map((tool) => tool.name)).toEqual(['a']);
    expect(excludeInstalledTools(tools, ['a', 'b'])).toEqual([]);
  });

  test('selects only recommended tools without falling back', () => {
    expect(selectRecommendedTools(tools).map((tool) => tool.name)).toEqual(['a']);
    expect(selectRecommendedTools([tools[1]])).toEqual([]);
  });

  test('validates install option combinations with the exact messages', () => {
    expect(validateInstallOptions({ names: ['a'] })).toBeNull();
    expect(validateInstallOptions({ all: true })).toBeNull();
    expect(validateInstallOptions({ recommended: true })).toBeNull();
    expect(validateInstallOptions({})).toBeNull();
    expect(validateInstallOptions({ all: true, recommended: true })).toBe(
      'Cannot combine --all with --recommended.',
    );
    expect(validateInstallOptions({ names: ['a'], all: true })).toBe(
      'Cannot combine tool names with --all or --recommended.',
    );
    expect(validateInstallOptions({ names: ['a'], recommended: true })).toBe(
      'Cannot combine tool names with --all or --recommended.',
    );
  });
});

describe('tool-installation domain: repository schema and release URL policy', () => {
  const validRepository: ToolRepository = {
    version: 3,
    format: 'source',
    registry: {
      baseUrl: 'https://example.com',
      urlTemplate: '{baseUrl}/tools/{name}/{version}.tar.gz',
      versionUrlTemplate: '{baseUrl}/tools/{name}/VERSION',
    },
    tools: [
      { name: 'demo', description: 'Demo', recommended: true, envVars: [{ name: 'DEMO_KEY', required: true }] },
    ],
  };

  test('accepts a valid v3 registry and preserves the typed shape', () => {
    expect(validateToolRepositoryShape(validRepository)).toEqual(validRepository);
  });

  test('rejects version, format, registry, and tools violations with the exact messages', () => {
    expect(() => validateToolRepositoryShape({ ...validRepository, version: 2 })).toThrow(
      'Invalid tool repository schema: expected version 3, got 2',
    );
    expect(() => validateToolRepositoryShape({ ...validRepository, format: 'binary' })).toThrow(
      'Invalid tool repository schema: expected format "source", got "binary"',
    );
    expect(() => validateToolRepositoryShape({ ...validRepository, registry: undefined })).toThrow(
      'Invalid tool repository schema: registry is required',
    );
    expect(() => validateToolRepositoryShape({ ...validRepository, registry: {} })).toThrow(
      'Invalid tool repository schema: registry.baseUrl is required',
    );
    expect(() => validateToolRepositoryShape({ ...validRepository, tools: 'nope' })).toThrow(
      'Invalid tool repository schema: tools must be an array',
    );
    expect(() => validateToolRepositoryShape(null)).toThrow(
      'Invalid tool repository schema: expected a JSON object',
    );
    expect(
      () => validateToolRepositoryShape({
        ...validRepository,
        tools: [{ name: 'x', description: 'd', envVars: 'nope' }],
      }),
    ).toThrow('Invalid tool repository schema: tools[0].envVars must be an array');
    expect(
      () => validateToolRepositoryShape({
        ...validRepository,
        tools: [{ name: 'x', description: 'd', category: 'ghost' }],
        metadata: { categories: {} },
      }),
    ).toThrow('Invalid tool repository schema: tools[0].category references undefined category "ghost"');
    expect(
      () => validateToolRepositoryShape({
        ...validRepository,
        tools: [{ name: 'x', description: 'd', capabilities: ['ghost'] }],
        metadata: { capabilities: {} },
      }),
    ).toThrow('Invalid tool repository schema: tools[0].capabilities[0] references undefined capability "ghost"');
  });

  test('pins the RepositorySchemaError identity and name', () => {
    const error = new RepositorySchemaError('boom');
    expect(error).toBeInstanceOf(Error);
    expect(error.name).toBe('RepositorySchemaError');
    expect(error.message).toBe('Invalid tool repository schema: boom');
  });

  test('resolves release URLs with the exact template substitution', () => {
    const registry = validRepository.registry;
    expect(resolveVersionUrlFor(registry, 'demo')).toBe('https://example.com/tools/demo/VERSION');
    expect(resolveArtifactUrlFor(registry, 'demo', '1.2.3')).toBe(
      'https://example.com/tools/demo/1.2.3.tar.gz',
    );
    expect(applyRepositoryTemplate('{name}-{missing}', { name: 'demo' })).toBe('demo-{missing}');
  });
});
