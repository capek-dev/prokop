#!/usr/bin/env bun
// packages/server/src/cli.ts

import '@/infrastructure/runtime/environment';  // This loads .env automatically

import { startServer, type ServerOptions } from '@/index';
import { isInitialized } from '@/config';
import { getDatabasePath } from '@/infrastructure/runtime/environment';
import {
  startDaemon,
  stopDaemon,
  restartDaemon,
  getStatus,
  tailLogs,
  type DaemonOptions,
} from '@/infrastructure/daemon';

import type { InitOptions } from '@/cli/init';
import { runInitCommand } from '@/cli/init-command';
import { openClient } from '@/cli/open-client';
import {
  isProkopServerReachable,
  runProkopaiRenameMigration,
  type RenameMigrationResult,
} from '@/cli/rename-migrate';
import { runMigrations, getDatabase } from '@/infrastructure/sqlite/database';
import { runToolsCommand, type ToolsCommandArgs } from '@/cli/tools-cli';
import { performUpdate, type UpdateOptions } from '@/cli/update';
import { syncModels, type SyncResult } from '@/config/models-sync';
import { cleanupOrphanedData, vacuumDatabase, formatBytes } from '@/infrastructure/sqlite/cleanup';
import { readEnv } from '@/infrastructure/runtime/env-compat';
import { VERSION } from '@/version';

import '@/cli/clack-utils';

// Parse command line arguments
const args = process.argv.slice(2);
const command = args[0];

interface ParsedServerArgs {
  port?: number;
  host?: string;
}

function parseServerArgs(args: string[]): ParsedServerArgs {
  const result: ParsedServerArgs = {};

  let i = 0;
  while (i < args.length) {
    const arg = args[i];

    switch (arg) {
      case '--port':
      case '-p':
        result.port = parseInt(args[++i], 10);
        if (isNaN(result.port)) {
          console.error('Error: --port/-p requires a number');
          process.exit(1);
        }
        break;

      case '--host':
      case '-h':
        result.host = args[++i];
        break;

      default:
        // Unknown option - could be positional arg or error
        if (arg.startsWith('-')) {
          console.error(`Unknown option: ${arg}`);
          process.exit(1);
        }
        break;
    }

    i++;
  }

  return result;
}

function printVersion(): void {
  console.log(`prokop version ${VERSION}`);
}

function printHelp(): void {
  console.log(`
Prokop - AI Agent Server

Usage: prokop <command> [options]

Commands:
  start               Start server as background daemon
    -p, --port <port>  Port to listen on
    -h, --host <host>  Host to bind to

  stop                Stop the running server daemon

  status              Check server daemon status

  restart             Restart the server daemon
    -p, --port <port>  Port to listen on
    -h, --host <host>  Host to bind to

  server [options]    Start server in foreground (for systemd)
    -p, --port <port>  Port to listen on (default: 8742)
    -h, --host <host>  Host to bind to (default: 0.0.0.0)

  open                 Open the built-in client in browser

  logs                 Tail server logs

  auth                 Show authentication configuration

  init                 Set up Prokop, start it, and open the client
    --db-path <path>   Custom database path
    --tools-path <path>  Custom tools path
    --run-migrations   Run schema migrations (default)
    --no-migrations    Skip schema migrations
    --install-preconfigs   Install default preconfigs (default)
    --no-preconfigs        Skip preconfig installation
    --force            Force re-initialization

  tools                Optional tool extensions
    list                List available and installed extensions
      --installed         Only show installed tools
      --extensions        Show extension and env config details
      --json              JSON output
    install [names...]  Install optional extensions (interactive if no args)
      --all               Install all extensions
      --force             Reinstall even if installed
    update [names...]   Update installed tools to latest
      --dry-run           Preview without installing
    remove [names...]  Remove installed tools
      --all               Remove all tools
    outdated            Check for available updates

  db                   Database maintenance
    stats               Show database size and reclaimable space
    vacuum              Remove orphaned data and reclaim free space (VACUUM)
    cleanup             Remove orphaned data only (no VACUUM)

  migrate              Run database migrations
  migrate-legacy-data  Move ~/.jean2 data to ~/.prokopai

  models               Model registry management
    sync                Sync models from upstream registry
      --override         Replace local models.json with upstream

  update               Update prokop to latest version
    --version <ver>    Update to a specific version
    --force            Reinstall even if already on latest
    --dry-run          Check for updates without installing
    --no-restart       Don't restart daemon after update

  version              Show version
  help                 Show this help

Examples:
  prokop db stats                  Check database size and reclaimable space
  prokop db vacuum                 Reclaim disk space (run during low activity)
  prokop db cleanup                Remove orphaned rows only
  prokop start                     Start server as daemon
  prokop stop                      Stop the daemon
  prokop status                    Check if daemon is running
  prokop restart                   Restart the daemon
  prokop server                    Run in foreground (for systemd)
  prokop logs                      Follow server logs
  prokop auth                      Show auth configuration
  prokop init                      Set up, start, and open Prokop
  prokop tools list                List optional extensions
  prokop tools list --extensions  Show extension details
  prokop migrate                   Run database migrations
  prokop migrate-legacy-data       Move legacy data to ~/.prokopai
  prokop models sync               Sync models from upstream registry
  prokop models sync --override    Replace local models with upstream
  prokop update                    Update to latest version
  prokop update --dry-run          Check for updates only
  prokop update --version 0.9.0    Update to specific version

Environment:
  API keys and config can be set in ~/.prokopai/.env
  System environment variables take precedence.

Configuration:
  Config dir: ~/.prokopai/
  PID file:   ~/.prokopai/server.pid
  Log file:   ~/.prokopai/server.log
`);
}

