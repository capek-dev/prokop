/**
 * Kernel public types.
 *
 * The kernel is an internal dependency-free composition layer. It must not
 * import the AI SDK, Jean2 packages, Hono, SQLite, Bun product APIs, or any
 * Capek product domain. See 04-plugin-contract.md for the guarantees these
 * types describe.
 */

export type RuntimeScope = 'process' | 'agent' | 'run';

/** A typed capability contract. Identity is the id; scope names where the
 * service may be provided. */
export interface ServiceKey<T = unknown> {
  readonly id: string;
  readonly scope: RuntimeScope;
  readonly _type?: T;
}

export interface Disposable {
  dispose(): void | Promise<void>;
}

/** A completion or persistence barrier awaited during scope disposal. */
export type CleanupBarrier = PromiseLike<void> | (() => PromiseLike<void>);

/** Explicitly replaces the provider named by replacedProvider for one key. */
export interface ServiceOverride {
  readonly key: ServiceKey<unknown>;
  readonly replacedProvider: string;
}

/** A lifecycle unit that declares dependencies and contributes behavior. */
export interface CapekPlugin<Options = unknown> {
  readonly id: string;
  readonly version?: string;
  readonly scope: RuntimeScope;
  readonly provides?: readonly ServiceKey<unknown>[];
  readonly requires?: readonly ServiceKey<unknown>[];
  readonly optional?: readonly ServiceKey<unknown>[];
  readonly overrides?: readonly ServiceOverride[];
  setup(
    context: PluginContext,
    options: Options,
  ): void | Disposable | Promise<void | Disposable>;
}

/** An opaque model-facing tool payload. The kernel validates only that
 * `name` is a non-empty string; `parameters`, `inputSchema`, and any
 * additional fields are carried through untouched. */
export interface ToolDefinition {
  readonly name: string;
  readonly description?: string;
  readonly parameters?: Readonly<Record<string, unknown>>;
  readonly inputSchema?: Readonly<Record<string, unknown>>;
  readonly [extra: string]: unknown;
}

/** Optional visibility metadata for a tool. An explicit false hides the
 * tool even when every required capability resolves; reason explains why. */
export interface ToolVisibility {
  readonly visible: boolean;
  readonly reason?: string;
}

/** A model-facing tool contribution. Effective visibility combines an
 * explicit visibility false with missing required capabilities, matched by
 * service id and ServiceKey scope. Order is optional; omitted orders
 * default to 0 and sort before explicitly ordered tools with plugin-id
 * then contribution-id tie-breaks. */
export interface ToolContribution {
  readonly id: string;
  readonly order?: number;
  readonly definition: ToolDefinition;
  /** Opaque product-layer payload (for capek: the exact `LoadedTool` this
   * contribution advertises). The kernel never reads it; the effective-tool
   * view carries it through unchanged. */
  readonly payload?: unknown;
  readonly requiredCapabilities?: readonly ServiceKey<unknown>[];
  readonly visibility?: ToolVisibility;
}

export type ContextPhase =
  | 'identity'
  | 'preferences'
  | 'instructions'
  | 'workspace'
  | 'capabilities'
  | 'task';

/** The build-time context handed to a section provider. `data` carries the
 * opaque assembly options the caller passed to `buildContext(data?)`; the
 * kernel validates only that it is an object when present and never reads
 * its fields, so it stays dependency-free. Product layers type the data
 * through the `TData` parameter and validate the concrete shape. */
export interface ContextBuildContext<TData = unknown> {
  readonly kind: RuntimeScope;
  readonly data?: TData;
}

/** A context section contribution. Null omits the section without changing
 * the ordering of the others. */
export interface ContextSectionContribution<TData = unknown> {
  readonly id: string;
  readonly phase: ContextPhase;
  readonly order: number;
  provide(context: ContextBuildContext<TData>): string | null | Promise<string | null>;
}

export type RunTerminalOutcome = 'completed' | 'failed' | 'cancelled';

export interface RunStartedEvent {
  readonly type: 'run:started';
  readonly runId: string;
}

export interface RunTerminalEvent {
  readonly type: 'run:terminal';
  readonly runId: string;
  readonly outcome: RunTerminalOutcome;
  readonly reason?: string;
}

export interface RunDisposedEvent {
  readonly type: 'run:disposed';
  readonly runId: string;
}

export interface KernelEventMap {
  'run:started': RunStartedEvent;
  'run:terminal': RunTerminalEvent;
  'run:disposed': RunDisposedEvent;
}

export type KernelEventType = keyof KernelEventMap;
export type KernelEvent = KernelEventMap[KernelEventType];

/** An observer contribution for typed runtime events. Listeners are awaited
 * in deterministic order during emit. */
export interface EventListenerContribution {
  readonly id: string;
  readonly eventTypes: readonly KernelEventType[];
  handle(event: KernelEvent): void | Promise<void>;
}


export type ScopeStatus = 'active' | 'disposing' | 'disposed';
export type PluginStatus = 'pending' | 'active' | 'failed' | 'disposed';
export type RunStatus = 'created' | 'running' | 'terminal' | 'disposed';

export interface PluginDiagnostic {
  readonly id: string;
  readonly version?: string;
  readonly scope: RuntimeScope;
  readonly status: PluginStatus;
}

export interface ServiceDiagnostic {
  readonly keyId: string;
  readonly keyScope: RuntimeScope;
  readonly providerPluginId: string;
  readonly providerScope: RuntimeScope;
}

