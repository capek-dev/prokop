import { describe, expect, test } from 'bun:test';

import {
  excludeInstalledTools,
  runToolsCommand,
  selectRecommendedTools,
  validateInstallOptions,
} from '@/tools/tools-cli';
import type { RepositoryTool } from '@/infrastructure/tools/tool-repository';

const tools: RepositoryTool[] = [
  {
    name: 'read-file',
    description: 'Read files',
    version: '1.0.0',
    artifactUrl: 'https://example.com/read-file.tar.gz',
    recommended: true,
  },
  {
    name: 'write-file',
    description: 'Write files',
    version: '1.0.0',
    artifactUrl: 'https://example.com/write-file.tar.gz',
  },
  {
    name: 'grep',
    description: 'Search files',
    version: '1.0.0',
    artifactUrl: 'https://example.com/grep.tar.gz',
    recommended: true,
  },
];

describe('excludeInstalledTools', () => {
  test('removes installed tools while preserving repository order', () => {
    const availableTools = excludeInstalledTools(tools, ['write-file']);

    expect(availableTools.map((tool) => tool.name)).toEqual([
      'read-file',
      'grep',
    ]);
  });

  test('returns an empty list when every tool is installed', () => {
    const availableTools = excludeInstalledTools(
      tools,
      tools.map((tool) => tool.name),
    );

    expect(availableTools).toEqual([]);
  });
});

describe('selectRecommendedTools', () => {
  test('returns only recommended tools in repository order', () => {
    const recommended = selectRecommendedTools(tools);

    expect(recommended.map((tool) => tool.name)).toEqual([
      'read-file',
      'grep',
    ]);
  });

  test('returns an empty list without falling back to all tools', () => {
    const unmarked = tools.map((tool) => ({ ...tool, recommended: undefined }));

    expect(selectRecommendedTools(unmarked)).toEqual([]);
  });
});

describe('validateInstallOptions', () => {
  test('allows each install mode independently', () => {
    expect(validateInstallOptions({ names: ['grep'] })).toBeNull();
    expect(validateInstallOptions({ all: true })).toBeNull();
    expect(validateInstallOptions({ recommended: true })).toBeNull();
    expect(validateInstallOptions({})).toBeNull();
  });

  test('rejects combining --all with --recommended', () => {
    expect(validateInstallOptions({ all: true, recommended: true })).toBe(
      'Cannot combine --all with --recommended.',
    );
  });

  test('rejects combining names with a bulk install mode', () => {
    expect(validateInstallOptions({ names: ['grep'], all: true })).toBe(
      'Cannot combine tool names with --all or --recommended.',
    );
    expect(validateInstallOptions({ names: ['grep'], recommended: true })).toBe(
      'Cannot combine tool names with --all or --recommended.',
    );
  });
});

describe('runToolsCommand', () => {
  test('routes recommended install flags into install option validation', async () => {
    const result = await runToolsCommand({
      subCommand: 'install',
      flags: { all: true, recommended: true },
      names: [],
    });

    expect(result).toEqual({
      success: false,
      error: 'Cannot combine --all with --recommended.',
      exitCode: 1,
    });
  });
});
