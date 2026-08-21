#!/usr/bin/env bun

import { createInterface } from 'node:readline';

import { SandboxApiClient } from './api-client';
import { handleCommand } from './commands';
import { displayHelp, displayNotification, displayPendingCalls } from './display';

interface CliArgs {
  host: string;
  port: number;
  token?: string;
}

function parseArgs(argv: string[]): CliArgs {
  const args: CliArgs = {
    host: 'localhost',
    port: 3000,
    token: process.env.PROKOPAI_API_TOKEN ?? process.env.JEAN2_API_TOKEN,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--host' && argv[index + 1]) {
      args.host = argv[index + 1];
      index += 1;
      continue;
    }

    if (arg === '--port' && argv[index + 1]) {
      args.port = Number.parseInt(argv[index + 1], 10);
      index += 1;
      continue;
    }

    if (arg === '--token' && argv[index + 1]) {
      args.token = argv[index + 1];
      index += 1;
      continue;
    }

    if (arg === '--help' || arg === '-h') {
      console.log('Usage: bun packages/sandbox-cli/src/cli.ts [--host localhost] [--port 3000] [--token <api-token>]');
      process.exit(0);
    }
  }

  if (!Number.isFinite(args.port) || args.port <= 0) {
    throw new Error('Invalid --port value');
  }

  return args;
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const client = new SandboxApiClient(args);

  await client.connect();

  const rl = createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  console.log(`🎛️  Jean2 Sandbox CLI — connected to ${args.host}:${args.port}`);
  console.log('Type "help" for commands.\n');

  const initialPending = await client.getPendingCalls();
  if (initialPending.length > 0) {
    displayPendingCalls(initialPending);
  }

  client.onCallWaitingEvent((context) => {
    displayNotification(context);
    rl.prompt();
  });

  let closing = false;
  const close = (): void => {
    if (closing) {
      return;
    }
    closing = true;
    client.disconnect();
    rl.close();
    process.exit(0);
  };

  rl.setPrompt('sandbox> ');
  rl.prompt();

  rl.on('line', async (line) => {
    const input = line.trim();
    if (!input) {
      rl.prompt();
      return;
    }

    try {
      await handleCommand(client, input, { exit: close });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      console.error(`✗ ${message}`);
    }

    rl.prompt();
  });

  rl.on('SIGINT', () => {
    close();
  });

  process.on('SIGINT', () => {
    close();
  });

  process.on('SIGTERM', () => {
    close();
  });

  process.on('uncaughtException', (err) => {
    console.error(err);
    close();
  });

  process.on('unhandledRejection', (reason) => {
    console.error(reason);
    close();
  });

  displayHelp();
}

main().catch((err: unknown) => {
  const message = err instanceof Error ? err.message : String(err);
  console.error(`Failed to start sandbox CLI: ${message}`);
  process.exit(1);
});