async function main(): Promise<void> {
  switch (command) {
    case 'server': {
      // Check if initialized (skip if JEAN2_DATABASE_PATH is set - backward compat)
      if (!getDatabasePath() && !isInitialized()) {
        console.error('Error: Prokop is not initialized. Run `prokop init` first.');
        process.exit(1);
      }

      const parsed = parseServerArgs(args.slice(1));
      const options: ServerOptions = {
        port: parsed.port,
        host: parsed.host,
      };

      await startServer(options);
      break;
    }

    case 'start': {
      // Check if initialized (skip if JEAN2_DATABASE_PATH is set - backward compat)
      if (!getDatabasePath() && !isInitialized()) {
        console.error('Error: Prokop is not initialized. Run `prokop init` first.');
        process.exit(1);
      }

      const parsed = parseServerArgs(args.slice(1));
      const options: DaemonOptions = {
        port: parsed.port,
        host: parsed.host,
      };

      const result = await startDaemon(options);
      if (!result.success) {
        console.error('Failed to start daemon:', result.error);
        process.exit(1);
      }
      break;
    }

    case 'stop': {
      const result = await stopDaemon();
      if (!result.success) {
        console.error('Failed to stop daemon:', result.error);
        process.exit(1);
      }
      break;
    }

    case 'restart': {
      const parsed = parseServerArgs(args.slice(1));
      const options: DaemonOptions = {
        port: parsed.port,
        host: parsed.host,
      };

      const result = await restartDaemon(options);
      if (!result.success) {
        console.error('Failed to restart daemon:', result.error);
        process.exit(1);
      }
      break;
    }

    case 'status': {
      const status = getStatus();

      if (status.running) {
        console.log('Daemon is running');
        console.log(`  PID:    ${status.pid}`);
        console.log(`  Port:   ${status.port}`);
        console.log(`  Host:   ${status.host}`);
        console.log(`  Started: ${status.startedAt}`);
      } else {
        console.log('Daemon is not running');
      }
      break;
    }

    case 'logs': {
      tailLogs();
      break;
    }

    case 'auth': {
      const token = readEnv('AUTH_TOKEN');
      if (token) {
        const masked = token.length > 8
          ? `${token.slice(0, 4)}...${token.slice(-4)}`
          : '****';
        console.log(`\nAuthentication: enabled`);
        console.log(`Token:          ${masked}`);
        console.log(`\nSet via PROKOPAI_AUTH_TOKEN environment variable.`);
        console.log(`Change it in ~/.prokopai/.env or your shell environment.\n`);
      } else {
        console.log(`\nAuthentication: disabled`);
        console.log(`\nSet PROKOPAI_AUTH_TOKEN in ~/.prokopai/.env or your shell environment to enable.\n`);
      }
      break;
    }

    case 'init': {
      const initOptions: InitOptions = {};

      // Parse init options
      const initArgs = args.slice(1);
      for (let i = 0; i < initArgs.length; i++) {
        if (initArgs[i] === '--db-path' && initArgs[i + 1]) {
          initOptions.databasePath = initArgs[++i];
        } else if (initArgs[i] === '--tools-path' && initArgs[i + 1]) {
          initOptions.toolsPath = initArgs[++i];
        } else if (initArgs[i] === '--run-migrations' || initArgs[i] === '--no-migrations') {
          initOptions.runMigrations = initArgs[i] === '--run-migrations';
        } else if (initArgs[i] === '--install-preconfigs' || initArgs[i] === '--no-preconfigs') {
          initOptions.installPreconfigs = initArgs[i] === '--install-preconfigs';
        } else if (initArgs[i] === '--force' || initArgs[i] === '-f') {
          initOptions.force = true;
        }
      }

      try {
        const result = await runInitCommand(initOptions);
        if (!result.success) {
          console.error('Initialization failed:', result.error);
          process.exit(1);
        }

        console.log('\nProkop is ready.');
        console.log(`  Config:   ${result.initialization.configPath}`);
        console.log(`  Database: ${result.initialization.databasePath}`);
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        console.error('Error:', message);
        process.exit(1);
      }
      break;
    }

    case 'models': {
      await runModelsCommand(args.slice(1));
      break;
    }

    case 'tools': {
      await runToolsCommandFromCLI(args.slice(1));
      break;
    }

    case 'db': {
      await runDbCommand(args.slice(1));
      break;
    }

    case 'migrate': {
      if (!isInitialized()) {
        console.error('Error: Prokop is not initialized. Run `prokop init` first.');
        process.exit(1);
      }

      try {
        runMigrations();
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        console.error('Migration failed:', message);
        process.exit(1);
      }

      break;
    }

    case 'migrate-legacy-data': {
      const daemonStatus = getStatus();
      if (daemonStatus.running) {
        console.error('Error: Stop the Prokop daemon before migrating legacy data.');
        console.error('Run `prokop stop`, then run `prokop migrate-legacy-data` again.');
        process.exit(1);
      }

      if (await isProkopServerReachable()) {
        console.error('Error: A Prokop or Jean2 server is still reachable.');
        console.error('Stop every foreground and background server before migrating legacy data.');
        process.exit(1);
      }

      if (!isInitialized()) {
        console.error('Error: No Prokop or legacy Jean2 data directory was found.');
        process.exit(1);
      }

      try {
        const renameResult: RenameMigrationResult = runProkopaiRenameMigration();
        for (const step of renameResult.steps) {
          if (step.status === 'done') {
            console.log(`  ${step.step}: ${step.detail ?? 'done'}`);
          } else if (step.status === 'failed') {
            console.error(`  ${step.step}: FAILED: ${step.detail ?? 'unknown error'}`);
          }
        }
        if (!renameResult.success) {
          console.error('Legacy data migration completed with failures:', renameResult.error);
          process.exit(1);
        }
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        console.error('Legacy data migration failed:', message);
        process.exit(1);
      }
      break;
    }

    case 'update': {
      const updateOptions: UpdateOptions = {};
      const updateArgs = args.slice(1);

      for (let i = 0; i < updateArgs.length; i++) {
        if (updateArgs[i] === '--version' && updateArgs[i + 1]) {
          updateOptions.version = updateArgs[++i];
        } else if (updateArgs[i] === '--force') {
          updateOptions.force = true;
        } else if (updateArgs[i] === '--dry-run') {
          updateOptions.dryRun = true;
        } else if (updateArgs[i] === '--no-restart') {
          updateOptions.noRestart = true;
        } else if (updateArgs[i] === '--help' || updateArgs[i] === '-h') {
          console.log(`
prokop update - Update prokop to latest version

Usage: prokop update [options]

Options:
  --version <ver>    Update to a specific version (default: latest)
  --force            Reinstall even if already on latest version
  --dry-run          Check for updates without installing
  --no-restart       Don't restart daemon after update
  --help             Show this help message

Examples:
  prokop update                     Update to latest version
  prokop update --dry-run           Check for updates only
  prokop update --version 0.9.0     Update to specific version
`);
          process.exit(0);
        }
      }

      const result = await performUpdate(updateOptions);
      if (!result.success) {
        console.error('Update failed:', result.error);
        process.exit(1);
      }

      if (result.previousVersion !== result.newVersion) {
        console.log(`info: Updated from v${result.previousVersion} to v${result.newVersion}`);
      }

      if (!updateOptions.dryRun && result.previousVersion !== result.newVersion) {
        process.exit(0);
      }
      break;
    }

    case 'open': {
      openClient();
      break;
    }

    case 'version':
    case '-v':
    case '--version': {
      printVersion();
      break;
    }

    case 'help':
    case '-h':
    case '--help':
    case undefined: {
      printHelp();
      break;
    }

    default: {
      console.error(`Unknown command: ${command}`);
      console.error('Run "prokop help" for usage information');
      process.exit(1);
    }
  }
}

