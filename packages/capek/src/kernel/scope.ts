/**
 * Scope nodes. A process scope holds process plugins; agent scopes extend
 * it; run scopes extend an agent scope. Resolution order is run, agent,
 * process for services and contributions. Disposal disposes children in
 * reverse creation order, awaits registered cleanup barriers, then
 * disposes plugins in reverse activation order.
 */

import {
  DuplicateContributionError,
  DuplicateProviderError,
  LifecycleError,
  MalformedPluginError,
  RunTerminalError,
  ScopeValidationError,
  type DisposalFailure,
} from './errors';
import {
  CONTEXT_PHASES,
  buildContextSections,
  buildSnapshot,
  collectEffectiveContextSections,
  collectEffectiveGuards,
  collectEffectiveProjections,
  collectEffectiveTools,
  type LocalContextSectionRegistration,
  type LocalGuardRegistration,
  type LocalListenerRegistration,
  type LocalProjectionRegistration,
  type LocalToolRegistration,
  type ResolvedService,
} from './diagnostics';
import { dispatchEvent, validateListener, type ListenerRegistration } from './events';
import { activateRecords, disposeRecords, throwDisposalError } from './lifecycle';
import { createPluginRecords, type PluginContextHost, type PluginRecord } from './plugin';
import { planActivation, type ParentServiceInfo } from './registry';
import type {
  CapekPlugin,
  CapabilityGuardContribution,
  CapabilityGuardDiagnostic,
  CleanupBarrier,
  ContextSectionContribution,
  Disposable,
  EffectiveContextSection,
  EffectiveTool,
  EventListenerContribution,
  KernelEvent,
  PluginOptionsMap,
  ProjectionContribution,
  ProjectionDiagnostic,
  ProvidedContextSection,
  RunCancellation,
  RunStatus,
  RunTerminalOutcome,
  RuntimeScope,
  ScopeDiagnosticsSnapshot,
  ScopeStatus,
  ServiceKey,
  ToolContribution,
} from './types';

let scopeCounter = 0;

function nextScopeId(kind: RuntimeScope): string {
  scopeCounter += 1;
  return `${kind}:${scopeCounter}`;
}

/** Brands registered in the global symbol registry so a parent scope
 * created through a duplicate module instance still carries the same
 * brand. The check validates the parent link structurally across module
 * instances; it is not a security boundary against code that can read the
 * global symbol registry. */
export const processScopeBrand: unique symbol = Symbol.for('capek.kernel.process-scope');
export const agentScopeBrand: unique symbol = Symbol.for('capek.kernel.agent-scope');

interface ServiceRegistration {
  readonly key: ServiceKey<unknown>;
  readonly value: unknown;
  readonly providerPluginId: string;
}

interface BarrierRegistration {
  readonly fn: () => PromiseLike<void>;
  readonly pluginId: string;
  removed: boolean;
}

type ContributionStoreKey = 'tool' | 'context' | 'listener' | 'guard' | 'projection';

function validateContributionObject(kind: string, value: unknown): asserts value is object {
  if (typeof value !== 'object' || value === null) {
    throw new MalformedPluginError(`${kind} contribution must be an object`);
  }
}

function validateContributionId(kind: string, id: unknown): asserts id is string {
  if (typeof id !== 'string' || id.length === 0) {
    throw new MalformedPluginError(`${kind} contribution id must be a non-empty string`);
  }
}

function validateFiniteOrder(kind: string, id: string, order: unknown): asserts order is number {
  if (typeof order !== 'number' || !Number.isFinite(order)) {
    throw new MalformedPluginError(`${kind} contribution '${id}' must have a finite order`);
  }
}

const VALID_KEY_SCOPES: ReadonlySet<string> = new Set(['process', 'agent', 'run']);

