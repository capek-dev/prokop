import { log, multiselect, confirm, isCancel, cancel, spinner } from '@clack/prompts';

import { restoreTerminalState } from './clack-utils';

import {
  fetchRepositoryWithVersions,
  type RepositoryTool,
} from '@/infrastructure/tools/tool-repository';

import {
  installToolFromUrl,
  removeTool,
  getInstalledTools,
  getToolsBaseDir,
} from '@/infrastructure/tools/tool-installer';

const INTERACTIVE_INSTALL_VISIBLE_ITEMS = 10;

import {
  excludeInstalledTools,
  selectRecommendedTools,
  validateInstallOptions,
} from '@/domains/tool-installation';

export {
  excludeInstalledTools,
  selectRecommendedTools,
  validateInstallOptions,
};

function pluralize(count: number, singular: string, plural?: string): string {
  return count === 1 ? singular : (plural || `${singular}s`);
}

export interface ListOptions {
  installed?: boolean;
  json?: boolean;
}

export interface ToolsCliResult {
  success: boolean;
  error?: string;
  exitCode?: number;
}

export async function toolsList(options: ListOptions): Promise<ToolsCliResult> {
  try {
    const fetchSpinner = spinner();
    fetchSpinner.start('Fetching tool registry...');
    const tools = await fetchRepositoryWithVersions();
    fetchSpinner.stop('Fetching tool registry... done');
    restoreTerminalState();

    const toolsDir = getToolsBaseDir();
    const installedTools = await getInstalledTools(toolsDir);
    const installedSet = new Set(installedTools.map((t) => t.name));

    let displayTools = tools;
    if (options.installed) {
      displayTools = [];
      for (const tool of tools) {
        if (installedSet.has(tool.name)) {
          displayTools.push(tool);
        }
      }
    }

    if (options.json) {
      const result = displayTools.map((t) => ({
        name: t.name,
        version: t.version,
        installed: installedSet.has(t.name),
        description: t.description,
      }));
      console.log(JSON.stringify(result, null, 2));
      return { success: true };
    }

    log.step('jean2 tools · list');
    log.step('');
    const TOOL_COL = 14;
    const VERS_COL = 8;
    const STATUS_COL = 13;

    let maxNameLen = TOOL_COL;
    for (const tool of displayTools) {
      maxNameLen = Math.max(maxNameLen, tool.name.length);
    }

    log.step(`  ${'Tool'.padEnd(maxNameLen)}${'Version'.padEnd(VERS_COL)}${'Status'.padEnd(STATUS_COL)}Description`);
    log.step(`  ${'─'.repeat(maxNameLen)}${'─'.repeat(VERS_COL)}${'─'.repeat(STATUS_COL)}${'─'.repeat(20)}`);

    for (const tool of displayTools) {
      const installed = installedSet.has(tool.name);
      const status = installed ? '✔ installed' : '— available';

      const desc = tool.description;

      const namePad = tool.name.padEnd(maxNameLen);
      const versionPad = (tool.version || '?').padEnd(VERS_COL);
      const statusPad = status.padEnd(STATUS_COL);
      log.step(`  ${namePad}${versionPad}${statusPad}${desc}`);
    }

    log.step('');
    const installedCount = installedTools.length;
    log.step(`  ${installedCount} installed, ${tools.length} available`);

    log.step('✨ Done');
    return { success: true };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    log.error(message);
    return { success: false, error: message };
  }
}

export interface CliInstallOptions {
  names?: string[];
  all?: boolean;
  recommended?: boolean;
  force?: boolean;
}

interface TaskResult {
  status: 'ok' | 'error';
  value?: string;
  reason?: unknown;
}

