/**
 * Plugin records and the setup-time context handed to plugins. Every
 * registration returns a disposer owned by the installing scope; context
 * collects them so rollback and disposal run in reverse order.
 */

import {
  MalformedPluginError,
  MissingDependencyError,
  ScopeValidationError,
} from './errors';
import { validateListener } from './events';
import type {
  CapekPlugin,
  CleanupBarrier,
  CompositionDiagnostics,
  ContextSectionContribution,
  Disposable,
  EffectiveTool,
  EventListenerContribution,
  PluginContext,
  ProvidedContextSection,
  RuntimeScope,
  ScopeDiagnosticsSnapshot,
  ServiceKey,
  ToolContribution,
} from './types';

/** The slice of a scope the plugin context is allowed to touch. */
export interface PluginContextHost {
  readonly kind: RuntimeScope;
  readonly scopeId: string;
  registerService(
    pluginId: string,
    key: ServiceKey<unknown>,
    value: unknown,
    replacesProvider?: string,
  ): Disposable;
  registerTool(pluginId: string, contribution: ToolContribution): Disposable;
  registerContextSection(
    pluginId: string,
    contribution: ContextSectionContribution,
  ): Disposable;
  registerListener(pluginId: string, contribution: EventListenerContribution): Disposable;
  registerBarrier(pluginId: string, barrier: CleanupBarrier): Disposable;
  resolveService<T>(key: ServiceKey<T>): T | undefined;
  listTools(): readonly EffectiveTool[];
  buildContext<TData = unknown>(data?: TData): Promise<readonly ProvidedContextSection[]>;
  snapshot(): ScopeDiagnosticsSnapshot;
}

export interface PluginRecord {
  readonly id: string;
  readonly version?: string;
  readonly scope: RuntimeScope;
  readonly plugin: CapekPlugin<unknown>;
  readonly context: PluginContextImpl;
  status: 'pending' | 'active' | 'failed' | 'disposed';
  returnedDisposable: Disposable | undefined;
}

export class PluginContextImpl implements PluginContext {
  readonly disposers: Disposable[] = [];
  private readonly providedIds = new Set<string>();
  private readonly declaredProvides: ReadonlySet<string>;

  constructor(
    private readonly host: PluginContextHost,
    private readonly plugin: CapekPlugin<unknown>,
  ) {
    this.declaredProvides = new Set((plugin.provides ?? []).map((key) => key.id));
  }

  get kind(): RuntimeScope {
    return this.host.kind;
  }

  get scopeId(): string {
    return this.host.scopeId;
  }

  get diagnostics(): CompositionDiagnostics {
    return { snapshot: () => this.host.snapshot() };
  }

  provide<T>(key: ServiceKey<T>, service: T): Disposable {
    if (key.scope !== this.host.kind) {
      throw new ScopeValidationError(
        `plugin '${this.plugin.id}' cannot provide service '${key.id}' with scope '${key.scope}' from a '${this.host.kind}' scope`,
      );
    }
    if (!this.declaredProvides.has(key.id)) {
      throw new MalformedPluginError(
        `plugin '${this.plugin.id}' provided service '${key.id}' without declaring it in provides`,
      );
    }
    if (this.providedIds.has(key.id)) {
      throw new MalformedPluginError(
        `plugin '${this.plugin.id}' provided service '${key.id}' more than once during setup`,
      );
    }
    this.providedIds.add(key.id);
    const replacesProvider = (this.plugin.overrides ?? [])
      .find((override) => override.key.id === key.id)?.replacedProvider;
    const registration = this.host.registerService(
      this.plugin.id,
      key,
      service,
      replacesProvider,
    );
    let removed = false;
    const tracked: Disposable = {
      dispose: () => {
        if (removed) return;
        removed = true;
        this.providedIds.delete(key.id);
        registration.dispose();
      },
    };
    this.disposers.push(tracked);
    return tracked;
  }

  require<T>(key: ServiceKey<T>): T {
    const resolved = this.host.resolveService(key);
    if (resolved === undefined) {
      throw new MissingDependencyError(
        `plugin '${this.plugin.id}' requires service '${key.id}' which is not available in the current scope chain`,
      );
    }
    return resolved;
  }

  optional<T>(key: ServiceKey<T>): T | undefined {
    return this.host.resolveService(key);
  }

  contributeTool(contribution: ToolContribution): Disposable {
    const registration = this.host.registerTool(this.plugin.id, contribution);
    this.disposers.push(registration);
    return registration;
  }

  contributeContext(contribution: ContextSectionContribution): Disposable {
    const registration = this.host.registerContextSection(this.plugin.id, contribution);
    this.disposers.push(registration);
    return registration;
  }

  listTools(): readonly EffectiveTool[] {
    return this.host.listTools();
  }

  buildContext<TData = unknown>(data?: TData): Promise<readonly ProvidedContextSection[]> {
    return this.host.buildContext(data);
  }

  contributeListener(contribution: EventListenerContribution): Disposable {
    validateListener(contribution);
    const registration = this.host.registerListener(this.plugin.id, contribution);
    this.disposers.push(registration);
    return registration;
  }


  registerCleanupBarrier(barrier: CleanupBarrier): Disposable {
    const registration = this.host.registerBarrier(this.plugin.id, barrier);
    this.disposers.push(registration);
    return registration;
  }

  get providedKeyIds(): ReadonlySet<string> {
    return this.providedIds;
  }
}

export function createPluginRecords(
  host: PluginContextHost,
  plugins: readonly CapekPlugin<unknown>[],
): Map<string, PluginRecord> {
  const records = new Map<string, PluginRecord>();
  for (const plugin of plugins) {
    records.set(plugin.id, {
      id: plugin.id,
      version: plugin.version,
      scope: plugin.scope,
      plugin,
      context: new PluginContextImpl(host, plugin),
      status: 'pending',
      returnedDisposable: undefined,
    });
  }
  return records;
}

export function isDisposable(value: unknown): value is Disposable {
  return typeof value === 'object' && value !== null && 'dispose' in value;
}

/** A plugin must provide exactly the services it declared. */
export function enforceDeclaredProvides(record: PluginRecord): void {
  const declared = new Set((record.plugin.provides ?? []).map((key) => key.id));
  const actual = record.context.providedKeyIds;
  for (const id of actual) {
    if (!declared.has(id)) {
      throw new MalformedPluginError(
        `plugin '${record.id}' provided service '${id}' without declaring it in provides`,
      );
    }
  }
  for (const id of declared) {
    if (!actual.has(id)) {
      throw new MalformedPluginError(
        `plugin '${record.id}' declared service '${id}' but did not provide it during setup`,
      );
    }
  }
}
