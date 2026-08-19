/**
 * C6 compaction policy contract and default provider.
 *
 * The agent-scoped compaction service owns the current policy decisions:
 * policy resolution, the hybrid threshold formula, pruning knobs, the
 * failure cooldown, the replay selection, and the per-session concurrency
 * guard (all previously module-global state). The trigger creation, summary
 * generation, pruning, and failure persistence live in `task.ts` with their
 * safety invariants non-configurable.
 *
 * Environment variables become provider options at composition: the plugin
 * layer reads the composed `capek.runtime-configuration` service once at
 * setup and freezes the values into this service's options. Consumers that
 * run outside a composed scope (the current Jean2 server path) fall back to
 * one lazily created process-default service that keeps reading the active
 * configuration live, exactly like the pre-C6 module reads, until C8 retires
 * the compat surface.
 */

import { AsyncLocalStorage } from 'node:async_hooks';
import {
  findModel,
  getMaxOutputTokens,
  getRuntimeConfiguration,
} from '../configuration/runtime';
import { listMessagesWithParts } from '../storage/runtime';
import type {
  AutoThresholdResult,
  CompactionPolicy,
} from './contracts';

/** Fully resolved provider options. Every field holds the env-translated
 * value; nothing in this interface reads the environment. */
export interface CompactionServiceOptions {
  modelId: string | null;
  providerId: string | null;
  maxOutputTokens: number;
  preserveRecentToolCount: number;
  preserveSmallToolChars: number;
  toolClearCharsThreshold: number;
  maxPrunedToolCount: number;
  autoThresholdRatio: number;
  autoReserveCapTokens: number;
  autoSafetyMarginTokens: number;
}

/** Optional test seams. `failureCooldownState` replaces the owned cooldown
 * map; `now` replaces Date.now for cooldown window tests. Neither is used by
 * production wiring. */
export interface CompactionServiceCreateOptions {
  id?: string;
  /** When omitted (the process-default fallback), options resolve live from
   * the active runtime configuration, preserving the pre-C6 unscoped
   * behavior. Composed scopes always pass frozen composition-time options. */
  options?: CompactionServiceOptions;
  failureCooldownState?: Map<string, { count: number; lastFailureAt: number }>;
  now?: () => number;
}

/**
 * C6 compaction service contract. Agent-scoped behind
 * `capekCompactionServiceKey`. The default provider reproduces the exact
 * pre-C6 behavior; a custom provider may vary the policy resolution, pruning
 * numbers, threshold formula, cooldown, or replay selection without the
 * executor or task pipeline changing. The safety invariants (main-session
 * requirement, message-count validation, trigger validation, and boundary
 * validation) stay inside the task pipeline and are not options.
 */
export interface CompactionService {
  readonly id: string;
  /** Effective provider options for this scope. */
  readonly options: Readonly<CompactionServiceOptions>;
  /** Resolves a CompactionPolicy from optional overrides and session
   * defaults. Service options take precedence, then overrides, then session
   * values, then defaults. */
  resolvePolicy(
    sessionModelId: string | undefined,
    sessionProviderId: string | undefined,
    overrides?: Partial<CompactionPolicy>,
  ): CompactionPolicy;
  /** Hybrid auto-compaction threshold formula. */
  computeThreshold(modelId: string | undefined, policy?: CompactionPolicy): AutoThresholdResult;
  /** Failure cooldown: true when the session recently hit the consecutive
   * failure limit and compaction should be skipped. */
  shouldSkipCompaction(sessionId: string): boolean;
  recordCompactionFailure(sessionId: string): void;
  clearCompactionFailure(sessionId: string): void;
  /** Replay policy: the replay text used after a successful compaction, or
   * null when the history has no prior user turn to replay. */
  buildReplayText(sessionId: string): Promise<string | null>;
  /** Per-session compaction concurrency guard. */
  isCompactionActive(sessionId: string): boolean;
  beginCompaction(sessionId: string): void;
  endCompaction(sessionId: string): void;
}

const COMPACTION_FAILURE_COOLDOWN_MS = 60_000;
const COMPACTION_MAX_CONSECUTIVE_FAILURES = 2;