async function runToolsCommandFromCLI(args: string[]): Promise<void> {
  const toolsArgs: ToolsCommandArgs = {
    subCommand: undefined,
    flags: {},
    names: [],
  };

  let i = 0;
  while (i < args.length) {
    const arg = args[i];

    if (!arg.startsWith('-')) {
      if (!toolsArgs.subCommand) {
        toolsArgs.subCommand = arg;
      } else {
        toolsArgs.names = toolsArgs.names ?? [];
        toolsArgs.names.push(arg);
      }
      i++;
      continue;
    }

    switch (arg) {
      case '--installed':
        toolsArgs.flags.installed = true;
        break;
      case '--json':
        toolsArgs.flags.json = true;
        break;
      case '--all':
        toolsArgs.flags.all = true;
        break;
      case '--force':
      case '-f':
        toolsArgs.flags.force = true;
        break;
      case '--dry-run':
        toolsArgs.flags.dryRun = true;
        break;
      case '--help':
      case '-h':
        toolsArgs.subCommand = 'help';
        break;
      default:
        console.error(`Unknown option: ${arg}`);
        process.exit(1);
    }
    i++;
  }

  const result = await runToolsCommand(toolsArgs);

  if (result.exitCode !== undefined) {
    process.exitCode = result.exitCode;
  } else if (!result.success) {
    process.exit(1);
  }
}

