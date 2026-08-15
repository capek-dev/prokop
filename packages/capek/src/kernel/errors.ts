/**
 * Kernel error types. Validation and lifecycle failures are typed so callers
 * can distinguish malformed composition from runtime behavior.
 */

import type { KernelEventType } from './types';

export function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

export class KernelError extends Error {
  constructor(message: string) {
    super(message);
    this.name = new.target.name;
  }
}

/** Composition rejected before activation: nothing ran. */
export class CompositionError extends KernelError {}

export class DuplicatePluginError extends CompositionError {}

export class MalformedPluginError extends CompositionError {}

export class ScopeValidationError extends CompositionError {}

/** A child scope attempted to provide a service already effective in a
 * parent scope. Child scopes do not replace parent services. */
export class ServiceCollisionError extends CompositionError {}

export class DuplicateProviderError extends CompositionError {}

export class InvalidOverrideError extends CompositionError {}

export class MissingDependencyError extends CompositionError {}

export class DependencyCycleError extends CompositionError {}

/** A contribution id was registered twice within one scope. */
export class DuplicateContributionError extends CompositionError {}

export interface DisposalFailure {
  readonly pluginId: string;
  readonly error: unknown;
}

/** Aggregated errors from reverse disposal. Every resource is still
 * attempted even when earlier disposers fail. */
export class DisposalError extends KernelError {
  readonly failures: readonly DisposalFailure[];

  constructor(failures: readonly DisposalFailure[]) {
    const details = failures
      .map((failure) => `plugin '${failure.pluginId}': ${errorMessage(failure.error)}`)
      .join('; ');
    super(`disposal failed with ${failures.length} error(s): ${details}`);
    this.failures = failures;
  }
}

/** Setup failed. Completed registrations were rolled back in reverse order.
 * The original setup error and any disposal errors are both preserved. */
export class ActivationError extends KernelError {
  readonly pluginId: string;
  override readonly cause: unknown;
  readonly disposalErrors: readonly DisposalFailure[];

  constructor(
    pluginId: string,
    cause: unknown,
    disposalErrors: readonly DisposalFailure[],
  ) {
    const rollback = disposalErrors.length > 0
      ? `; ${disposalErrors.length} disposal error(s) during rollback`
      : '';
    super(`plugin '${pluginId}' setup failed: ${errorMessage(cause)}${rollback}`);
    this.pluginId = pluginId;
    this.cause = cause;
    this.disposalErrors = disposalErrors;
  }
}

/** A lifecycle call arrived in the wrong state (for example start twice). */
export class LifecycleError extends KernelError {}

export interface ListenerFailure {
  readonly listenerId: string;
  readonly error: unknown;
}

/** One or more event listeners threw during an awaited emit. Remaining
 * listeners were still dispatched. */
export class EventEmitError extends KernelError {
  readonly eventType: KernelEventType;
  readonly failures: readonly ListenerFailure[];

  constructor(eventType: KernelEventType, failures: readonly ListenerFailure[]) {
    const details = failures
      .map((failure) => `listener '${failure.listenerId}': ${errorMessage(failure.error)}`)
      .join('; ');
    super(`event '${eventType}' dispatch failed: ${details}`);
    this.eventType = eventType;
    this.failures = failures;
  }
}

/** Errors collected while a run moved from terminal to disposed. Cleanup and
 * disposal still ran to completion before this error was raised. */
export class RunTerminalError extends KernelError {
  readonly runId: string;
  readonly errors: readonly unknown[];

  constructor(runId: string, errors: readonly unknown[]) {
    const details = errors.map(errorMessage).join('; ');
    super(`run '${runId}' terminal cleanup had ${errors.length} error(s): ${details}`);
    this.runId = runId;
    this.errors = errors;
  }
}
