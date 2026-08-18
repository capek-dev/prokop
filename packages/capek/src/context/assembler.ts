import { AsyncLocalStorage } from 'node:async_hooks';
import type { Preconfig } from '@capekai/types';

/**
 * Context assembler contract and runtime accessors.
 *
 * The runtime core depends on this contract only: `getContextAssembler()`
 * resolves the assembler seeded for the active agent scope and `build()` is
 * the single entry point for ordered context assembly. The ordered
 * implementation lives in the plugin layer; the legacy fixed builder stays a
 * migration adapter and is never imported by the runtime core.
 */

/** Assembly options passed to every ordered context build. This is the exact
 * option set the fixed builder consumed; no new task content is allowed. */
export interface ContextAssemblyData {
  preconfig: Preconfig;
  workspacePath?: string;
  workspaceId?: string;
  additionalPaths?: string[];
  selfDelegationAvailable?: boolean;
}

/** The required runtime service contract for context assembly. */
export interface ContextAssembler {
  readonly id: string;
  build(data: ContextAssemblyData): Promise<string>;
}

/** Malformed assembly options fail predictably with this error instead of
 * surfacing unsafe property access deep inside a section provider. */
export class ContextAssemblyDataError extends Error {
  constructor(message: string) {
    super(message);
    this.name = new.target.name;
  }
}

/** Validates the typed assembly options contract. Returns the data unchanged
 * so callers can pass the validated value onward without casts. */
export function validateContextAssemblyData(data: unknown): ContextAssemblyData {
  if (typeof data !== 'object' || data === null) {
    throw new ContextAssemblyDataError('context assembly data must be an object');
  }
  const candidate = data as Partial<ContextAssemblyData>;
  const preconfig = candidate.preconfig;
  if (typeof preconfig !== 'object' || preconfig === null) {
    throw new ContextAssemblyDataError('context assembly data preconfig must be an object');
  }
  if (typeof (preconfig as { id?: unknown }).id !== 'string') {
    throw new ContextAssemblyDataError('context assembly data preconfig must declare a string id');
  }
  const systemPrompt = (preconfig as { systemPrompt?: unknown }).systemPrompt;
  if (systemPrompt !== undefined && typeof systemPrompt !== 'string') {
    throw new ContextAssemblyDataError(
      'context assembly data preconfig systemPrompt must be a string when present',
    );
  }
  for (const key of ['workspacePath', 'workspaceId'] as const) {
    const value = candidate[key];
    if (value !== undefined && typeof value !== 'string') {
      throw new ContextAssemblyDataError(
        `context assembly data ${key} must be a string when present`,
      );
    }
  }
  const additionalPaths = candidate.additionalPaths;
  if (
    additionalPaths !== undefined
    && (!Array.isArray(additionalPaths) || additionalPaths.some((entry) => typeof entry !== 'string'))
  ) {
    throw new ContextAssemblyDataError(
      'context assembly data additionalPaths must be an array of strings when present',
    );
  }
  const selfDelegationAvailable = candidate.selfDelegationAvailable;
  if (selfDelegationAvailable !== undefined && typeof selfDelegationAvailable !== 'boolean') {
    throw new ContextAssemblyDataError(
      'context assembly data selfDelegationAvailable must be a boolean when present',
    );
  }
  return candidate as ContextAssemblyData;
}

const scopedAssembler = new AsyncLocalStorage<ContextAssembler>();

/** Fallback used when no composed scope has seeded an assembler. The plugin
 * layer installs the fixed legacy builder adapter here, so consumers that
 * run outside `enterAgentScope` (the current Jean2 server path) keep the
 * exact pre-C3 behavior until they adopt the composed entry. */
let defaultAssembler: ContextAssembler | undefined;

export function setDefaultContextAssembler(assembler: ContextAssembler): void {
  defaultAssembler = assembler;
}

/** Resolves the assembler seeded for the active agent scope, falling back to
 * the default assembler for consumers that run outside a composed scope. */
export function getContextAssembler(): ContextAssembler {
  const assembler = scopedAssembler.getStore() ?? defaultAssembler;
  if (assembler === undefined) {
    throw new Error(
      'no ContextAssembler is active and no default assembler is installed',
    );
  }
  return assembler;
}

/** Seeds the active agent scope's assembler for the callback duration. */
export function withContextAssembler<T>(assembler: ContextAssembler, callback: () => T): T {
  return scopedAssembler.run(assembler, callback);
}