function validateServiceKeyShape(
  kind: string,
  contributionId: string,
  key: unknown,
): asserts key is ServiceKey<unknown> {
  if (typeof key !== 'object' || key === null) {
    throw new MalformedPluginError(
      `${kind} contribution '${contributionId}' requiredCapabilities must contain only service keys`,
    );
  }
  const candidate = key as Partial<ServiceKey<unknown>>;
  if (typeof candidate.id !== 'string' || candidate.id.length === 0) {
    throw new MalformedPluginError(
      `${kind} contribution '${contributionId}' requiredCapabilities contains a service key with a non-string or empty id`,
    );
  }
  if (!VALID_KEY_SCOPES.has(candidate.scope as string)) {
    throw new MalformedPluginError(
      `${kind} contribution '${contributionId}' requiredCapabilities contains service key '${candidate.id}' with invalid scope '${String(candidate.scope)}'`,
    );
  }
}

function validateEventTypeList(
  kind: string,
  id: string,
  value: unknown,
): asserts value is readonly string[] {
  if (!Array.isArray(value)) {
    throw new MalformedPluginError(
      `${kind} contribution '${id}' eventTypes must be an array of non-empty strings`,
    );
  }
  if (value.length === 0) {
    throw new MalformedPluginError(
      `${kind} contribution '${id}' must declare at least one event type`,
    );
  }
  for (const entry of value) {
    if (typeof entry !== 'string' || entry.length === 0) {
      throw new MalformedPluginError(
        `${kind} contribution '${id}' eventTypes must contain only non-empty strings`,
      );
    }
  }
}

function validateToolContribution(contribution: ToolContribution): void {
  validateContributionObject('tool', contribution);
  validateContributionId('tool', contribution.id);
  if (
    contribution.order !== undefined
    && (typeof contribution.order !== 'number' || !Number.isFinite(contribution.order))
  ) {
    throw new MalformedPluginError(
      `tool contribution '${contribution.id}' must have a finite order when present`,
    );
  }
  const definition = contribution.definition;
  if (typeof definition !== 'object' || definition === null) {
    throw new MalformedPluginError(
      `tool contribution '${contribution.id}' must carry an object definition`,
    );
  }
  if (typeof definition.name !== 'string' || definition.name.length === 0) {
    throw new MalformedPluginError(
      `tool contribution '${contribution.id}' definition name must be a non-empty string`,
    );
  }
  const requiredCapabilities = contribution.requiredCapabilities;
  if (requiredCapabilities !== undefined && requiredCapabilities !== null) {
    if (!Array.isArray(requiredCapabilities)) {
      throw new MalformedPluginError(
        `tool contribution '${contribution.id}' requiredCapabilities must be an array of service keys`,
      );
    }
    for (const key of requiredCapabilities) {
      validateServiceKeyShape('tool', contribution.id, key);
    }
  }
  const visibility = contribution.visibility;
  if (visibility !== undefined && visibility !== null) {
    if (typeof visibility !== 'object') {
      throw new MalformedPluginError(
        `tool contribution '${contribution.id}' visibility must be an object`,
      );
    }
    if (typeof (visibility as { visible?: unknown }).visible !== 'boolean') {
      throw new MalformedPluginError(
        `tool contribution '${contribution.id}' visibility must declare a boolean visible`,
      );
    }
    const reason = (visibility as { reason?: unknown }).reason;
    if (reason !== undefined && typeof reason !== 'string') {
      throw new MalformedPluginError(
        `tool contribution '${contribution.id}' visibility reason must be a string when present`,
      );
    }
  }
}

function validateGuardShape(contribution: CapabilityGuardContribution): void {
  validateContributionObject('capability guard', contribution);
  validateContributionId('capability guard', contribution.id);
  validateFiniteOrder('capability guard', contribution.id, contribution.order);
  if (typeof contribution.evaluate !== 'function') {
    throw new MalformedPluginError(
      `capability guard '${contribution.id}' must provide an evaluate function`,
    );
  }
}

