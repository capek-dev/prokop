/**
 * Read-only composition diagnostics. Snapshots are built fresh on every
 * call, contain no plugin options and no service values, and can therefore
 * be surfaced to support and tests without leaking secrets.
 */

import type {
  ContextPhase,
  ContextSectionContribution,
  EffectiveContextSection,
  EffectiveTool,
  EventListenerContribution,
  ListenerDiagnostic,
  PluginStatus,
  ProvidedContextSection,
  RunStatus,
  RunTerminalOutcome,
  RuntimeScope,
  ScopeDiagnosticsSnapshot,
  ScopeStatus,
  ServiceDiagnostic,
  ServiceKey,
  ToolContribution,
} from './types';

export const CONTEXT_PHASES: readonly ContextPhase[] = [
  'identity',
  'preferences',
  'instructions',
  'workspace',
  'capabilities',
  'task',
];

export interface LocalToolRegistration {
  readonly contribution: ToolContribution;
  readonly pluginId: string;
}

export interface LocalContextSectionRegistration {
  readonly contribution: ContextSectionContribution;
  readonly pluginId: string;
}

export interface LocalListenerRegistration {
  readonly contribution: EventListenerContribution;
  readonly pluginId: string;
}


export interface ResolvedService {
  readonly key: ServiceKey<unknown>;
  readonly providerPluginId: string;
  readonly providerScope: RuntimeScope;
}

/** Structural view of a scope used by snapshot and listing helpers. */
export interface ScopeStateView {
  readonly kind: RuntimeScope;
  readonly scopeId: string;
  readonly parent: ScopeStateView | null;
  readonly status: ScopeStatus;
  readonly pluginRecords: readonly {
    readonly id: string;
    readonly version?: string;
    readonly scope: RuntimeScope;
    readonly status: PluginStatus;
  }[];
  readonly localServices: ReadonlyMap<string, ResolvedService>;
  readonly localTools: ReadonlyMap<string, LocalToolRegistration>;
  readonly localContextSections: ReadonlyMap<string, LocalContextSectionRegistration>;
  readonly localListeners: ReadonlyMap<string, LocalListenerRegistration>;
  readonly cleanupBarrierCount: number;
  readonly runId?: string;
  readonly runStatus?: RunStatus;
  readonly runOutcome?: RunTerminalOutcome;
  resolveServiceRecord(keyId: string): ResolvedService | null;
}

function chainOf(view: ScopeStateView): ScopeStateView[] {
  const chain: ScopeStateView[] = [];
  for (let current: ScopeStateView | null = view; current !== null; current = current.parent) {
    chain.push(current);
  }
  return chain;
}

function compareIds(a: string, b: string): number {
  if (a < b) return -1;
  if (a > b) return 1;
  return 0;
}

export function collectEffectiveServices(view: ScopeStateView): ServiceDiagnostic[] {
  const services: ServiceDiagnostic[] = [];
  const seen = new Set<string>();
  for (const scope of chainOf(view)) {
    for (const [keyId, registration] of scope.localServices) {
      if (seen.has(keyId)) continue;
      seen.add(keyId);
      services.push({
        keyId,
        keyScope: registration.key.scope,
        providerPluginId: registration.providerPluginId,
        providerScope: scope.kind,
      });
    }
  }
  return services;
}

export function collectEffectiveTools(view: ScopeStateView): EffectiveTool[] {
  const tools: EffectiveTool[] = [];
  const seen = new Set<string>();
  for (const scope of chainOf(view)) {
    for (const [toolId, registration] of scope.localTools) {
      if (seen.has(toolId)) continue;
      seen.add(toolId);
      const hiddenReasons: string[] = [];
      const explicit = registration.contribution.visibility;
      if (explicit?.visible === false) {
        hiddenReasons.push(explicit.reason ?? 'explicitly hidden by tool visibility');
      }
      for (const capability of registration.contribution.requiredCapabilities ?? []) {
        const resolved = view.resolveServiceRecord(capability.id);
        if (resolved === null || resolved.key.scope !== capability.scope) {
          hiddenReasons.push(`missing required capability '${capability.id}'`);
        }
      }
      tools.push({
        id: toolId,
        order: registration.contribution.order ?? 0,
        definition: registration.contribution.definition,
        ...(registration.contribution.payload !== undefined
          ? { payload: registration.contribution.payload }
          : {}),
        pluginId: registration.pluginId,
        visible: hiddenReasons.length === 0,
        hiddenReasons,
      });
    }
  }
  tools.sort((a, b) => (
    a.order - b.order
    || compareIds(a.pluginId, b.pluginId)
    || compareIds(a.id, b.id)
  ));
  return tools;
}

