/**
 * C6 retry policy contract and default provider.
 *
 * The policy owns retry classification, backoff computation, circuit state,
 * and the no-retry-after-tool-activity side-effect barrier. `core/retry.ts`
 * is a pinned compatibility forwarder to `retry/stream-chat.ts`, which
 * resolves the active policy through `getRetryPolicy()`: a composed agent
 * scope seeds its own agent-scoped policy (own circuit map), and unscoped
 * consumers (the current Jean2 server path) fall back to one lazily created
 * process-default policy whose circuit state lives for the process lifetime,
 * exactly like the pre-C6 module-global map.
 *
 * `withRetryCircuitState` is the compatibility overlay seam: it overrides
 * only the circuit map for the callback duration, exactly like the pre-C6
 * scoped-circuit ALS. The server retry tests and legacy consumers keep using
 * it until C8 retires the compat surface.
 */

import { AsyncLocalStorage } from 'node:async_hooks';
import type { ChatRetryErrorType } from '@capekai/types';
import {
  ApiErrorType,
  classifyApiError,
  type ClassifiedError,
} from '../utils/errors';

export interface StreamRetryPolicy {
  maxRetries?: number;
  baseDelayMs?: number;
  maxDelayMs?: number;
  jitterRatio?: number;
}

export interface CircuitState {
  failures: number;
  lastFailureAt: number;
  openUntil: number;
}

const DEFAULT_MAX_RETRIES = 3;
const DEFAULT_BASE_DELAY_MS = 2_000;
const DEFAULT_MAX_DELAY_MS = 30_000;
const DEFAULT_JITTER_RATIO = 0.2;
const CIRCUIT_FAILURE_THRESHOLD = 3;
const CIRCUIT_FAILURE_WINDOW_MS = 60_000;
const CIRCUIT_COOLDOWN_MS = 30_000;

/** Inputs for the retry decision on one failed attempt. */
export interface RetryDecisionContext {
  /** One-based attempt number of the failing attempt. */
  retryNumber: number;
  maxRetries: number;
  classified: ClassifiedError;
  attemptHadToolActivity: boolean;
  aborted: boolean;
}

/**
 * C6 retry policy contract. Agent-scoped behind `capekRetryPolicyKey`. The
 * default provider reproduces the exact pre-C6 behavior; a custom provider
 * may vary the numeric defaults, the backoff curve, the circuit thresholds,
 * or the side-effect barrier without the stream loop changing.
 */
export interface RetryPolicy {
  readonly id: string;
  /** Numeric defaults used when per-call policy options omit a field. */
  readonly defaults: Readonly<Required<StreamRetryPolicy>>;
  /** Resolves an already-classified error as-is, otherwise classifies it. */
  classify(error: unknown): ClassifiedError;
  /** Maps a classified error to the `chat.retry` errorType value. */
  retryErrorType(classified: ClassifiedError): ChatRetryErrorType;
  /** True when the failed attempt may be retried: retryable, retries remain,
   * the attempt had no tool activity, and the run is not aborted. The
   * tool-activity check is the side-effect barrier. */
  canRetry(context: RetryDecisionContext): boolean;
  /** Exponential backoff with jitter, honoring Retry-After as a minimum. */
  calculateDelay(
    retryNumber: number,
    classified: ClassifiedError,
    baseDelayMs: number,
    maxDelayMs: number,
    jitterRatio: number,
  ): number;
  /** Abort-aware backoff wait; rejects with `RetryDelayAbortedError`. */
  waitForRetry(delayMs: number, signal: AbortSignal): Promise<void>;
  /** Circuit key derived from provider and model identity. */
  circuitKey(providerId: string | null | undefined, modelId: string | null | undefined): string;
  /** Milliseconds until the open circuit for the key closes, or 0. */
  openCircuitRemainingMs(key: string): number;
  /** Records a failed attempt; returns whether the circuit just opened. */
  recordCircuitFailure(key: string): boolean;
  /** Closes the circuit for the key (successful stream or expiry). */
  resetCircuit(key: string): void;
  /** Message override for the exhausted `chat.retry` event, or null to keep
   * the classified error message. */
  exhaustedMessage(context: {
    attemptHadToolActivity: boolean;
    circuitOpened: boolean;
  }): string | null;
}

export class RetryDelayAbortedError extends Error {
  constructor() {
    super('Retry delay aborted');
    this.name = 'RetryDelayAbortedError';
  }
}

function isClassifiedError(err: unknown): err is ClassifiedError {
  if (typeof err !== 'object' || err === null) {
    return false;
  }

  const candidate = err as Record<string, unknown>;
  return (
    typeof candidate.type === 'string'
    && typeof candidate.retryable === 'boolean'
    && typeof candidate.message === 'string'
    && 'originalError' in candidate
  );
}

function toRetryErrorType(type: ApiErrorType): ChatRetryErrorType {
  if (type === ApiErrorType.RateLimit) return 'rate_limit';
  if (type === ApiErrorType.Timeout) return 'timeout';
  if (type === ApiErrorType.Network) return 'network';
  return 'server_error';
}

/** Creates an empty circuit state map. Kept as the compat seam used by the
 * server retry tests and by `withRetryCircuitState`. */
export function createRetryCircuitState(): Map<string, CircuitState> {
  return new Map<string, CircuitState>();
}

export interface RetryPolicyOptions {
  id?: string;
  /** When omitted the policy owns a fresh map for its lifetime. */
  circuitState?: Map<string, CircuitState>;
}