function validateProjectionShape(contribution: ProjectionContribution): void {
  validateContributionObject('projection', contribution);
  validateContributionId('projection', contribution.id);
  if (
    contribution.order !== undefined
    && (typeof contribution.order !== 'number' || !Number.isFinite(contribution.order))
  ) {
    throw new MalformedPluginError(
      `projection contribution '${contribution.id}' must have a finite order when present`,
    );
  }
  validateEventTypeList('projection', contribution.id, contribution.eventTypes);
  if (typeof contribution.project !== 'function') {
    throw new MalformedPluginError(
      `projection '${contribution.id}' must provide a project function`,
    );
  }
  if (contribution.rebuild !== undefined && typeof contribution.rebuild !== 'function') {
    throw new MalformedPluginError(
      `projection '${contribution.id}' rebuild must be a function when present`,
    );
  }
}

async function activateScope(
  scope: ScopeBase,
  plugins: readonly CapekPlugin<unknown>[],
  options: PluginOptionsMap,
): Promise<void> {
  const parentServices = scope.parent === null
    ? new Map<string, ParentServiceInfo>()
    : scope.parent.effectiveServiceInfos();
  const plan = planActivation(scope.kind, plugins, parentServices);
  const records = createPluginRecords(scope, plugins);
  scope.pluginRecords.push(...plan.order.map((id) => records.get(id) as PluginRecord));
  await activateRecords(scope.pluginRecords, plan.order, options);
}

export abstract class ScopeBase implements PluginContextHost {
  abstract readonly kind: RuntimeScope;
  readonly scopeId: string;
  readonly parent: ScopeBase | null;
  status: ScopeStatus = 'active';
  readonly pluginRecords: PluginRecord[] = [];

  private readonly services = new Map<string, ServiceRegistration>();
  private readonly tools = new Map<string, LocalToolRegistration>();
  private readonly contextSections = new Map<string, LocalContextSectionRegistration>();
  private readonly listeners = new Map<string, ListenerRegistration>();
  private readonly guards = new Map<string, LocalGuardRegistration>();
  private readonly projections = new Map<string, LocalProjectionRegistration>();
  private readonly barriers: BarrierRegistration[] = [];
  private readonly children: ScopeBase[] = [];
  private disposePromise: Promise<void> | null = null;

  protected constructor(parent: ScopeBase | null, kind: RuntimeScope, scopeId?: string) {
    this.parent = parent;
    this.scopeId = scopeId ?? nextScopeId(kind);
  }

  // Host surface used by plugin contexts.

  registerService(
    pluginId: string,
    key: ServiceKey<unknown>,
    value: unknown,
    replacesProvider?: string,
  ): Disposable {
    const existing = this.services.get(key.id);
    if (existing !== undefined && existing.providerPluginId !== replacesProvider) {
      throw new DuplicateProviderError(
        `service '${key.id}' is already provided by plugin '${existing.providerPluginId}' in this ${this.kind} scope`,
      );
    }
    const record: ServiceRegistration = { key, value, providerPluginId: pluginId };
    this.services.set(key.id, record);
    let removed = false;
    return {
      dispose: () => {
        if (removed) return;
        removed = true;
        if (this.services.get(key.id) === record) {
          this.services.delete(key.id);
        }
      },
    };
  }

  registerTool(pluginId: string, contribution: ToolContribution): Disposable {
    validateToolContribution(contribution);
    const existing = this.findContributionInChain('tool', contribution.id);
    if (existing !== null) {
      throw new DuplicateContributionError(
        `tool contribution '${contribution.id}' is already registered in the ${existing.scopeKind} scope by plugin '${existing.pluginId}'`,
      );
    }
    this.tools.set(contribution.id, { contribution, pluginId });
    let removed = false;
    return {
      dispose: () => {
        if (removed) return;
        removed = true;
        this.tools.delete(contribution.id);
      },
    };
  }