async function runDbCommand(dbArgs: string[]): Promise<void> {
  if (!isInitialized()) {
    console.error('Error: Prokop is not initialized. Run `prokop init` first.');
    process.exit(1);
  }

  const subCommand = dbArgs[0];

  if (subCommand === '--help' || subCommand === '-h') {
    console.log(`
prokop db - Database maintenance

Usage: prokop db <command>

Commands:
  stats       Show database size and reclaimable space
  vacuum      Remove orphaned data and reclaim free space (VACUUM)
              Run this during low-activity periods. It requires exclusive
              access to the database.
  cleanup     Remove orphaned data only (no VACUUM)

Examples:
  prokop db stats       Check how much space can be reclaimed
  prokop db vacuum      Reclaim disk space
  prokop db cleanup     Remove orphaned rows only
`);
    return;
  }

  // Trigger lazy DB initialization (applies FK pragma, schema, etc.)
  getDatabase();

  try {
    if (subCommand === 'stats') {
      const result = vacuumDatabase({ dryRun: true });
      console.log('');
      console.log('Database Statistics');
      console.log('════════════════════════════════════════');
      console.log(`  Current size:       ${formatBytes(result.pageSizeBefore)}`);
      console.log(`  Reclaimable:        ${formatBytes(result.reclaimedBytes)}`);
      console.log(`  Pages:              ${result.pageCountBefore.toLocaleString()}`);
      console.log('');

      if (result.reclaimedBytes > 0) {
        console.log('  Run `prokop db vacuum` to reclaim this space.');
      } else {
        console.log('  Database is well-compacted. Nothing to reclaim.');
      }
      console.log('');
    } else if (subCommand === 'vacuum') {
      console.log('info: Running orphan cleanup...');
      const stats = cleanupOrphanedData();
      const totalOrphaned = Object.values(stats).reduce((sum, v) => sum + v, 0);
      if (totalOrphaned > 0) {
        console.log(`info: Removed ${totalOrphaned} orphaned row(s)`);
      }

      console.log('info: Checkpointing WAL...');
      console.log('info: Vacuuming database (this may take a moment)...');
      const result = vacuumDatabase();
      console.log('');
      console.log('Vacuum complete');
      console.log('════════════════════════════════════════');
      console.log(`  Before:    ${formatBytes(result.pageSizeBefore)}`);
      console.log(`  After:     ${formatBytes(result.pageSizeAfter)}`);
      console.log(`  Reclaimed: ${formatBytes(result.reclaimedBytes)}`);
      console.log('');
    } else if (subCommand === 'cleanup') {
      const stats = cleanupOrphanedData();
      const totalOrphaned = Object.values(stats).reduce((sum, v) => sum + v, 0);
      console.log('');
      if (totalOrphaned > 0) {
        console.log(`Cleanup complete: removed ${totalOrphaned} orphaned row(s)`);
        for (const [key, value] of Object.entries(stats)) {
          if (value > 0) {
            const label = key.replace(/^orphaned/, '').replace(/([A-Z])/g, ' $1').trim().toLowerCase();
            console.log(`  ${label}: ${value}`);
          }
        }
      } else {
        console.log('Cleanup complete: no orphaned data found');
      }
      console.log('');
      console.log('Note: Run `prokop db vacuum` to reclaim the freed disk space.');
      console.log('');
    } else {
      console.error(`Unknown db command: ${subCommand || '(none)'}`);
      console.error('Run "prokop db --help" for usage information');
      process.exit(1);
    }
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('Error:', message);
    process.exit(1);
  }
}

