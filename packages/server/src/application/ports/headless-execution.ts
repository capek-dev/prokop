import type { Preconfig, SessionHarness } from '@prokopai/sdk';
import type { SessionWirePorts } from './delivery';

/**
 * Resolved child-run contract for headless (scheduled) execution. The
 * scheduled-job runner resolves session identity, preconfig, model, and
 * provider selection; the owning harness executes the child run inside its
 * own runtime scope. Infrastructure never reaches harness internals.
 */
export interface HeadlessSessionRunInput {
  harness: SessionHarness;
  parentSessionId: string;
  childSessionId: string;
  preconfig: Preconfig;
  prompt: string;
  workspacePath: string | undefined;
  workspaceId: string;
  modelId: string;
  providerId: string;
  resumeFromHistory: boolean;
}

export interface HeadlessSessionRunResult {
  error?: string;
}

export interface HeadlessSessionRunPort {
  run(input: HeadlessSessionRunInput): Promise<HeadlessSessionRunResult>;
  /** Harnesses whose registrations provide headless runs; job creation
   * rejects harnesses outside this set. */
  supportedHarnesses(): SessionHarness[];
}

let current: HeadlessSessionRunPort | null = null;

/** Install (or clear with null) the headless dispatch port. Bootstrap
 * installs the harness-registry dispatcher after wiring registrations;
 * consumers without an installed port fail closed per run. */
export function installHeadlessExecutionPort(port: HeadlessSessionRunPort | null): void {
  current = port;
}

export function getHeadlessExecutionPort(): HeadlessSessionRunPort | null {
  return current;
}

type HeadlessSendMessage = <Origin>(
  wire: SessionWirePorts<Origin>,
  origin: Origin,
  sessionId: string,
  content: string,
) => Promise<void>;

/**
 * Run one headless agent turn over a harness sendMessage entry: every delivery
 * sink is discarded (there is no client), and the returned promise settles
 * when the turn completes. Wire-sent validation errors are silent by contract;
 * callers that need them should pre-validate the session before dispatch.
 */
export function runHeadlessTurn(
  sendMessage: HeadlessSendMessage,
  input: HeadlessSessionRunInput,
): Promise<HeadlessSessionRunResult> {
  const wire: SessionWirePorts<string> = {
    delivery: {
      send: () => {},
      broadcast: () => {},
      broadcastToSession: () => {},
      sendToController: () => {},
      sendToAskTargets: () => {},
    },
    actor: { attachOriginToSession: () => {} },
  };
  return sendMessage(wire, `headless:${input.childSessionId}`, input.childSessionId, input.prompt)
    .then(() => ({}) as HeadlessSessionRunResult)
    .catch((error: unknown): HeadlessSessionRunResult => ({
      error: error instanceof Error ? error.message : 'Headless run failed',
    }));
}