export interface ToolDiagnostic {
  readonly id: string;
  readonly order: number;
  readonly pluginId: string;
  readonly visible: boolean;
  readonly hiddenReasons: readonly string[];
}

export interface ContextSectionDiagnostic {
  readonly id: string;
  readonly phase: ContextPhase;
  readonly order: number;
  readonly pluginId: string;
  readonly scopeKind: RuntimeScope;
}

export interface ListenerDiagnostic {
  readonly id: string;
  readonly eventTypes: readonly KernelEventType[];
  readonly pluginId: string;
  readonly scopeKind: RuntimeScope;
}


/** Read-only composition inventory. Never contains plugin options or service
 * values, so it is safe to surface to support and tests. */
export interface ScopeDiagnosticsSnapshot {
  readonly scopeId: string;
  readonly kind: RuntimeScope;
  readonly parentKind: RuntimeScope | null;
  readonly status: ScopeStatus;
  readonly plugins: readonly PluginDiagnostic[];
  readonly services: readonly ServiceDiagnostic[];
  readonly tools: readonly ToolDiagnostic[];
  readonly contextSections: readonly ContextSectionDiagnostic[];
  readonly listeners: readonly ListenerDiagnostic[];
  readonly runId?: string;
  readonly runStatus?: RunStatus;
  readonly runOutcome?: RunTerminalOutcome;
  readonly cleanupBarrierCount: number;
}

export interface CompositionDiagnostics {
  snapshot(): ScopeDiagnosticsSnapshot;
}

/** The setup-time surface handed to plugins. Registrations return disposers
 * owned by the installing scope. */
export interface PluginContext {
  readonly kind: RuntimeScope;
  readonly scopeId: string;
  provide<T>(key: ServiceKey<T>, service: T): Disposable;
  require<T>(key: ServiceKey<T>): T;
  optional<T>(key: ServiceKey<T>): T | undefined;
  contributeTool(contribution: ToolContribution): Disposable;
  contributeContext(contribution: ContextSectionContribution): Disposable;
  /** The effective tool contributions of the current scope chain in
   * deterministic order, including contributions registered earlier in
   * setup. Narrow like buildContext: plugins never receive the scope
   * handle just to inspect tools. */
  listTools(): readonly EffectiveTool[];
  /** Assembles the effective context sections of the current scope chain in
   * deterministic order, including sections registered earlier in setup.
   * Narrow by design: plugins never receive the scope handle just to build
   * context. The optional `data` is passed through to section providers as
   * `ContextBuildContext.data` after the kernel validates it is an object. */
  buildContext<TData = unknown>(data?: TData): Promise<readonly ProvidedContextSection[]>;
  contributeListener(contribution: EventListenerContribution): Disposable;
  registerCleanupBarrier(barrier: CleanupBarrier): Disposable;
  readonly diagnostics: CompositionDiagnostics;
}

export interface EffectiveTool {
  readonly id: string;
  readonly order: number;
  readonly definition: ToolDefinition;
  /** The contribution's opaque payload, carried through unchanged. */
  readonly payload?: unknown;
  readonly pluginId: string;
  readonly visible: boolean;
  readonly hiddenReasons: readonly string[];
}

export interface EffectiveContextSection {
  readonly id: string;
  readonly phase: ContextPhase;
  readonly order: number;
  readonly pluginId: string;
  readonly scopeKind: RuntimeScope;
}

export interface ProvidedContextSection {
  readonly id: string;
  readonly phase: ContextPhase;
  readonly content: string;
}

export interface ScopeHandle {
  readonly kind: RuntimeScope;
  readonly scopeId: string;
  readonly parent: ScopeHandle | null;
  /** Live child scopes. A disposed child unregisters from its parent, so
   * this never retains closed scopes. */
  readonly childCount: number;
  require<T>(key: ServiceKey<T>): T;
  optional<T>(key: ServiceKey<T>): T | undefined;
  snapshot(): ScopeDiagnosticsSnapshot;
  listTools(): readonly EffectiveTool[];
  listContextSections(): readonly EffectiveContextSection[];
  /** Assembles effective context sections in deterministic order. Null
   * sections are omitted without shifting the others. The optional `data`
   * must be an object when present and is passed through to every section
   * provider as `ContextBuildContext.data`. */
  buildContext<TData = unknown>(data?: TData): Promise<readonly ProvidedContextSection[]>;
  dispose(): Promise<void>;
}

export interface RunCancellation {
  /** True when this call moved the run from a live state to terminal. */
  readonly acknowledged: boolean;
  /** Resolves after terminal event dispatch, cleanup barriers, reverse
   * disposal, and the disposed event. */
  readonly completion: Promise<void>;
}

export interface ProcessScopeHandle extends ScopeHandle {
  readonly kind: 'process';
  createAgentScope(
    plugins: readonly CapekPlugin[],
    options?: PluginOptionsMap,
  ): Promise<AgentScopeHandle>;
}

export interface AgentScopeHandle extends ScopeHandle {
  readonly kind: 'agent';
  createRunScope(
    runId: string,
    plugins: readonly CapekPlugin[],
    options?: PluginOptionsMap,
  ): Promise<RunScopeHandle>;
}

export interface RunScopeHandle extends ScopeHandle {
  readonly kind: 'run';
  readonly runId: string;
  readonly runStatus: RunStatus;
  start(): Promise<void>;
  markTerminal(outcome: 'completed' | 'failed'): Promise<void>;
  cancel(reason?: string): RunCancellation;
  registerCleanupBarrier(barrier: CleanupBarrier): Disposable;
}

export type PluginOptionsMap = Readonly<Record<string, unknown>>;
