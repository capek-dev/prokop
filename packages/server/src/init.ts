import { dirname } from 'path';
import { mkdirSync, existsSync, writeFileSync } from 'fs';
import { createInterface } from 'node:readline';
import {
  getPromptsDir,
  getEnvFilePath,
  getGlobalAgentsPath,
} from '@/infrastructure/runtime/paths';

import {
  getConfigPath,
  getDefaultDatabasePath,
  getDefaultToolsPath,
  saveConfig,
  isInitialized,
  clearConfigCache,
  getModelsConfigPath,
  clearModelsCache,
} from '@/config';
import { runMigrations } from '@/infrastructure/sqlite/database';
import { initializePreconfigs, migrateUuidPreconfigs } from '@/infrastructure/configuration/preconfig';
import defaultModelsJson from '@/config/models.json';
import { installRecommendedTools } from '@/tools';

export interface InitOptions {
  databasePath?: string;
  toolsPath?: string;
  runMigrations?: boolean;
  installPreconfigs?: boolean;
  installTools?: boolean;
  skipTools?: boolean;
  force?: boolean;
}

export interface InitResult {
  success: boolean;
  error?: string;
  configPath: string;
  databasePath: string;
  toolsPath: string;
  modelsPath: string;
  preconfigsInstalled: boolean;
  toolsInstalled: boolean;
}

interface RlInterface {
  question: (query: string) => Promise<string>;
  close: () => void;
}

function createRl(): RlInterface {
  const rl = createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  return {
    question: (query: string): Promise<string> => {
      return new Promise((resolve) => {
        rl.question(query, (answer) => {
          resolve(answer);
        });
      });
    },
    close: () => {
      rl.close();
    },
  };
}

async function promptDatabasePath(rl: RlInterface, defaultPath: string): Promise<string> {
  const answer = await rl.question(`Database path [${defaultPath}]: `);
  return answer.trim() || defaultPath;
}

async function promptToolsPath(rl: RlInterface, defaultPath: string): Promise<string> {
  const answer = await rl.question(`Tools path [${defaultPath}]: `);
  return answer.trim() || defaultPath;
}

async function promptRunMigrations(rl: RlInterface): Promise<boolean> {
  const answer = await rl.question('Run database migrations? [Y/n]: ');
  const trimmed = (answer || '').trim().toLowerCase();
  return trimmed === '' || trimmed === 'y' || trimmed === 'yes';
}

async function promptInstallPreconfigs(rl: RlInterface): Promise<boolean> {
  const answer = await rl.question('Install default preconfigs? [Y/n]: ');
  const trimmed = (answer || '').trim().toLowerCase();
  return trimmed === '' || trimmed === 'y' || trimmed === 'yes';
}

async function promptInstallTools(rl: RlInterface): Promise<boolean> {
  const answer = await rl.question('Install recommended tools? [Y/n]: ');
  const trimmed = (answer || '').trim().toLowerCase();
  return trimmed === '' || trimmed === 'y' || trimmed === 'yes';
}