  registerContextSection(
    pluginId: string,
    contribution: ContextSectionContribution,
  ): Disposable {
    validateContributionObject('context section', contribution);
    validateContributionId('context section', contribution.id);
    validateFiniteOrder('context section', contribution.id, contribution.order);
    if (!(CONTEXT_PHASES as readonly unknown[]).includes(contribution.phase)) {
      throw new MalformedPluginError(
        `context section '${contribution.id}' has unknown phase '${String(contribution.phase)}'`,
      );
    }
    if (typeof contribution.provide !== 'function') {
      throw new MalformedPluginError(
        `context section '${contribution.id}' must provide a provide function`,
      );
    }
    const existing = this.findContributionInChain('context', contribution.id);
    if (existing !== null) {
      throw new DuplicateContributionError(
        `context section '${contribution.id}' is already registered in the ${existing.scopeKind} scope by plugin '${existing.pluginId}'`,
      );
    }
    this.contextSections.set(contribution.id, { contribution, pluginId });
    let removed = false;
    return {
      dispose: () => {
        if (removed) return;
        removed = true;
        this.contextSections.delete(contribution.id);
      },
    };
  }

  registerListener(pluginId: string, contribution: EventListenerContribution): Disposable {
    validateListener(contribution);
    const existing = this.findContributionInChain('listener', contribution.id);
    if (existing !== null) {
      throw new DuplicateContributionError(
        `listener '${contribution.id}' is already registered in the ${existing.scopeKind} scope by plugin '${existing.pluginId}'`,
      );
    }
    this.listeners.set(contribution.id, { contribution, pluginId });
    let removed = false;
    return {
      dispose: () => {
        if (removed) return;
        removed = true;
        this.listeners.delete(contribution.id);
      },
    };
  }

  registerCapabilityGuard(
    pluginId: string,
    contribution: CapabilityGuardContribution,
  ): Disposable {
    validateGuardShape(contribution);
    const existing = this.findContributionInChain('guard', contribution.id);
    if (existing !== null) {
      throw new DuplicateContributionError(
        `capability guard '${contribution.id}' is already registered in the ${existing.scopeKind} scope by plugin '${existing.pluginId}'`,
      );
    }
    this.guards.set(contribution.id, { contribution, pluginId });
    let removed = false;
    return {
      dispose: () => {
        if (removed) return;
        removed = true;
        this.guards.delete(contribution.id);
      },
    };
  }

  registerProjection(
    pluginId: string,
    contribution: ProjectionContribution,
  ): Disposable {
    validateProjectionShape(contribution);
    const existing = this.findContributionInChain('projection', contribution.id);
    if (existing !== null) {
      throw new DuplicateContributionError(
        `projection '${contribution.id}' is already registered in the ${existing.scopeKind} scope by plugin '${existing.pluginId}'`,
      );
    }
    this.projections.set(contribution.id, { contribution, pluginId });
    let removed = false;
    return {
      dispose: () => {
        if (removed) return;
        removed = true;
        this.projections.delete(contribution.id);
      },
    };
  }

  /** Walks the scope chain so a child scope can never register an id that is
   * already contributed by any ancestor. Distinct ancestor ids stay inherited. */
  private findContributionInChain(
    kind: ContributionStoreKey,
    id: string,
  ): { pluginId: string; scopeKind: RuntimeScope } | null {
    const local = this.contributionMapFor(kind).get(id);
    if (local !== undefined) {
      return { pluginId: local.pluginId, scopeKind: this.kind };
    }
    return this.parent === null
      ? null
      : this.parent.findContributionInChain(kind, id);
  }

  private contributionMapFor(kind: ContributionStoreKey): ReadonlyMap<string, { pluginId: string }> {
    switch (kind) {
      case 'tool': return this.tools;
      case 'context': return this.contextSections;
      case 'listener': return this.listeners;
      case 'guard': return this.guards;
      case 'projection': return this.projections;
    }
  }

  registerBarrier(pluginId: string, barrier: CleanupBarrier): Disposable {
    const fn = typeof barrier === 'function' ? barrier : () => barrier;
    const registration: BarrierRegistration = { fn, pluginId, removed: false };
    this.barriers.push(registration);
    return {
      dispose: () => {
        registration.removed = true;
      },
    };
  }

  // Service resolution across the scope chain.