export async function toolsInstall(options: CliInstallOptions): Promise<ToolsCliResult> {
  const validationError = validateInstallOptions(options);
  if (validationError) {
    log.error(validationError);
    return { success: false, error: validationError, exitCode: 1 };
  }

  const toolArgs = options.names || [];
  const isInteractive = toolArgs.length === 0 && !options.all && !options.recommended;

  let tools: RepositoryTool[];

  try {
    const fetchSpinner = spinner();
    fetchSpinner.start('Fetching tool registry...');
    tools = await fetchRepositoryWithVersions();
    fetchSpinner.stop('Fetching tool registry... done');
    restoreTerminalState();
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    log.error(message);
    return { success: false, error: message };
  }

  const toolsDir = getToolsBaseDir();
  let selected: RepositoryTool[];

  if (options.all) {
    selected = tools;
  } else if (options.recommended) {
    selected = selectRecommendedTools(tools);
    if (selected.length === 0) {
      const error = 'The tool registry does not define any recommended tools.';
      log.error(error);
      return { success: false, error, exitCode: 1 };
    }
  } else if (isInteractive) {
    const installedTools = await getInstalledTools(toolsDir);
    const availableTools = excludeInstalledTools(
      tools,
      installedTools.map((tool) => tool.name),
    );

    if (availableTools.length === 0) {
      log.step('All available tools are already installed.');
      return { success: true };
    }

    const choices = availableTools.map((tool) => ({
      value: tool.name,
      label: tool.name,
      hint: `v${tool.version}   ${tool.description}`,
    }));

    const selectedNames = await multiselect({
      message: 'Select tools to install:',
      options: choices,
      maxItems: INTERACTIVE_INSTALL_VISIBLE_ITEMS,
      required: false,
    });

    restoreTerminalState();

    if (isCancel(selectedNames)) {
      cancel();
      return { success: true };
    }

    if (!selectedNames || (Array.isArray(selectedNames) && selectedNames.length === 0)) {
      return { success: true };
    }

    const nameSet = new Set(selectedNames as string[]);
    selected = availableTools.filter((tool) => nameSet.has(tool.name));
  } else {
    const unknownNames = toolArgs.filter((n) => !tools.find((t) => t.name === n));
    if (unknownNames.length > 0) {
      log.error(`Unknown tools: ${unknownNames.join(', ')}`);
      return { success: false, error: `Unknown tools: ${unknownNames.join(', ')}` };
    }
    const nameSet = new Set(toolArgs);
    selected = tools.filter((t) => nameSet.has(t.name));
  }

  if (selected.length === 0) {
    return { success: true };
  }

  log.step('jean2 tools · install');
  log.step('');

  const results: TaskResult[] = [];

  for (const tool of selected) {
    try {
      const result = await installToolFromUrl(
        tool.artifactUrl,
        tool.name,
        toolsDir,
      );

      if (result.success) {
        log.step(`  ✔ ${tool.name} installed`);
        results.push({ status: 'ok', value: tool.name });
      } else {
        const stageLabel = result.stage ? ` [${result.stage}]` : '';
        log.error(`  ✗ ${tool.name}${stageLabel} failed: ${result.error ?? 'unknown error'}`);
        results.push({ status: 'error', reason: result.error });
      }
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      log.error(`  ✗ ${tool.name} failed: ${message}`);
      results.push({ status: 'error', reason: message });
    }
  }

  const successCount = results.filter((r: TaskResult) => r.status === 'ok').length;
  const errorCount = results.filter((r: TaskResult) => r.status === 'error').length;

  log.step('');
  log.step(`  ${successCount} ${pluralize(successCount, 'tool')} installed to ${getToolsBaseDir()}/`);
  if (errorCount > 0) {
    log.error(`${errorCount} ${pluralize(errorCount, 'tool')} failed:`);
    for (const r of results) {
      if (r.status === 'error' && r.reason) {
        log.error(`  • ${r.reason}`);
      }
    }
  }

  log.step('✨ Done');
  return { success: errorCount === 0 };
}

export interface UpdateOptions {
  names?: string[];
  dryRun?: boolean;
}

export interface ReinstallOptions {
  names?: string[];
}

