import { AsyncLocalStorage } from 'node:async_hooks';
import type { Ask } from '@jean2/sdk';

/**
 * Internal contributed-domain-tool payload context (C5).
 *
 * The turn-execution core must not import optional domains. A domain plugin
 * attaches its executable payload to its kernel tool contribution under
 * `DOMAIN_TOOL_PAYLOAD_FIELD`; `enterAgentScope` collects every visible
 * payload into a scoped map keyed by tool name. Remaining C5 domains reuse
 * this seam instead of adding domain-specific ALS layers.
 *
 * Three states the core distinguishes:
 * - getContributedDomainToolPayloads() === null: no composed agent scope is
 *   entered; a registered legacy fallback may apply.
 * - an empty map: a composed scope is entered but carries no domain
 *   payloads; legacy fallbacks must never apply.
 * - a map with entries: the composed scope's own domain payloads.
 */

export const DOMAIN_TOOL_PAYLOAD_FIELD = 'capekDomainToolPayload';

export interface DomainToolExecuteContext {
  readonly workspaceId: string;
  readonly sessionId: string;
  /** Required: risk-bearing execution must always be able to ask for
   * permission. Callers supply a real ask function even for risk 'none'. */
  readonly ask: (ask: Ask) => Promise<unknown>;
  readonly agentId?: string | null;
  /** Domain-specific fields travel through this index signature. */
  readonly [field: string]: unknown;
}

export interface DomainToolPayload {
  readonly name: string;
  readonly description: string;
  readonly inputSchema: Readonly<Record<string, unknown>>;
  /** The domain's availability predicate (workspace settings gate). The
   * owning domain uses the same predicate for its context contribution. */
  readonly isEnabled?: (workspaceId: string, sessionId?: string) => boolean;
  /** Optional per-build definition resolver for tools whose description or
   * schema depends on per-session data (the task tool's resolved subagent
   * list, the workflow tool's allowed leaf agents). Returns null when the
   * tool must be omitted for this session. `allowedSubagentIds` carries a
   * build-time-captured target list when the domain needs it. */
  readonly resolveDefinition?: (
    sessionId: string,
    options?: Record<string, unknown>,
  ) => Promise<{
    description: string;
    inputSchema: Readonly<Record<string, unknown>>;
    allowedSubagentIds?: string[];
  } | null>;
  execute(
    input: Record<string, unknown>,
    context: DomainToolExecuteContext,
  ): Promise<Record<string, unknown>>;
}

export function isDomainToolPayload(value: unknown): value is DomainToolPayload {
  if (typeof value !== 'object' || value === null) return false;
  const candidate = value as Record<string, unknown>;
  return typeof candidate.name === 'string'
    && typeof candidate.description === 'string'
    && typeof candidate.inputSchema === 'object' && candidate.inputSchema !== null
    && typeof candidate.execute === 'function';
}

const scopedPayloads = new AsyncLocalStorage<ReadonlyMap<string, DomainToolPayload>>();

export function withContributedDomainToolPayloads<T>(
  payloads: ReadonlyMap<string, DomainToolPayload>,
  callback: () => T,
): T {
  return scopedPayloads.run(payloads, callback);
}

/** null means no composed agent scope is entered; an empty map is a real
 * composed scope with zero domain payloads and disables fallbacks. */
export function getContributedDomainToolPayloads(): ReadonlyMap<string, DomainToolPayload> | null {
  return scopedPayloads.getStore() ?? null;
}

const fallbacks = new Map<string, DomainToolPayload>();

export function registerDomainToolFallback(name: string, payload: DomainToolPayload): void {
  fallbacks.set(name, payload);
}

export function getDomainToolFallback(name: string): DomainToolPayload | null {
  return fallbacks.get(name) ?? null;
}

function isTestExecution(): boolean {
  return process.env.NODE_ENV === 'test'
    || (globalThis as { Bun?: { env?: Record<string, string> } }).Bun?.env?.NODE_ENV === 'test';
}

/** Test-only destructive reset. Fails closed outside test execution: a
 * production process must never be able to wipe the unscoped fallback
 * registry. The compatibility installation path
 * (`setJean2CompatibilityBindings`) is the idempotent production way to
 * restore the complete inventory. */
export function resetDomainToolFallbacksForTests(): void {
  if (!isTestExecution()) {
    throw new Error(
      'Domain tool fallback reset is only available during test execution',
    );
  }
  fallbacks.clear();
}