  resolveService<T>(key: ServiceKey<T>): T | undefined {
    const found = this.findServiceRegistration(key.id);
    if (found === null) return undefined;
    if (found.registration.key.scope !== key.scope) {
      throw new ScopeValidationError(
        `service '${key.id}' is provided with scope '${found.registration.key.scope}' by plugin '${found.registration.providerPluginId}' in the ${found.scopeKind} scope but was requested with scope '${key.scope}'; conflicting ServiceKey scopes cannot resolve`,
      );
    }
    return found.registration.value as T;
  }

  resolveServiceRecord(keyId: string): ResolvedService | null {
    const found = this.findServiceRegistration(keyId);
    if (found === null) return null;
    return {
      key: found.registration.key,
      providerPluginId: found.registration.providerPluginId,
      providerScope: found.scopeKind,
    };
  }

  private findServiceRegistration(keyId: string): {
    registration: ServiceRegistration;
    scopeKind: RuntimeScope;
  } | null {
    const local = this.services.get(keyId);
    if (local !== undefined) {
      return { registration: local, scopeKind: this.kind };
    }
    return this.parent === null ? null : this.parent.findServiceRegistration(keyId);
  }

  require<T>(key: ServiceKey<T>): T {
    const resolved = this.resolveService(key);
    if (resolved === undefined) {
      throw new LifecycleError(
        `service '${key.id}' is not available in the current scope chain`,
      );
    }
    return resolved;
  }

  optional<T>(key: ServiceKey<T>): T | undefined {
    return this.resolveService(key);
  }

  // Diagnostics and listings.

  snapshot(): ScopeDiagnosticsSnapshot {
    return buildSnapshot(this);
  }

  listTools(): readonly EffectiveTool[] {
    return collectEffectiveTools(this);
  }

  listContextSections(): readonly EffectiveContextSection[] {
    return collectEffectiveContextSections(this);
  }

  listCapabilityGuards(): readonly CapabilityGuardDiagnostic[] {
    return collectEffectiveGuards(this);
  }

  listProjections(): readonly ProjectionDiagnostic[] {
    return collectEffectiveProjections(this);
  }

  buildContext(): Promise<readonly ProvidedContextSection[]> {
    return buildContextSections(this);
  }

  // Structural views used by diagnostics and validation.

  get localServices(): ReadonlyMap<string, ResolvedService> {
    const view = new Map<string, ResolvedService>();
    for (const [keyId, registration] of this.services) {
      view.set(keyId, {
        key: registration.key,
        providerPluginId: registration.providerPluginId,
        providerScope: this.kind,
      });
    }
    return view;
  }

  get localTools(): ReadonlyMap<string, LocalToolRegistration> {
    return this.tools;
  }

  get localContextSections(): ReadonlyMap<string, LocalContextSectionRegistration> {
    return this.contextSections;
  }

  get localListeners(): ReadonlyMap<string, LocalListenerRegistration> {
    return this.listeners;
  }

  get localGuards(): ReadonlyMap<string, LocalGuardRegistration> {
    return this.guards;
  }

  get localProjections(): ReadonlyMap<string, LocalProjectionRegistration> {
    return this.projections;
  }

  get cleanupBarrierCount(): number {
    return this.barriers.filter((barrier) => !barrier.removed).length;
  }

  effectiveServiceInfos(): Map<string, ParentServiceInfo> {
    const infos = new Map<string, ParentServiceInfo>();
    this.collectServiceInfos(infos);
    return infos;
  }

  private collectServiceInfos(infos: Map<string, ParentServiceInfo>): void {
    for (const [keyId, registration] of this.services) {
      if (infos.has(keyId)) continue;
      infos.set(keyId, {
        pluginId: registration.providerPluginId,
        keyScope: registration.key.scope,
        providerScope: this.kind,
      });
    }
    this.parent?.collectServiceInfos(infos);
  }

  listenerChain(): {
    kind: RuntimeScope;
    listeners: readonly ListenerRegistration[];
  }[] {
    const chain: {
      kind: RuntimeScope;
      listeners: readonly ListenerRegistration[];
    }[] = [];
    this.collectListeners(chain);
    return chain;
  }

