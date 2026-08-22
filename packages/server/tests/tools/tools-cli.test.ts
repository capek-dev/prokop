import { describe, expect, test } from 'bun:test';

import {
  excludeInstalledTools,
  runToolsCommand,
  validateInstallOptions,
} from '@/cli/tools-cli';
import type { RepositoryTool } from '@/infrastructure/tools/tool-repository';

const tools: RepositoryTool[] = [
  {
    name: 'read-file',
    description: 'Read files',
    version: '1.0.0',
    artifactUrl: 'https://example.com/read-file.tar.gz',
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

describe('validateInstallOptions', () => {
  test('allows each install mode independently', () => {
    expect(validateInstallOptions({ names: ['grep'] })).toBeNull();
    expect(validateInstallOptions({ all: true })).toBeNull();
    expect(validateInstallOptions({})).toBeNull();
  });

  test('rejects combining names with a bulk install mode', () => {
    expect(validateInstallOptions({ names: ['grep'], all: true })).toBe(
      'Cannot combine tool names with --all.',
    );
  });
});

describe('runToolsCommand', () => {
  test('routes bulk install flags into install option validation', async () => {
    const result = await runToolsCommand({
      subCommand: 'install',
      flags: { all: true },
      names: ['grep'],
    });

    expect(result).toEqual({
      success: false,
      error: 'Cannot combine tool names with --all.',
      exitCode: 1,
    });
  });
});
