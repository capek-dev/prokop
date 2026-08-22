import type { RepositoryTool } from './repository-schema';

/**
 * Tool-installation domain: tool selection policy for the CLI install
 * flows. Moved byte-for-byte from `tools/tools-cli.ts`; the CLI module
 * re-exports these identities for compatibility.
 */

export function excludeInstalledTools(
  tools: RepositoryTool[],
  installedNames: Iterable<string>,
): RepositoryTool[] {
  const installedSet = new Set(installedNames);
  return tools.filter((tool) => !installedSet.has(tool.name));
}

export interface ToolInstallCliOptions {
  names?: string[];
  all?: boolean;
  force?: boolean;
}

export function validateInstallOptions(options: ToolInstallCliOptions): string | null {
  const hasNames = (options.names?.length ?? 0) > 0;

  if (hasNames && options.all) {
    return 'Cannot combine tool names with --all.';
  }

  return null;
}