function resolveOptionsLive(): CompactionServiceOptions {
  const configuration = getRuntimeConfiguration();
  return {
    modelId: configuration.getCompactionModel() ?? null,
    providerId: configuration.getCompactionProvider() ?? null,
    maxOutputTokens: configuration.getCompactionMaxTokens(),
    preserveRecentToolCount: configuration.getCompactionPreserveRecentToolCount(),
    preserveSmallToolChars: configuration.getCompactionPreserveSmallToolChars(),
    toolClearCharsThreshold: configuration.getCompactionToolClearCharsThreshold(),
    maxPrunedToolCount: configuration.getCompactionMaxPrunedToolCount(),
    autoThresholdRatio: configuration.getCompactionAutoThresholdRatio(),
    autoReserveCapTokens: configuration.getCompactionAutoReserveCapTokens(),
    autoSafetyMarginTokens: configuration.getCompactionAutoSafetyMarginTokens(),
  };
}

/** The C6 default provider wrapping the exact pre-C6 behavior. */
export function createCompactionService(
  createOptions: CompactionServiceCreateOptions = {},
): CompactionService {
  const id = createOptions.id ?? 'compaction.default';
  const frozenOptions = createOptions.options;
  const failureCooldownState = createOptions.failureCooldownState
    ?? new Map<string, { count: number; lastFailureAt: number }>();
  const activeSessions = new Set<string>();
  const now = createOptions.now ?? Date.now;

  function currentOptions(): CompactionServiceOptions {
    return frozenOptions ?? resolveOptionsLive();
  }

  return {
    id,
    get options(): Readonly<CompactionServiceOptions> {
      return currentOptions();
    },
    resolvePolicy(
      sessionModelId: string | undefined,
      sessionProviderId: string | undefined,
      overrides?: Partial<CompactionPolicy>,
    ): CompactionPolicy {
      const current = currentOptions();
      return {
        modelId: current.modelId ?? overrides?.modelId ?? sessionModelId ?? null,
        providerId: current.providerId ?? overrides?.providerId ?? sessionProviderId ?? null,
        maxOutputTokens: overrides?.maxOutputTokens ?? current.maxOutputTokens,
        overflowThresholdRatio: overrides?.overflowThresholdRatio ?? null,
        // WS4: Budget-aware pruning - options take precedence, then overrides
        preserveRecentToolCount: overrides?.preserveRecentToolCount ?? current.preserveRecentToolCount,
        preserveSmallToolChars: overrides?.preserveSmallToolChars ?? current.preserveSmallToolChars,
        toolClearCharsThreshold: overrides?.toolClearCharsThreshold ?? current.toolClearCharsThreshold,
        maxPrunedToolCount: overrides?.maxPrunedToolCount ?? current.maxPrunedToolCount,
        // Hybrid formula - options take precedence, then overrides
        autoThresholdRatio: overrides?.autoThresholdRatio ?? current.autoThresholdRatio,
        autoReserveCapTokens: overrides?.autoReserveCapTokens ?? current.autoReserveCapTokens,
        autoSafetyMarginTokens: overrides?.autoSafetyMarginTokens ?? current.autoSafetyMarginTokens,
      };
    },
    computeThreshold(modelId: string | undefined, policy?: CompactionPolicy): AutoThresholdResult {
      const modelDef = modelId ? findModel(modelId) : undefined;
      const contextWindow = modelDef?.contextWindow;

      if (!contextWindow) {
        return { threshold: 0, contextWindow: undefined };
      }

      const modelMaxOutputTokens = getMaxOutputTokens(modelId!);
      const current = currentOptions();

      const autoThresholdRatio = policy?.autoThresholdRatio ?? current.autoThresholdRatio;
      const autoReserveCapTokens = policy?.autoReserveCapTokens ?? current.autoReserveCapTokens;
      const autoSafetyMarginTokens = policy?.autoSafetyMarginTokens ?? current.autoSafetyMarginTokens;

      const reserve = Math.min(modelMaxOutputTokens, autoReserveCapTokens);
      const ratioBasedThreshold = Math.floor(contextWindow * autoThresholdRatio);
      const safeThreshold = contextWindow - reserve - autoSafetyMarginTokens;

      const threshold = Math.max(0, Math.min(ratioBasedThreshold, safeThreshold));

      return { threshold, contextWindow };
    },
    shouldSkipCompaction(sessionId: string): boolean {
      const tracker = failureCooldownState.get(sessionId);
      if (!tracker) return false;

      const elapsed = now() - tracker.lastFailureAt;
      if (elapsed > COMPACTION_FAILURE_COOLDOWN_MS) {
        failureCooldownState.delete(sessionId);
        return false;
      }

      return tracker.count >= COMPACTION_MAX_CONSECUTIVE_FAILURES;
    },
    recordCompactionFailure(sessionId: string): void {
      const existing = failureCooldownState.get(sessionId);
      if (existing) {
        existing.count++;
        existing.lastFailureAt = now();
      } else {
        failureCooldownState.set(sessionId, { count: 1, lastFailureAt: now() });
      }
    },
    clearCompactionFailure(sessionId: string): void {
      failureCooldownState.delete(sessionId);
    },
    async buildReplayText(sessionId: string): Promise<string | null> {
      const allMessages = await listMessagesWithParts(sessionId);

      for (let i = allMessages.length - 2; i >= 0; i--) {
        const m = allMessages[i];
        if (m.message.role !== 'user') continue;
        if (m.parts.every((p) => p.type === 'compaction')) continue;

        const texts: string[] = [];
        for (const p of m.parts) {
          if (p.type === 'text' && p.text !== undefined) {
            if (!p.text.startsWith('Continue:') && !p.text.startsWith('Continue from')) {
              texts.push(p.text);
            }
          }
        }
        const text = texts.join(' ').trim();
        if (text) {
          return `Replay: ${text}`;
        }
      }

      return null;
    },
    isCompactionActive(sessionId: string): boolean {
      return activeSessions.has(sessionId);
    },
    beginCompaction(sessionId: string): void {
      activeSessions.add(sessionId);
    },
    endCompaction(sessionId: string): void {
      activeSessions.delete(sessionId);
    },
  };
}

