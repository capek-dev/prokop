/**
 * Composed execution-scope lifecycle port (S11.4).
 *
 * The composed agent scope is harness-owned: the Prokop composition installs
 * its initialize/dispose pair here, and the server startup root consumes the
 * port instead of importing harness internals. With no port installed the
 * helpers are no-ops: nothing was composed, so there is nothing to
 * initialize or dispose.
 */
export interface ExecutionLifecyclePort {
  initialize(): Promise<void>;
  dispose(): Promise<void>;
}

let current: ExecutionLifecyclePort | null = null;

/** Install (or clear with null) the execution-scope lifecycle. */
export function installExecutionLifecyclePort(port: ExecutionLifecyclePort | null): void {
  current = port;
}

export function getExecutionLifecyclePort(): ExecutionLifecyclePort | null {
  return current;
}

export async function initializeExecutionLifecycle(): Promise<void> {
  await current?.initialize();
}

export async function disposeExecutionLifecycle(): Promise<void> {
  await current?.dispose();
}
