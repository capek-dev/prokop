/**
 * Kernel creation API. This is an internal composition entry point beside
 * the current configuration path. It is intentionally not wired into
 * createAgent and not exported from the package root.
 */

import { LifecycleError } from './errors';
import {
  AgentScope,
  ProcessScope,
  agentScopeBrand,
  processScopeBrand,
} from './scope';
import type {
  AgentScopeHandle,
  CapekPlugin,
  PluginOptionsMap,
  ProcessScopeHandle,
  RunScopeHandle,
} from './types';

/** Scope parents are validated through brands registered in the global
 * symbol registry (Symbol.for), so a parent scope created through a
 * duplicate module instance still carries the same brand. The check
 * validates the parent link structurally across module instances; it is
 * not a security boundary against code that can read the global symbol
 * registry. */
function carriesBrand(target: unknown, brand: symbol): boolean {
  return typeof target === 'object' && target !== null
    && (target as Record<symbol, unknown>)[brand] === true;
}

export async function createProcessScope(
  plugins: readonly CapekPlugin<unknown>[],
  options?: PluginOptionsMap,
): Promise<ProcessScopeHandle> {
  return ProcessScope.create(plugins, options);
}

export async function createAgentScope(
  parent: ProcessScopeHandle,
  plugins: readonly CapekPlugin<unknown>[],
  options?: PluginOptionsMap,
): Promise<AgentScopeHandle> {
  if (!carriesBrand(parent, processScopeBrand)) {
    throw new LifecycleError('an agent scope requires a process scope parent');
  }
  return (parent as ProcessScope).createAgentScope(plugins, options);
}

export async function createRunScope(
  parent: AgentScopeHandle,
  runId: string,
  plugins: readonly CapekPlugin<unknown>[],
  options?: PluginOptionsMap,
): Promise<RunScopeHandle> {
  if (!carriesBrand(parent, agentScopeBrand)) {
    throw new LifecycleError('a run scope requires an agent scope parent');
  }
  return (parent as AgentScope).createRunScope(runId, plugins, options);
}