const scopedService = new AsyncLocalStorage<CompactionService>();
let processDefaultService: CompactionService | undefined;

/** Resolves the service seeded for the active agent scope, falling back to
 * one lazily created process-default service for consumers that run outside
 * a composed scope (the current Jean2 server path). The process default
 * keeps reading the active configuration live, exactly like the pre-C6
 * module reads.
 *
 * The executor and the recovery policy both resolve through this accessor,
 * so outside a composed scope they share the same process-default instance:
 * one active-session set (the concurrency guard) and one failure-cooldown
 * map for the whole process, exactly like the pre-C6 module globals. */
export function getCompactionService(): CompactionService {
  return scopedService.getStore()
    ?? (processDefaultService ??= createCompactionService({ id: 'compaction.process-default' }));
}

/** Seeds a service for the callback duration. `enterAgentScope` seeds the
 * composed agent scope's service here. */
export function withCompactionService<T>(service: CompactionService, callback: () => T): T {
  return scopedService.run(service, callback);
}

/** Test-only reset of the lazily created process default. Exported from this
 * module only; no package subpath re-exports it. */
export function resetDefaultCompactionServiceForTests(): void {
  processDefaultService = undefined;
}

/** Compatibility function over the scoped service: resolves the default
 * policy with legacy-compatible defaults (model/provider stay null; env
 * translation happens through the service options).
 *
 * Scope dependence: inside a composed agent scope this reflects the scope's
 * frozen composition-time options; outside any scope it reads the live
 * active configuration through the process-default service. The pre-C6
 * module function read the live configuration unconditionally, so the
 * unscoped path is the exact compat behavior. */
export function getDefaultCompactionPolicy(): CompactionPolicy {
  const current = getCompactionService().options;
  return {
    modelId: null,
    providerId: null,
    maxOutputTokens: current.maxOutputTokens,
    overflowThresholdRatio: null,
    preserveRecentToolCount: current.preserveRecentToolCount,
    preserveSmallToolChars: current.preserveSmallToolChars,
    toolClearCharsThreshold: current.toolClearCharsThreshold,
    maxPrunedToolCount: current.maxPrunedToolCount,
    autoThresholdRatio: current.autoThresholdRatio,
    autoReserveCapTokens: current.autoReserveCapTokens,
    autoSafetyMarginTokens: current.autoSafetyMarginTokens,
  };
}

/** Compatibility function over the scoped service. Scope dependence:
 * composed scopes resolve through their frozen composition-time options;
 * the unscoped path reads the live active configuration exactly like the
 * pre-C6 module function. */
export function resolveCompactionPolicy(
  sessionModelId: string | undefined,
  sessionProviderId: string | undefined,
  overrides?: Partial<CompactionPolicy>,
): CompactionPolicy {
  return getCompactionService().resolvePolicy(sessionModelId, sessionProviderId, overrides);
}

/** Compatibility function over the scoped service. Scope dependence:
 * composed scopes resolve through their frozen composition-time options;
 * the unscoped path reads the live active configuration exactly like the
 * pre-C6 module function. */
export function computeAutoThreshold(
  modelId: string | undefined,
  policy?: CompactionPolicy,
): AutoThresholdResult {
  return getCompactionService().computeThreshold(modelId, policy);
}