export async function toolsUpdate(options: UpdateOptions): Promise<ToolsCliResult> {
  const toolArgs = options.names || [];

  let tools: RepositoryTool[];

  try {
    const fetchSpinner = spinner();
    fetchSpinner.start('Fetching tool registry...');
    tools = await fetchRepositoryWithVersions();
    fetchSpinner.stop('Fetching tool registry... done');
    restoreTerminalState();
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    log.error(message);
    return { success: false, error: message };
  }

  const toolsDir = getToolsBaseDir();
  const installedTools = await getInstalledTools(toolsDir);
  const installedMap = new Map(installedTools.map((t) => [t.name, t]));

  let toUpdate = tools.filter((t) => installedMap.has(t.name));

  if (toolArgs.length > 0) {
    const nameSet = new Set(toolArgs);
    toUpdate = toUpdate.filter((t) => nameSet.has(t.name));
  }

  if (toUpdate.length === 0) {
    log.step('jean2 tools · update');
    log.step('');
    log.step('  No installed tools to update.');
    log.step('✨ Done');
    return { success: true };
  }

  interface OutdatedItem {
    tool: RepositoryTool;
    installedVersion: string;
  }

  const outdated: OutdatedItem[] = [];
  const upToDate: string[] = [];

  for (const tool of toUpdate) {
    const installedInfo = installedMap.get(tool.name);
    if (installedInfo && installedInfo.version !== tool.version) {
      outdated.push({ tool, installedVersion: installedInfo.version || 'unknown' });
    } else if (installedInfo) {
      upToDate.push(tool.name);
    }
  }

  if (outdated.length === 0) {
    log.step('jean2 tools · update');
    log.step('');
    log.step('  All installed tools are up to date.');
    log.step('✨ Done');
    return { success: true };
  }

  if (options.dryRun) {
    log.step('jean2 tools · update (dry run)');
    log.step('');
    const COL_TOOL = 11;
    const COL_CURR = 10;

    let maxToolLen = COL_TOOL;
    for (const { tool } of outdated) {
      maxToolLen = Math.max(maxToolLen, tool.name.length);
    }

    log.step(`  ${'Tool'.padEnd(maxToolLen)}${'Current'.padEnd(COL_CURR)}Latest`);
    log.step(`  ${'─'.repeat(maxToolLen)}${'─'.repeat(COL_CURR)}${'─'.repeat(6)}`);
    for (const { tool, installedVersion } of outdated) {
      log.step(`  ${tool.name.padEnd(maxToolLen)}${installedVersion.padEnd(COL_CURR)}${tool.version}`);
    }
    log.step('');
    log.step('✨ Done');
    return { success: true };
  }

  log.step('jean2 tools · update');
  log.step('');
  for (const { tool, installedVersion } of outdated) {
    log.step(`  ${tool.name.padEnd(11)}${installedVersion} → ${tool.version}`);
  }
  log.step('');

  const confirmed = await confirm({
    message: `Update ${outdated.length} ${pluralize(outdated.length, 'tool')} to latest versions?`,
  });

  restoreTerminalState();

  if (isCancel(confirmed)) {
    cancel();
    return { success: true };
  }

  if (!confirmed) {
    log.step('Update cancelled.');
    log.step('✨ Done');
    return { success: true };
  }

  const updateResults: TaskResult[] = [];
  for (const { tool } of outdated) {
    try {
      const result = await installToolFromUrl(
        tool.artifactUrl,
        tool.name,
        toolsDir,
      );
      if (result.success) {
        log.step(`  ✔ ${tool.name} updated`);
        updateResults.push({ status: 'ok', value: tool.name });
      } else {
        const stageLabel = result.stage ? ` [${result.stage}]` : '';
        log.error(`  ✗ ${tool.name}${stageLabel} failed: ${result.error ?? 'unknown error'}`);
        updateResults.push({ status: 'error', reason: result.error });
      }
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      log.error(`  ✗ ${tool.name} failed: ${message}`);
      updateResults.push({ status: 'error', reason: message });
    }
  }

  const updatedCount = updateResults.filter((r: TaskResult) => r.status === 'ok').length;
  const updateErrorCount = updateResults.filter((r: TaskResult) => r.status === 'error').length;

  log.step('');
  log.step(`  ${updatedCount} ${pluralize(updatedCount, 'tool')} updated, ${upToDate.length} already up-to-date`);
  if (updateErrorCount > 0) {
    log.error(`${updateErrorCount} ${pluralize(updateErrorCount, 'tool')} failed:`);
    for (const r of updateResults) {
      if (r.status === 'error' && r.reason) {
        log.error(`  • ${r.reason}`);
      }
    }
  }

  log.step('✨ Done');
  return { success: updateErrorCount === 0 };
}

