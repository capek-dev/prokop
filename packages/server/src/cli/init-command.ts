import type { DaemonResult } from '@/infrastructure/daemon';
import { startDaemon } from '@/infrastructure/daemon';
import { initJean2, type InitOptions, type InitResult } from '@/cli/init';
import { getClientUrl, openClient, waitForClient, type OpenClientResult } from '@/cli/open-client';

export interface InitCommandDependencies {
  initialize(options: InitOptions): Promise<InitResult>;
  start(): Promise<DaemonResult>;
  getClientUrl(): string;
  waitUntilReady(url: string): Promise<boolean>;
  open(): OpenClientResult;
}

export interface InitCommandResult {
  success: boolean;
  error?: string;
  initialization: InitResult;
  browser?: OpenClientResult;
}

const defaultDependencies: InitCommandDependencies = {
  initialize: initJean2,
  start: () => startDaemon(),
  getClientUrl,
  waitUntilReady: waitForClient,
  open: openClient,
};

export async function runInitCommand(
  options: InitOptions,
  dependencies: InitCommandDependencies = defaultDependencies,
): Promise<InitCommandResult> {
  const initialization = await dependencies.initialize(options);
  if (!initialization.success) {
    return {
      success: false,
      error: initialization.error,
      initialization,
    };
  }

  const daemon = await dependencies.start();
  if (!daemon.success) {
    return {
      success: false,
      error: `Setup completed, but the daemon did not start: ${daemon.error || 'unknown error'}`,
      initialization,
    };
  }

  const clientUrl = dependencies.getClientUrl();
  if (!await dependencies.waitUntilReady(clientUrl)) {
    return {
      success: false,
      error: `The daemon started, but the client did not become ready at ${clientUrl}`,
      initialization,
    };
  }

  return {
    success: true,
    initialization,
    browser: dependencies.open(),
  };
}