export function collectEffectiveContextSections(
  view: ScopeStateView,
): EffectiveContextSection[] {
  const sections: EffectiveContextSection[] = [];
  const seen = new Set<string>();
  for (const scope of chainOf(view)) {
    for (const [sectionId, registration] of scope.localContextSections) {
      if (seen.has(sectionId)) continue;
      seen.add(sectionId);
      sections.push({
        id: sectionId,
        phase: registration.contribution.phase,
        order: registration.contribution.order,
        pluginId: registration.pluginId,
        scopeKind: scope.kind,
      });
    }
  }
  sections.sort((a, b) => (
    CONTEXT_PHASES.indexOf(a.phase) - CONTEXT_PHASES.indexOf(b.phase)
    || a.order - b.order
    || compareIds(a.pluginId, b.pluginId)
    || compareIds(a.id, b.id)
  ));
  return sections;
}

function collectEffectiveListeners(view: ScopeStateView): ListenerDiagnostic[] {
  const listeners: ListenerDiagnostic[] = [];
  const seen = new Set<string>();
  for (const scope of chainOf(view)) {
    for (const [listenerId, registration] of scope.localListeners) {
      if (seen.has(listenerId)) continue;
      seen.add(listenerId);
      listeners.push({
        id: listenerId,
        eventTypes: registration.contribution.eventTypes,
        pluginId: registration.pluginId,
        scopeKind: scope.kind,
      });
    }
  }
  return listeners;
}


export function buildSnapshot(view: ScopeStateView): ScopeDiagnosticsSnapshot {
  const runFields = view.runId !== undefined
    ? { runId: view.runId, runStatus: view.runStatus, runOutcome: view.runOutcome }
    : {};
  return {
    scopeId: view.scopeId,
    kind: view.kind,
    parentKind: view.parent?.kind ?? null,
    status: view.status,
    plugins: view.pluginRecords.map((record) => ({
      id: record.id,
      version: record.version,
      scope: record.scope,
      status: record.status,
    })),
    services: collectEffectiveServices(view),
    tools: collectEffectiveTools(view).map(({ definition: _definition, payload: _payload, ...tool }) => tool),
    contextSections: collectEffectiveContextSections(view).map((section) => ({
      id: section.id,
      phase: section.phase,
      order: section.order,
      pluginId: section.pluginId,
      scopeKind: section.scopeKind,
    })),
    listeners: collectEffectiveListeners(view),
    cleanupBarrierCount: view.cleanupBarrierCount,
    ...runFields,
  };
}

/** Assembles effective context sections in deterministic order. Null
 * sections are omitted without shifting the other sections. The optional
 * `data` is passed through to every provider as `ContextBuildContext.data`. */
export async function buildContextSections(
  view: ScopeStateView,
  data?: unknown,
): Promise<ProvidedContextSection[]> {
  const chain = chainOf(view);
  const provided: ProvidedContextSection[] = [];
  for (const section of collectEffectiveContextSections(view)) {
    const owningScope = chain.find((scope) => scope.kind === section.scopeKind);
    const contribution = owningScope?.localContextSections.get(section.id)?.contribution;
    if (contribution === undefined) {
      continue;
    }
    const content = await contribution.provide({ kind: section.scopeKind, data });
    if (content === null) {
      continue;
    }
    provided.push({ id: section.id, phase: section.phase, content });
  }
  return provided;
}