export async function toolsReinstall(options: ReinstallOptions): Promise<ToolsCliResult> {
  const toolArgs = options.names || [];

  let tools: RepositoryTool[];

  try {
    const fetchSpinner = spinner();
    fetchSpinner.start('Fetching tool registry...');
    tools = await fetchRepositoryWithVersions();
    fetchSpinner.stop('Fetching tool registry... done');
    restoreTerminalState();
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    log.error(message);
    return { success: false, error: message };
  }

  const toolsDir = getToolsBaseDir();
  const installedTools = await getInstalledTools(toolsDir);
  const installedMap = new Map(installedTools.map((t) => [t.name, t]));

  let toReinstall = tools.filter((t) => installedMap.has(t.name));

  if (toolArgs.length > 0) {
    const nameSet = new Set(toolArgs);
    toReinstall = toReinstall.filter((t) => nameSet.has(t.name));

    const notInstalled = toolArgs.filter((n) => !installedMap.has(n));
    if (notInstalled.length > 0) {
      log.warn(`Tools not installed: ${notInstalled.join(', ')}`);
    }
  }

  if (toReinstall.length === 0) {
    log.step('jean2 tools · reinstall');
    log.step('');
    log.step('  No installed tools to reinstall.');
    log.step('✨ Done');
    return { success: true };
  }

  log.step('jean2 tools · reinstall');
  log.step('');
  for (const tool of toReinstall) {
    const installedInfo = installedMap.get(tool.name);
    const installedVersion = installedInfo?.version || '?';
    log.step(`  ${tool.name.padEnd(11)}${installedVersion} → ${tool.version}${installedVersion === tool.version ? ' (same version)' : ''}`);
  }
  log.step('');

  const confirmed = await confirm({
    message: `Reinstall ${toReinstall.length} ${pluralize(toReinstall.length, 'tool')}?`,
  });

  restoreTerminalState();

  if (isCancel(confirmed)) {
    cancel();
    return { success: true };
  }

  if (!confirmed) {
    log.step('Reinstall cancelled.');
    log.step('✨ Done');
    return { success: true };
  }

  const reinstallResults: TaskResult[] = [];
  for (const tool of toReinstall) {
    try {
      const result = await installToolFromUrl(
        tool.artifactUrl,
        tool.name,
        toolsDir,
      );
      if (result.success) {
        log.step(`  ✔ ${tool.name} reinstalled`);
        reinstallResults.push({ status: 'ok', value: tool.name });
      } else {
        const stageLabel = result.stage ? ` [${result.stage}]` : '';
        log.error(`  ✗ ${tool.name}${stageLabel} failed: ${result.error ?? 'unknown error'}`);
        reinstallResults.push({ status: 'error', reason: result.error });
      }
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      log.error(`  ✗ ${tool.name} failed: ${message}`);
      reinstallResults.push({ status: 'error', reason: message });
    }
  }

  const reinstalledCount = reinstallResults.filter((r: TaskResult) => r.status === 'ok').length;
  const errorCount = reinstallResults.filter((r: TaskResult) => r.status === 'error').length;

  log.step('');
  log.step(`  ${reinstalledCount} ${pluralize(reinstalledCount, 'tool')} reinstalled`);
  if (errorCount > 0) {
    log.error(`${errorCount} ${pluralize(errorCount, 'tool')} failed:`);
    for (const r of reinstallResults) {
      if (r.status === 'error' && r.reason) {
        log.error(`  • ${r.reason}`);
      }
    }
  }

  log.step('✨ Done');
  return { success: errorCount === 0 };
}