async function initJean2Internal(options: InitOptions = {}): Promise<InitResult> {
  const { databasePath, toolsPath, runMigrations: runMigrationsOption, installPreconfigs: installPreconfigsOption, installTools: installToolsOption, skipTools: skipToolsOption, force } = options;

  if (isInitialized() && !force) {
    return {
      success: false,
      error: 'Jean2 is already initialized. Use --force to re-initialize.',
      configPath: getConfigPath(),
      databasePath: databasePath || getDefaultDatabasePath(),
      toolsPath: toolsPath || getDefaultToolsPath(),
      modelsPath: getModelsConfigPath(),
      preconfigsInstalled: false,
      toolsInstalled: false,
    };
  }

  if (force) {
    clearConfigCache();
    clearModelsCache();
  }

  const defaultDbPath = getDefaultDatabasePath();
  const defaultToolsPath = getDefaultToolsPath();
  let shouldRunMigrations = runMigrationsOption ?? true;
  let shouldInstallPreconfigs = installPreconfigsOption ?? true;
  let finalDbPath = databasePath || defaultDbPath;
  let finalToolsPath = toolsPath || defaultToolsPath;

  let shouldInstallTools = installToolsOption ?? false;

  if (!databasePath || !toolsPath || runMigrationsOption === undefined || installPreconfigsOption === undefined || (installToolsOption === undefined && skipToolsOption === undefined)) {
    const rl = createRl();

    try {
      finalDbPath = await promptDatabasePath(rl, defaultDbPath);
      finalToolsPath = await promptToolsPath(rl, defaultToolsPath);
      shouldRunMigrations = await promptRunMigrations(rl);
      shouldInstallPreconfigs = await promptInstallPreconfigs(rl);
      if (skipToolsOption) {
        shouldInstallTools = false;
      } else {
        shouldInstallTools = await promptInstallTools(rl);
      }
      console.log();

      rl.close();
    } catch (_e) {
      rl.close();
      throw _e;
    }
  }

  // Create directories
  mkdirSync(dirname(finalDbPath), { recursive: true });
  mkdirSync(finalToolsPath, { recursive: true });
  mkdirSync(getPromptsDir(), { recursive: true });

  // Create empty .env file
  const envPath = getEnvFilePath();
  if (!existsSync(envPath)) {
    writeFileSync(envPath, `# Jean2 Environment Variables
# Add your API keys and configuration here

# LLM API Keys
# JEAN2_LLM_OPENAI_API_KEY=your-key-here
# JEAN2_LLM_ANTHROPIC_API_KEY=your-key-here
# JEAN2_LLM_DEEPSEEK_API_KEY=your-key-here

# Agent Configuration
JEAN2_LLM_MAX_STEPS=500
JEAN2_LLM_SUBAGENT_MAX_STEPS=500
`);
  }

  // Create empty AGENTS.md file
  const agentsPath = getGlobalAgentsPath();
  if (!existsSync(agentsPath)) {
    writeFileSync(agentsPath, `# Jean2 Global Instructions
#
# This file contains instructions that apply to all projects on this machine.
# They will be loaded before project-specific instructions.
#
# Example:
# - Always use TypeScript strict mode
# - Never commit .env files
# - Prefer functional components in React
`);
  }

  const modelsPath = getModelsConfigPath();
  if (!existsSync(modelsPath)) {
    writeFileSync(modelsPath, JSON.stringify(defaultModelsJson, null, 2));
    console.log('Created default models.json at ~/.jean2/models.json');
  }

  // Save config
  saveConfig({
    databasePath: finalDbPath,
    toolsPath: finalToolsPath,
    port: 8742,
    host: '0.0.0.0',
    initializedAt: new Date().toISOString(),
  });

  // Run migrations if requested
  if (shouldRunMigrations) {
    console.log('Running migrations...');
    runMigrations();
  }

  // Install preconfigs if requested
  if (shouldInstallPreconfigs) {
    console.log('Installing default preconfigs...');
    await initializePreconfigs();
    // Migrate any UUID-named preconfigs to human-readable slugs
    await migrateUuidPreconfigs();
  }

  // Install recommended tools if requested or if in non-interactive mode with --install-tools
  let toolsInstalled = false;
  if (shouldInstallTools) {
    console.log('Installing recommended tools...');
    const result = await installRecommendedTools();
    toolsInstalled = result.toolsInstalled;
    if (!result.success && result.error) {
      console.log('');
      console.log(`⚠ Tool installation encountered an issue:`);
      console.log(`  ${result.error}`);
    }
  }

  console.log('\nDone! Jean2 is ready.');

  return {
    success: true,
    configPath: getConfigPath(),
    databasePath: finalDbPath,
    toolsPath: finalToolsPath,
    modelsPath: getModelsConfigPath(),
    preconfigsInstalled: shouldInstallPreconfigs,
    toolsInstalled,
  };
}

export async function initJean2(options: InitOptions = {}): Promise<InitResult> {
  if (!process.stdin.isTTY) {
    return initJean2Internal(options);
  }

  return initJean2Internal(options);
}