  private collectListeners(chain: {
    kind: RuntimeScope;
    listeners: readonly ListenerRegistration[];
  }[]): void {
    chain.push({
      kind: this.kind,
      listeners: [...this.listeners.values()],
    });
    this.parent?.collectListeners(chain);
  }

  addChild(child: ScopeBase): void {
    this.children.push(child);
  }

  // Disposal.

  dispose(): Promise<void> {
    if (this.status === 'disposed') return Promise.resolve();
    if (this.disposePromise !== null) return this.disposePromise;
    this.disposePromise = this.performDispose();
    return this.disposePromise;
  }

  async disposeFromParent(): Promise<void> {
    await this.dispose();
  }

  protected async performDispose(): Promise<void> {
    this.status = 'disposing';
    const failures: DisposalFailure[] = [];

    for (const child of [...this.children].reverse()) {
      try {
        await child.disposeFromParent();
      } catch (err) {
        failures.push({ pluginId: `child:${child.scopeId}`, error: err });
      }
    }

    for (const barrier of this.barriers) {
      if (barrier.removed) continue;
      try {
        await barrier.fn();
      } catch (err) {
        failures.push({ pluginId: barrier.pluginId, error: err });
      }
    }

    const recordFailures = await disposeRecords(this.pluginRecords);
    failures.push(...recordFailures);

    this.status = 'disposed';
    throwDisposalError(failures);
  }
}

export class ProcessScope extends ScopeBase {
  readonly kind = 'process' as const;
  readonly [processScopeBrand] = true as const;

  private constructor() {
    super(null, 'process');
  }

  static async create(
    plugins: readonly CapekPlugin<unknown>[],
    options?: PluginOptionsMap,
  ): Promise<ProcessScope> {
    const scope = new ProcessScope();
    await activateScope(scope, plugins, options ?? {});
    return scope;
  }

  async createAgentScope(
    plugins: readonly CapekPlugin<unknown>[],
    options?: PluginOptionsMap,
  ): Promise<AgentScope> {
    if (this.status !== 'active') {
      throw new LifecycleError(
        `cannot create an agent scope under a ${this.status} process scope`,
      );
    }
    const agent = await AgentScope.create(this, plugins, options);
    this.addChild(agent);
    return agent;
  }
}

export class AgentScope extends ScopeBase {
  readonly kind = 'agent' as const;
  readonly [agentScopeBrand] = true as const;

  private constructor(parent: ProcessScope) {
    super(parent, 'agent');
  }

  static async create(
    parent: ProcessScope,
    plugins: readonly CapekPlugin<unknown>[],
    options?: PluginOptionsMap,
  ): Promise<AgentScope> {
    const scope = new AgentScope(parent);
    await activateScope(scope, plugins, options ?? {});
    return scope;
  }

  async createRunScope(
    runId: string,
    plugins: readonly CapekPlugin<unknown>[],
    options?: PluginOptionsMap,
  ): Promise<RunScope> {
    if (typeof runId !== 'string' || runId.length === 0) {
      throw new MalformedPluginError('runId must be a non-empty string');
    }
    if (this.status !== 'active') {
      throw new LifecycleError(
        `cannot create a run scope under a ${this.status} agent scope`,
      );
    }
    const run = await RunScope.create(this, runId, plugins, options);
    this.addChild(run);
    return run;
  }
}

export class RunScope extends ScopeBase {
  readonly kind = 'run' as const;
  readonly runId: string;
  runStatus: RunStatus = 'created';
  runOutcome: RunTerminalOutcome | undefined;
  cancellationReason: string | undefined;

  private terminalCompletion: Promise<void> | null = null;
  private startDispatch: Promise<void> | null = null;

  private constructor(parent: AgentScope, runId: string) {
    super(parent, 'run');
    this.runId = runId;
  }

  static async create(
    parent: AgentScope,
    runId: string,
    plugins: readonly CapekPlugin<unknown>[],
    options?: PluginOptionsMap,
  ): Promise<RunScope> {
    const scope = new RunScope(parent, runId);
    await activateScope(scope, plugins, options ?? {});
    return scope;
  }