export interface RemoveOptions {
  names?: string[];
  all?: boolean;
}

export async function toolsRemove(options: RemoveOptions): Promise<ToolsCliResult> {
  const toolArgs = options.names || [];

  if (toolArgs.length === 0 && !options.all) {
    log.error('No tools specified. Use `jean2 tools remove <names...>` or `jean2 tools remove --all`');
    return { success: false, error: 'No tools specified' };
  }

  const toolsDir = getToolsBaseDir();
  const installedTools = await getInstalledTools(toolsDir);
  const installedSet = new Set(installedTools.map((t) => t.name));

  let toRemove: string[];

  if (options.all) {
    toRemove = installedTools.map((t) => t.name);
  } else {
    toRemove = toolArgs.filter((n) => installedSet.has(n));
    const notInstalled = toolArgs.filter((n) => !installedSet.has(n));
    if (notInstalled.length > 0) {
      log.warn(`Tools not installed: ${notInstalled.join(', ')}`);
    }
  }

  if (toRemove.length === 0) {
    log.step('No installed tools to remove.');
    return { success: true };
  }

  log.step(`Removing ${toRemove.length} ${pluralize(toRemove.length, 'tool')}...`);

  let successCount = 0;
  let failedCount = 0;

  for (const name of toRemove) {
    try {
      const result = await removeTool(name, toolsDir);
      if (result.success) {
        successCount++;
      } else {
        failedCount++;
        log.step(`  Failed to remove ${name}: ${result.error}`);
      }
    } catch (err: unknown) {
      failedCount++;
      const message = err instanceof Error ? err.message : String(err);
      log.step(`  Failed to remove ${name}: ${message}`);
    }
  }

  log.step(`Removed ${successCount} ${pluralize(successCount, 'tool')}`);

  if (failedCount > 0) {
    log.warn(`${failedCount} ${pluralize(failedCount, 'tool')} failed to remove`);
  }

  return { success: failedCount === 0 };
}

export interface InstallRecommendedToolsResult {
  success: boolean;
  toolsInstalled: boolean;
  error?: string;
}

export async function installRecommendedTools(): Promise<InstallRecommendedToolsResult> {
  try {
    const result = await toolsInstall({
      recommended: true,
    });

    if (!result.success) {
      return {
        success: false,
        toolsInstalled: false,
        error: `${result.error}\nRun 'jean2 tools install --recommended' to try again.`,
      };
    }

    return {
      success: true,
      toolsInstalled: true,
    };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return {
      success: false,
      toolsInstalled: false,
      error: message,
    };
  }
}

export interface OutdatedOptions {
  names?: string[];
}