/** The C6 default provider wrapping the exact pre-C6 behavior. */
export function createRetryPolicy(options: RetryPolicyOptions = {}): RetryPolicy {
  const id = options.id ?? 'retry.default';
  const circuitState = options.circuitState ?? createRetryCircuitState();

  function activeStateMap(): Map<string, CircuitState> {
    return scopedCircuitState.getStore() ?? circuitState;
  }

  const policy: RetryPolicy = {
    id,
    defaults: {
      maxRetries: DEFAULT_MAX_RETRIES,
      baseDelayMs: DEFAULT_BASE_DELAY_MS,
      maxDelayMs: DEFAULT_MAX_DELAY_MS,
      jitterRatio: DEFAULT_JITTER_RATIO,
    },
    classify(error: unknown): ClassifiedError {
      return isClassifiedError(error) ? error : classifyApiError(error);
    },
    retryErrorType(classified: ClassifiedError): ChatRetryErrorType {
      return toRetryErrorType(classified.type);
    },
    canRetry(context: RetryDecisionContext): boolean {
      return context.classified.retryable
        && context.retryNumber <= context.maxRetries
        && !context.attemptHadToolActivity
        && !context.aborted;
    },
    calculateDelay(
      retryNumber: number,
      classified: ClassifiedError,
      baseDelayMs: number,
      maxDelayMs: number,
      jitterRatio: number,
    ): number {
      const exponentialDelay = Math.min(baseDelayMs * 2 ** (retryNumber - 1), maxDelayMs);
      const jitterRange = exponentialDelay * jitterRatio;
      const jitteredDelay = Math.round(exponentialDelay - jitterRange + Math.random() * jitterRange * 2);
      return Math.max(jitteredDelay, classified.retryAfterMs ?? 0);
    },
    waitForRetry(delayMs: number, signal: AbortSignal): Promise<void> {
      if (signal.aborted) {
        return Promise.reject(new RetryDelayAbortedError());
      }

      return new Promise((resolve, reject) => {
        const timeout = setTimeout(() => {
          signal.removeEventListener('abort', onAbort);
          resolve();
        }, delayMs);
        const onAbort = () => {
          clearTimeout(timeout);
          signal.removeEventListener('abort', onAbort);
          reject(new RetryDelayAbortedError());
        };
        signal.addEventListener('abort', onAbort, { once: true });
      });
    },
    circuitKey(providerId: string | null | undefined, modelId: string | null | undefined): string {
      return `${providerId ?? 'default'}:${modelId ?? 'default'}`;
    },
    openCircuitRemainingMs(key: string): number {
      const states = activeStateMap();
      const state = states.get(key);
      if (!state) return 0;

      const now = Date.now();
      if (state.openUntil === 0) {
        if (now - state.lastFailureAt > CIRCUIT_FAILURE_WINDOW_MS) {
          states.delete(key);
        }
        return 0;
      }
      if (state.openUntil <= now) {
        states.delete(key);
        return 0;
      }
      return state.openUntil - now;
    },
    recordCircuitFailure(key: string): boolean {
      const now = Date.now();
      const states = activeStateMap();
      const previous = states.get(key);
      const previousFailures = previous && now - previous.lastFailureAt <= CIRCUIT_FAILURE_WINDOW_MS
        ? previous.failures
        : 0;
      const failures = previousFailures + 1;
      const openUntil = failures >= CIRCUIT_FAILURE_THRESHOLD
        ? now + CIRCUIT_COOLDOWN_MS
        : 0;
      states.set(key, { failures, lastFailureAt: now, openUntil });
      return openUntil > 0;
    },
    resetCircuit(key: string): void {
      activeStateMap().delete(key);
    },
    exhaustedMessage(context: { attemptHadToolActivity: boolean; circuitOpened: boolean }): string | null {
      if (context.attemptHadToolActivity) {
        return 'Automatic retry stopped because the failed attempt used a tool and replay could duplicate side effects.';
      }
      if (context.circuitOpened) {
        return 'Automatic retry stopped after repeated provider failures.';
      }
      return null;
    },
  };
  return policy;
}

const scopedPolicy = new AsyncLocalStorage<RetryPolicy>();
const scopedCircuitState = new AsyncLocalStorage<Map<string, CircuitState>>();
let processDefaultPolicy: RetryPolicy | undefined;

/** Resolves the policy seeded for the active agent scope, falling back to one
 * lazily created process-default policy for consumers that run outside a
 * composed scope (the current Jean2 server path). The process default keeps
 * the exact pre-C6 process-wide circuit behavior. */
export function getRetryPolicy(): RetryPolicy {
  return scopedPolicy.getStore()
    ?? (processDefaultPolicy ??= createRetryPolicy({ id: 'retry.process-default' }));
}

/** Seeds a policy for the callback duration. `enterAgentScope` seeds the
 * composed agent scope's policy here. */
export function withRetryPolicy<T>(policy: RetryPolicy, callback: () => T): T {
  return scopedPolicy.run(policy, callback);
}

/** Compatibility overlay: replaces only the circuit map for the callback
 * duration, exactly like the pre-C6 scoped-circuit AsyncLocalStorage. */
export function withRetryCircuitState<T>(state: Map<string, CircuitState>, callback: () => T): T {
  return scopedCircuitState.run(state, callback);
}

/** Test-only reset of the lazily created process default so unscoped-path
 * tests never leak circuit state across cases. Exported from this module
 * only; no package subpath re-exports it. */
export function resetDefaultRetryPolicyForTests(): void {
  processDefaultPolicy = undefined;
}