  async start(): Promise<void> {
    if (this.runStatus !== 'created') {
      throw new LifecycleError(
        `run '${this.runId}' cannot start: already ${this.runStatus}`,
      );
    }
    this.runStatus = 'running';
    // Register the started dispatch before emit begins so a reentrant cancel
    // from a synchronous started listener observes an in-flight startDispatch
    // and serializes the terminal chain behind every started listener.
    let resolveStarted!: () => void;
    let rejectStarted!: (error: unknown) => void;
    const started = new Promise<void>((resolve, reject) => {
      resolveStarted = resolve;
      rejectStarted = reject;
    });
    this.startDispatch = started;
    this.emit({ type: 'run:started', runId: this.runId }).then(
      () => {
        if (this.startDispatch === started) this.startDispatch = null;
        resolveStarted();
      },
      (error: unknown) => {
        if (this.startDispatch === started) this.startDispatch = null;
        rejectStarted(error);
      },
    );
    await started;
  }

  markTerminal(outcome: 'completed' | 'failed'): Promise<void> {
    if (this.runStatus === 'terminal' || this.runStatus === 'disposed') {
      return this.terminalCompletion ?? Promise.resolve();
    }
    this.runOutcome = outcome;
    this.runStatus = 'terminal';
    this.terminalCompletion = this.runTerminalChain();
    return this.terminalCompletion;
  }

  cancel(reason?: string): RunCancellation {
    if (this.runStatus === 'terminal' || this.runStatus === 'disposed') {
      return {
        acknowledged: false,
        completion: this.terminalCompletion ?? Promise.resolve(),
      };
    }
    this.cancellationReason = reason;
    this.runOutcome = 'cancelled';
    this.runStatus = 'terminal';
    this.terminalCompletion = this.runTerminalChain();
    return { acknowledged: true, completion: this.terminalCompletion };
  }

  registerCleanupBarrier(barrier: CleanupBarrier): Disposable {
    return this.registerBarrier(`run:${this.runId}`, barrier);
  }

  override dispose(): Promise<void> {
    if (this.status === 'disposed') return Promise.resolve();
    if (this.runStatus === 'created' || this.runStatus === 'running') {
      return Promise.reject(new LifecycleError(
        `run '${this.runId}' has not reached terminal state; call cancel() or markTerminal() before disposal`,
      ));
    }
    return this.terminalCompletion ?? super.dispose();
  }

  override async disposeFromParent(): Promise<void> {
    if (this.status === 'disposed') return;
    if (this.runStatus === 'created' || this.runStatus === 'running') {
      await this.cancel('parent scope disposed').completion;
      return;
    }
    if (this.terminalCompletion !== null) {
      await this.terminalCompletion;
    }
  }

  private emit(event: KernelEvent): Promise<void> {
    return dispatchEvent(this.listenerChain(), event);
  }

  private async runTerminalChain(): Promise<void> {
    const errors: unknown[] = [];
    // Serialize terminal dispatch behind an in-flight started dispatch so
    // events observe the run in order even when cancel races start.
    const pendingStart = this.startDispatch;
    if (pendingStart !== null) {
      try {
        await pendingStart;
      } catch (err) {
        errors.push(err);
      }
    }
    // Captured before disposal: plugin disposal removes listener
    // registrations from the scope maps, but the run:disposed event must
    // still reach every listener that observed this run.
    const chain = this.listenerChain();
    try {
      await dispatchEvent(chain, {
        type: 'run:terminal',
        runId: this.runId,
        outcome: this.runOutcome ?? 'cancelled',
        reason: this.cancellationReason,
      });
    } catch (err) {
      errors.push(err);
    }
    try {
      await this.performDispose();
    } catch (err) {
      errors.push(err);
    }
    this.runStatus = 'disposed';
    try {
      await dispatchEvent(chain, { type: 'run:disposed', runId: this.runId });
    } catch (err) {
      errors.push(err);
    }
    if (errors.length > 0) {
      throw new RunTerminalError(this.runId, errors);
    }
  }
}