export async function toolsOutdated(_options: OutdatedOptions = {}): Promise<ToolsCliResult> {
  let tools: RepositoryTool[];

  try {
    const fetchSpinner = spinner();
    fetchSpinner.start('Fetching tool registry...');
    tools = await fetchRepositoryWithVersions();
    fetchSpinner.stop('Fetching tool registry... done');
    restoreTerminalState();
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    log.error(message);
    return { success: false, error: message, exitCode: 1 };
  }

  const toolsDir = getToolsBaseDir();
  const installedTools = await getInstalledTools(toolsDir);
  const installedMap = new Map(installedTools.map((t) => [t.name, t]));

  interface OutdatedResult {
    name: string;
    currentVersion: string;
    latestVersion: string;
  }

  const outdated: OutdatedResult[] = [];

  for (const tool of tools) {
    const installedInfo = installedMap.get(tool.name);
    if (!installedInfo || !installedInfo.version) continue;

    if (installedInfo.version !== tool.version) {
      outdated.push({
        name: tool.name,
        currentVersion: installedInfo.version || 'unknown',
        latestVersion: tool.version,
      });
    }
  }

  log.step('jean2 tools · outdated');
  log.step('');

  if (outdated.length === 0) {
    log.step('  All installed tools are up to date.');
    log.step('');
    log.step(`  ${installedTools.length} installed, all up-to-date`);
    log.step('✨ Done');
    return { success: true, exitCode: 0 };
  }

  const COL_TOOL = 11;
  const COL_CURR = 10;

  let maxNameLen = COL_TOOL;
  for (const o of outdated) {
    maxNameLen = Math.max(maxNameLen, o.name.length);
  }

  log.step(`  ${'Tool'.padEnd(maxNameLen)}${'Current'.padEnd(COL_CURR)}Latest`);
  log.step(`  ${'─'.repeat(maxNameLen)}${'─'.repeat(COL_CURR)}${'─'.repeat(6)}`);
  for (const o of outdated) {
    log.step(`  ${o.name.padEnd(maxNameLen)}${o.currentVersion.padEnd(COL_CURR)}${o.latestVersion}`);
  }

  log.step('');
  log.step(`  ${outdated.length} of ${installedTools.length} installed ${pluralize(installedTools.length, 'tool')} are outdated`);
  log.step('  Run `jean2 tools update` to update');

  log.step('✨ Done');
  return { success: true, exitCode: 1 };
}

export function toolsHelp(): void {
  console.log(`
  Tool management commands:

    list                  List available and installed tools
      --installed           Only show installed tools
      --json                JSON output

    install [names...]    Install tools (interactive if no args)
      --all                 Install all available tools
      --recommended         Install recommended tools only
      --force               Reinstall even if already installed

    update [names...]     Update installed tools to latest
      --dry-run             Preview updates without installing

    reinstall [names...] Reinstall installed tools (ignores version)

    remove [names...]     Remove installed tools
      --all                 Remove all tools

    outdated              Check for available updates

  Environment:
    PROKOPAI_TOOL_REGISTRY_URL  Custom registry URL (default: GitHub raw)

  Examples:
    jean2 tools install                Interactive selection
    jean2 tools install --recommended  Install recommended tools
    jean2 tools install --all           Install all tools
    jean2 tools install grep glob      Install specific tools
    jean2 tools update                 Update all installed tools
    jean2 tools reinstall              Reinstall all installed tools
    jean2 tools reinstall grep         Reinstall a specific tool
    jean2 tools outdated               Check for updates
`);
}

export interface ToolsCommandArgs {
  subCommand?: string;
  flags: {
    installed?: boolean;
    json?: boolean;
    all?: boolean;
    recommended?: boolean;
    force?: boolean;
    dryRun?: boolean;
  };
  names?: string[];
}

export async function runToolsCommand(args: ToolsCommandArgs): Promise<ToolsCliResult> {
  const { subCommand, flags, names } = args;

  switch (subCommand) {
    case 'list':
    case 'ls': {
      return toolsList({
        installed: flags.installed,
        json: flags.json,
      });
    }

    case 'install':
    case 'add': {
      return toolsInstall({
        names: names ?? [],
        all: flags.all,
        recommended: flags.recommended,
        force: flags.force,
      });
    }

    case 'update': {
      return toolsUpdate({
        names: names ?? [],
        dryRun: flags.dryRun,
      });
    }

    case 'reinstall': {
      return toolsReinstall({
        names: names ?? [],
      });
    }

    case 'remove':
    case 'rm':
    case 'uninstall': {
      return toolsRemove({
        names: names ?? [],
        all: flags.all,
      });
    }

    case 'outdated': {
      return toolsOutdated({});
    }

    case 'help':
    case undefined: {
      toolsHelp();
      return { success: true };
    }

    default: {
      log.error(`Unknown tools command: ${subCommand}`);
      toolsHelp();
      return { success: false, error: `Unknown command: ${subCommand}`, exitCode: 1 };
    }
  }
}