async function runModelsCommand(modelsArgs: string[]): Promise<void> {
  const subCommand = modelsArgs[0];

  if (subCommand === 'sync') {
    let override = false;
    for (const arg of modelsArgs.slice(1)) {
      if (arg === '--override') {
        override = true;
      } else if (arg === '--help' || arg === '-h') {
        console.log(`
prokop models sync - Sync models from upstream registry

Usage: prokop models sync [options]

Options:
  --override    Replace local models.json with upstream (default: merge)
  --help        Show this help message

Examples:
  prokop models sync              Add new models, keep existing
  prokop models sync --override   Replace with upstream models
`);
        process.exit(0);
      } else {
        console.error(`Unknown option: ${arg}`);
        process.exit(1);
      }
    }

    const mode = override ? 'override' as const : 'merge' as const;

    try {
      console.log(`info: Syncing models from upstream (${mode})...`);
      const result = await syncModels(mode);
      printSyncResult(result);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      console.error('Error:', message);
      process.exit(1);
    }

    return;
  }

  if (subCommand === '--help' || subCommand === '-h') {
    console.log(`
prokop models - Model registry management

Usage: prokop models <command> [options]

Commands:
  sync            Sync models from upstream registry
    --override     Replace local models.json with upstream

Examples:
  prokop models sync              Add new models, keep existing
  prokop models sync --override   Replace with upstream models
`);
    return;
  }

  console.error(`Unknown models command: ${subCommand || '(none)'}`);
  console.error('Run "prokop models --help" for usage information');
  process.exit(1);
}

function printSyncResult(result: SyncResult): void {
  if (result.mode === 'override') {
    console.log(`info: Models replaced with upstream (${result.totalProviders} providers, ${result.totalModels} models)`);
    return;
  }

  if (result.addedProviders.length === 0 && result.addedModels.length === 0) {
    console.log('info: Models already up to date');
    return;
  }

  if (result.addedProviders.length > 0) {
    console.log(`info: Added ${result.addedProviders.length} provider(s): ${result.addedProviders.join(', ')}`);
  }
  if (result.addedModels.length > 0) {
    console.log(`info: Added ${result.addedModels.length} model(s): ${result.addedModels.join(', ')}`);
  }
  console.log(`info: Total: ${result.totalProviders} providers, ${result.totalModels} models`);
}

const longRunningCommands = new Set(['server', 'logs']);

main().then(() => {
  if (!longRunningCommands.has(command ?? '')) {
    process.exit(process.exitCode ?? 0);
  }
}).catch((err: unknown) => {
  const message = err instanceof Error ? err.message : String(err);
  console.error('Error:', message);
  process.exit(1);
});
