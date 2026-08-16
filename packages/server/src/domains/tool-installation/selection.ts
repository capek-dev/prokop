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

export function selectRecommendedTools(tools: RepositoryTool[]): RepositoryTool[] {
  return tools.filter((tool) => tool.recommended === true);
}

export interface ToolInstallCliOptions {
  names?: string[];
  all?: boolean;
  recommended?: boolean;
  force?: boolean;
}

export function validateInstallOptions(options: ToolInstallCliOptions): string | null {
  const hasNames = (options.names?.length ?? 0) > 0;

  if (options.all && options.recommended) {
    return 'Cannot combine --all with --recommended.';
  }
  if (hasNames && (options.all || options.recommended)) {
    return 'Cannot combine tool names with --all or --recommended.';
  }

  return null;
}
