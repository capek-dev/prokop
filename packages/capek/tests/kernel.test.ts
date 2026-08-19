/**
 * C1 kernel matrix tests. Each describe block maps to a row of the kernel
 * and composition matrix in .architecture-v2/08-validation.md:
 * dependencies, providers, contributions, lifecycle, scopes, diagnostics,
 * and cancellation. The final block is the synthetic service composition
 * exit gate from 05-capek-phases.md.
 */

import { describe, expect, test } from 'bun:test';
import {
  ActivationError,
  DependencyCycleError,
  DisposalError,
  DuplicateContributionError,
  DuplicatePluginError,
  DuplicateProviderError,
  InvalidOverrideError,
  LifecycleError,
  MalformedPluginError,
  MissingDependencyError,
  RunTerminalError,
  ScopeValidationError,
  ServiceCollisionError,
  createAgentScope,
  createProcessScope,
  createRunScope,
  serviceKey,
} from '../src/kernel/index';
import type {
  AgentScopeHandle,
  CapekPlugin,
  ContextPhase,
  Disposable,
  KernelEventType,
  PluginContext,
  ProcessScopeHandle,
  RunScopeHandle,
  RuntimeScope,
  ServiceKey,
  ServiceOverride,
  ToolContribution,
  ToolVisibility,
} from '../src/kernel/index';

interface TrackedService {
  label: string;
}

const valueService = serviceKey<TrackedService>('service.value', 'process');
const otherService = serviceKey<TrackedService>('service.other', 'process');
const agentService = serviceKey<TrackedService>('service.agent', 'agent');
const runService = serviceKey<TrackedService>('service.run', 'run');

function deferred<T = void>(): {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (error: unknown) => void;
} {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

interface PluginShape {
  id: string;
  scope: RuntimeScope;
  version?: string;
  provides?: readonly ServiceKey<unknown>[];
  requires?: readonly ServiceKey<unknown>[];
  optional?: readonly ServiceKey<unknown>[];
  overrides?: readonly ServiceOverride[];
  setup?: (context: PluginContext, options: unknown) => void | Disposable | Promise<void | Disposable>;
}

function makePlugin(shape: PluginShape): CapekPlugin<unknown> {
  return {
    id: shape.id,
    version: shape.version,
    scope: shape.scope,
    provides: shape.provides,
    requires: shape.requires,
    optional: shape.optional,
    overrides: shape.overrides,
    setup: shape.setup ?? (() => {}),
  };
}

/** A plugin that provides one service and logs setup and disposal. */
function valueProvider(
  id: string,
  key: ServiceKey<TrackedService>,
  label: string,
  log: string[],
  options?: {
    setupLog?: boolean;
    disposeThrows?: boolean;
  },
): CapekPlugin<unknown> {
  return makePlugin({
    id,
    scope: key.scope,
    provides: [key],
    setup: (context) => {
      if (options?.setupLog !== false) log.push(`setup:${id}`);
      context.provide(key, { label });
      return {
        dispose: () => {
          if (options?.disposeThrows === true) {
            throw new Error(`dispose boom ${id}`);
          }
          log.push(`dispose:${id}`);
        },
      };
    },
  });
}

async function expectFailure<T extends Error>(
  promise: Promise<unknown>,
  errorType: new (...args: never[]) => T,
  messageFragment?: string,
): Promise<T> {
  let caught: unknown;
  try {
    await promise;
  } catch (err) {
    caught = err;
  }
  expect(caught).toBeInstanceOf(errorType);
  if (messageFragment !== undefined) {
    const message = caught instanceof Error ? caught.message : String(caught);
    expect(message).toContain(messageFragment);
  }
  return caught as T;
}

async function makeRunChain(options?: {
  processPlugins?: readonly CapekPlugin<unknown>[];
  agentPlugins?: readonly CapekPlugin<unknown>[];
  runPlugins?: readonly CapekPlugin<unknown>[];
  runId?: string;
}): Promise<{
  processScope: ProcessScopeHandle;
  agentScope: AgentScopeHandle;
  runScope: RunScopeHandle;
}> {
  const processScope = await createProcessScope(options?.processPlugins ?? []);
  const agentScope = await createAgentScope(processScope, options?.agentPlugins ?? []);
  const runScope = await createRunScope(
    agentScope,
    options?.runId ?? 'run-1',
    options?.runPlugins ?? [],
  );
  return { processScope, agentScope, runScope };
}

describe('service keys', () => {
  test('require returns the typed provider value and optional returns undefined', async () => {
    const log: string[] = [];
    const scope = await createProcessScope([
      valueProvider('provider', valueService, 'first', log),
    ]);
    expect(scope.require(valueService)).toEqual({ label: 'first' });
    expect(scope.optional(otherService)).toBeUndefined();
  });
});

describe('dependencies', () => {
  test('activates a required dependency before the dependent plugin', async () => {
    const log: string[] = [];
    const provider = valueProvider('provider', valueService, 'dep', log);
    const dependent = makePlugin({
      id: 'dependent',
      scope: 'process',
      requires: [valueService],
      setup: (context) => {
        const value = context.require(valueService);
        log.push(`setup:dependent:${value.label}`);
      },
    });
    const scope = await createProcessScope([dependent, provider]);
    expect(log).toEqual(['setup:provider', 'setup:dependent:dep']);
    expect(scope.require(valueService).label).toBe('dep');
  });

  test('rejects a missing required dependency before any setup runs', async () => {
    const log: string[] = [];
    const dependent = makePlugin({
      id: 'dependent',
      scope: 'process',
      requires: [valueService],
      setup: () => {
        log.push('setup:dependent');
      },
    });
    await expectFailure(
      createProcessScope([dependent]),
      MissingDependencyError,
      "plugin 'dependent' requires service 'service.value'",
    );
    expect(log).toEqual([]);
  });

  test('resolves a missing optional dependency as undefined without failing', async () => {
    const seen: string[] = [];
    const plugin = makePlugin({
      id: 'optional-consumer',
      scope: 'process',
      optional: [valueService],
      setup: (context) => {
        seen.push(context.optional(valueService) === undefined ? 'undefined' : 'defined');
      },
    });
    const scope = await createProcessScope([plugin]);
    expect(seen).toEqual(['undefined']);
    expect(scope.optional(valueService)).toBeUndefined();
  });

  test('activates optional dependency providers first so optional() sees them in any input order', async () => {
    const buildComposition = () => {
      const log: string[] = [];
      const seen: string[] = [];
      const provider = valueProvider('z-provider', valueService, 'present', log);
      const consumer = makePlugin({
        id: 'a-consumer',
        scope: 'process',
        optional: [valueService],
        setup: (context) => {
          const value = context.optional(valueService);
          seen.push(value === undefined ? 'undefined' : value.label);
        },
      });
      return { log, seen, provider, consumer };
    };

    const consumerFirst = buildComposition();
    const providerFirst = buildComposition();
    await createProcessScope([consumerFirst.consumer, consumerFirst.provider]);
    await createProcessScope([providerFirst.provider, providerFirst.consumer]);

    for (const composition of [consumerFirst, providerFirst]) {
      expect(composition.log).toEqual(['setup:z-provider']);
      expect(composition.seen).toEqual(['present']);
    }
  });

  test('reports dependency cycles with plugin and service identifiers', async () => {
    const xKey = serviceKey<TrackedService>('svc.x', 'process');
    const yKey = serviceKey<TrackedService>('svc.y', 'process');
    const log: string[] = [];
    const a = makePlugin({
      id: 'cycle-a',
      scope: 'process',
      provides: [xKey],
      requires: [yKey],
      setup: (context) => {
        log.push('setup:cycle-a');
        context.provide(xKey, { label: 'x' });
      },
    });
    const b = makePlugin({
      id: 'cycle-b',
      scope: 'process',
      provides: [yKey],
      requires: [xKey],
      setup: (context) => {
        log.push('setup:cycle-b');
        context.provide(yKey, { label: 'y' });
      },
    });
    const err = await expectFailure(
      createProcessScope([a, b]),
      DependencyCycleError,
      'dependency cycle detected',
    );
    expect(err.message).toContain("plugin 'cycle-a'");
    expect(err.message).toContain("plugin 'cycle-b'");
    expect(err.message).toContain('svc.x');
    expect(err.message).toContain('svc.y');
    expect(log).toEqual([]);
  });

  test('rejects a plugin that requires a service outside its resolvable scope chain', async () => {
    const plugin = makePlugin({
      id: 'process-consumer',
      scope: 'process',
      requires: [agentService],
      setup: () => {},
    });
    await expectFailure(
      createProcessScope([plugin]),
      ScopeValidationError,
      "cannot require service 'service.agent'",
    );
  });
});

describe('providers', () => {
  test('rejects duplicate providers of the same service without an explicit override', async () => {
    const log: string[] = [];
    const first = valueProvider('first', valueService, 'a', log);
    const second = valueProvider('second', valueService, 'b', log);
    const err = await expectFailure(
      createProcessScope([first, second]),
      DuplicateProviderError,
      "service 'service.value' is provided by multiple plugins",
    );
    expect(err.message).toContain("'first'");
    expect(err.message).toContain("'second'");
    expect(log).toEqual([]);
  });

  test('applies an explicit named override with deterministic order and reverse disposal', async () => {
    const log: string[] = [];
    const base = valueProvider('base', valueService, 'base', log);
    const overrider = makePlugin({
      id: 'overrider',
      scope: 'process',
      provides: [valueService],
      overrides: [{ key: valueService, replacedProvider: 'base' }],
      setup: (context) => {
        log.push('setup:overrider');
        context.provide(valueService, { label: 'overridden' });
        return { dispose: () => { log.push('dispose:overrider'); } };
      },
    });
    const scope = await createProcessScope([overrider, base]);
    expect(scope.require(valueService).label).toBe('overridden');
    const serviceEntry = scope.snapshot().services.find(
      (entry) => entry.keyId === 'service.value',
    );
    expect(serviceEntry?.providerPluginId).toBe('overrider');
    await scope.dispose();
    expect(log).toEqual([
      'setup:base',
      'setup:overrider',
      'dispose:overrider',
      'dispose:base',
    ]);
  });

  test('supports a two-step override chain', async () => {
    const log: string[] = [];
    const base = valueProvider('base', valueService, 'base', log);
    const mid = makePlugin({
      id: 'mid',
      scope: 'process',
      provides: [valueService],
      overrides: [{ key: valueService, replacedProvider: 'base' }],
      setup: (context) => {
        log.push('setup:mid');
        context.provide(valueService, { label: 'mid' });
        return { dispose: () => { log.push('dispose:mid'); } };
      },
    });
    const top = makePlugin({
      id: 'top',
      scope: 'process',
      provides: [valueService],
      overrides: [{ key: valueService, replacedProvider: 'mid' }],
      setup: (context) => {
        log.push('setup:top');
        context.provide(valueService, { label: 'top' });
        return { dispose: () => { log.push('dispose:top'); } };
      },
    });
    const scope = await createProcessScope([top, base, mid]);
    expect(scope.require(valueService).label).toBe('top');
    await scope.dispose();
    expect(log).toEqual([
      'setup:base',
      'setup:mid',
      'setup:top',
      'dispose:top',
      'dispose:mid',
      'dispose:base',
    ]);
  });

  test('rejects an override naming a plugin that does not provide the service', async () => {
    const log: string[] = [];
    const base = valueProvider('base', valueService, 'base', log);
    const other = valueProvider('other', otherService, 'other', log);
    const overrider = makePlugin({
      id: 'overrider',
      scope: 'process',
      provides: [valueService],
      overrides: [{ key: valueService, replacedProvider: 'other' }],
      setup: () => {},
    });
    await expectFailure(
      createProcessScope([base, other, overrider]),
      InvalidOverrideError,
      "plugin 'other', which does not provide that service",
    );
    expect(log).toEqual([]);
  });

  test('rejects conflicting overrides of the same provider', async () => {
    const log: string[] = [];
    const base = valueProvider('base', valueService, 'base', log);
    const first = makePlugin({
      id: 'overrider-a',
      scope: 'process',
      provides: [valueService],
      overrides: [{ key: valueService, replacedProvider: 'base' }],
      setup: () => {},
    });
    const second = makePlugin({
      id: 'overrider-b',
      scope: 'process',
      provides: [valueService],
      overrides: [{ key: valueService, replacedProvider: 'base' }],
      setup: () => {},
    });
    await expectFailure(
      createProcessScope([base, first, second]),
      InvalidOverrideError,
      "plugins 'overrider-a', 'overrider-b' both override plugin 'base'",
    );
    expect(log).toEqual([]);
  });

  test('rejects duplicate override entries for the same service key within one plugin', async () => {
    const log: string[] = [];
    const base = valueProvider('base', valueService, 'base', log);
    const plugin = makePlugin({
      id: 'double-override',
      scope: 'process',
      provides: [valueService],
      overrides: [
        { key: valueService, replacedProvider: 'base' },
        { key: valueService, replacedProvider: 'conflicting' },
      ],
      setup: () => {
        log.push('setup:double-override');
      },
    });
    await expectFailure(
      createProcessScope([base, plugin]),
      MalformedPluginError,
      "plugin 'double-override' declares more than one override for service 'service.value'",
    );
    expect(log).toEqual([]);
  });

  test('rejects overrides that never reach a base provider', async () => {
    const a = makePlugin({
      id: 'self-a',
      scope: 'process',
      provides: [valueService],
      overrides: [{ key: valueService, replacedProvider: 'self-b' }],
      setup: () => {},
    });
    const b = makePlugin({
      id: 'self-b',
      scope: 'process',
      provides: [valueService],
      overrides: [{ key: valueService, replacedProvider: 'self-a' }],
      setup: () => {},
    });
    await expectFailure(
      createProcessScope([a, b]),
      InvalidOverrideError,
      "service 'service.value' has no base provider",
    );
  });

  test('rejects an override whose service scope does not match the plugin scope', async () => {
    const plugin = makePlugin({
      id: 'wrong-scope-override',
      scope: 'agent',
      provides: [agentService],
      overrides: [{ key: valueService, replacedProvider: 'base' }],
      setup: () => {},
    });
    await expectFailure(
      createAgentScope(await createProcessScope([]), [plugin]),
      ScopeValidationError,
      "cannot override service 'service.value'",
    );
  });

  test('rolls back when an override provider fails to provide its declared service', async () => {
    const log: string[] = [];
    const base = valueProvider('base', valueService, 'base', log);
    const overrider = makePlugin({
      id: 'overrider',
      scope: 'process',
      provides: [valueService],
      overrides: [{ key: valueService, replacedProvider: 'base' }],
      setup: () => {
        log.push('setup:overrider');
      },
    });
    const err = await expectFailure(
      createProcessScope([base, overrider]),
      ActivationError,
      "plugin 'overrider' setup failed",
    );
    expect(String(err.cause)).toContain("declared service 'service.value' but did not provide it");
    expect(log).toEqual(['setup:base', 'setup:overrider', 'dispose:base']);
  });
});

describe('contributions', () => {
  test('orders context sections by phase, numeric order, plugin id, then contribution id', async () => {
    const pluginZeta = makePlugin({
      id: 'zeta',
      scope: 'process',
      setup: (context) => {
        context.contributeContext({
          id: 'z-workspace',
          phase: 'workspace',
          order: 10,
          provide: () => 'zeta workspace',
        });
        context.contributeContext({
          id: 'z-instructions',
          phase: 'instructions',
          order: 5,
          provide: () => 'zeta instructions',
        });
      },
    });
    const pluginAlpha = makePlugin({
      id: 'alpha',
      scope: 'process',
      setup: (context) => {
        context.contributeContext({
          id: 'a-instructions-b',
          phase: 'instructions',
          order: 5,
          provide: () => 'alpha instructions b',
        });
        context.contributeContext({
          id: 'a-instructions-a',
          phase: 'instructions',
          order: 5,
          provide: () => 'alpha instructions a',
        });
      },
    });
    const scopeA = await createProcessScope([pluginZeta, pluginAlpha]);
    const scopeB = await createProcessScope([pluginAlpha, pluginZeta]);
    const expected = [
      ['a-instructions-a', 'instructions'],
      ['a-instructions-b', 'instructions'],
      ['z-instructions', 'instructions'],
      ['z-workspace', 'workspace'],
    ];
    for (const scope of [scopeA, scopeB]) {
      expect(scope.listContextSections().map((section) => [section.id, section.phase])).toEqual(expected);
      expect(scope.snapshot().contextSections.map((section) => section.id)).toEqual(
        expected.map((entry) => entry[0]),
      );
    }
  });

  test('rejects duplicate contribution ids within one scope for tools, sections, and listeners', async () => {
    const makeDuplicateTool = () => createProcessScope([
      makePlugin({
        id: 'tool-a',
        scope: 'process',
        setup: (context) => {
          context.contributeTool({
            id: 'shared-tool',
            order: 1,
            definition: { name: 'shared' },
          });
        },
      }),
      makePlugin({
        id: 'tool-b',
        scope: 'process',
        setup: (context) => {
          context.contributeTool({
            id: 'shared-tool',
            order: 2,
            definition: { name: 'shared' },
          });
        },
      }),
    ]);
    const toolErr = await expectFailure(
      makeDuplicateTool(),
      ActivationError,
      "tool contribution 'shared-tool' is already registered in the process scope by plugin 'tool-a'",
    );
    expect(toolErr.cause).toBeInstanceOf(DuplicateContributionError);

    const makeDuplicateSection = () => createProcessScope([
      makePlugin({
        id: 'section-a',
        scope: 'process',
        setup: (context) => {
          context.contributeContext({
            id: 'shared-section',
            phase: 'instructions',
            order: 1,
            provide: () => 'a',
          });
        },
      }),
      makePlugin({
        id: 'section-b',
        scope: 'process',
        setup: (context) => {
          context.contributeContext({
            id: 'shared-section',
            phase: 'instructions',
            order: 1,
            provide: () => 'b',
          });
        },
      }),
    ]);
    const sectionErr = await expectFailure(
      makeDuplicateSection(),
      ActivationError,
      "context section 'shared-section' is already registered",
    );
    expect(sectionErr.cause).toBeInstanceOf(DuplicateContributionError);

    const makeDuplicateListener = () => createProcessScope([
      makePlugin({
        id: 'listener-a',
        scope: 'process',
        setup: (context) => {
          context.contributeListener({
            id: 'shared-listener',
            eventTypes: ['run:terminal'],
            handle: () => {},
          });
        },
      }),
      makePlugin({
        id: 'listener-b',
        scope: 'process',
        setup: (context) => {
          context.contributeListener({
            id: 'shared-listener',
            eventTypes: ['run:disposed'],
            handle: () => {},
          });
        },
      }),
    ]);
    const listenerErr = await expectFailure(
      makeDuplicateListener(),
      ActivationError,
      "listener 'shared-listener' is already registered",
    );
    expect(listenerErr.cause).toBeInstanceOf(DuplicateContributionError);
  });

  test('omits null context sections while preserving the order of the rest', async () => {
    const plugin = makePlugin({
      id: 'sections',
      scope: 'process',
      setup: (context) => {
        context.contributeContext({
          id: 'first',
          phase: 'instructions',
          order: 1,
          provide: () => null,
        });
        context.contributeContext({
          id: 'second',
          phase: 'instructions',
          order: 2,
          provide: () => 'second content',
        });
        context.contributeContext({
          id: 'third',
          phase: 'workspace',
          order: 3,
          provide: async () => 'third content',
        });
      },
    });
    const scope = await createProcessScope([plugin]);
    const built = await scope.buildContext();
    expect(built.map((section) => section.id)).toEqual(['second', 'third']);
    expect(built.map((section) => section.content)).toEqual(['second content', 'third content']);
  });

  test('inherits distinct parent contributions and rejects child shadowing by id', async () => {
    const processScope = await createProcessScope([
      makePlugin({
        id: 'process-contributor',
        scope: 'process',
        setup: (context) => {
          context.contributeTool({
            id: 'process-tool',
            order: 1,
            definition: { name: 'process-tool' },
          });
          context.contributeContext({
            id: 'process-section',
            phase: 'identity',
            order: 1,
            provide: () => 'from process',
          });
        },
      }),
    ]);
    const agentScope = await createAgentScope(processScope, []);
    const runScope = await createRunScope(agentScope, 'run-1', [
      makePlugin({
        id: 'run-contributor',
        scope: 'run',
        setup: (context) => {
          context.contributeContext({
            id: 'run-section',
            phase: 'identity',
            order: 2,
            provide: () => 'from run',
          });
        },
      }),
    ]);

    expect(runScope.listTools().map((tool) => tool.id)).toEqual(['process-tool']);
    expect(runScope.listContextSections().map((section) => [section.id, section.scopeKind])).toEqual([
      ['process-section', 'process'],
      ['run-section', 'run'],
    ]);
    const built = await runScope.buildContext();
    expect(built).toEqual([
      { id: 'process-section', phase: 'identity', content: 'from process' },
      { id: 'run-section', phase: 'identity', content: 'from run' },
    ]);

    // A child scope may not re-register an id contributed by an ancestor.
    const shadowErr = await expectFailure(
      createRunScope(agentScope, 'run-2', [
        makePlugin({
          id: 'shadowing',
          scope: 'run',
          setup: (context) => {
            context.contributeContext({
              id: 'process-section',
              phase: 'identity',
              order: 3,
              provide: () => 'shadow',
            });
          },
        }),
      ]),
      ActivationError,
      "context section 'process-section' is already registered in the process scope",
    );
    expect(shadowErr.cause).toBeInstanceOf(DuplicateContributionError);

    await runScope.cancel('done').completion;
    await agentScope.dispose();
    await processScope.dispose();
  });

  test('orders tools deterministically and derives visibility from required capabilities', async () => {
    const fsCapability = serviceKey<unknown>('capability.fs', 'agent');
    const questionCapability = serviceKey<unknown>('capability.question', 'agent');
    const log: string[] = [];
    const processScope = await createProcessScope([]);
    const agentScope = await createAgentScope(processScope, [
      makePlugin({
        id: 'capabilities',
        scope: 'agent',
        provides: [fsCapability],
        setup: (context) => {
          context.provide(fsCapability, {});
          log.push('setup:capabilities');
        },
      }),
      makePlugin({
        id: 'tool-source',
        scope: 'agent',
        setup: (context) => {
          context.contributeTool({
            id: 'shell',
            order: 20,
            definition: { name: 'shell' },
            requiredCapabilities: [fsCapability],
          });
          context.contributeTool({
            id: 'read-file',
            order: 10,
            definition: { name: 'read-file' },
            requiredCapabilities: [fsCapability],
          });
          context.contributeTool({
            id: 'ask-user',
            order: 5,
            definition: { name: 'ask-user' },
            requiredCapabilities: [questionCapability],
          });
        },
      }),
    ]);
    const tools = agentScope.listTools();
    expect(tools.map((tool) => tool.id)).toEqual(['ask-user', 'read-file', 'shell']);
    const askUser = tools.find((tool) => tool.id === 'ask-user');
    expect(askUser?.visible).toBe(false);
    expect(askUser?.hiddenReasons).toEqual(["missing required capability 'capability.question'"]);
    const readFile = tools.find((tool) => tool.id === 'read-file');
    expect(readFile?.visible).toBe(true);
    expect(readFile?.hiddenReasons).toEqual([]);
    await agentScope.dispose();
    await processScope.dispose();
  });

  test('combines explicit tool visibility with required capability resolution', async () => {
    const processScope = await createProcessScope([]);
    const agentScope = await createAgentScope(processScope, [
      makePlugin({
        id: 'tool-source',
        scope: 'agent',
        setup: (context) => {
          context.contributeTool({
            id: 'admin-tool',
            order: 1,
            definition: { name: 'admin-tool' },
            visibility: { visible: false, reason: 'admin only' },
          });
          context.contributeTool({
            id: 'hidden-no-reason',
            order: 2,
            definition: { name: 'hidden-no-reason' },
            visibility: { visible: false },
          });
          context.contributeTool({
            id: 'explicit-visible',
            order: 3,
            definition: { name: 'explicit-visible' },
            visibility: { visible: true, reason: 'always visible' },
          });
        },
      }),
    ]);
    const tools = agentScope.listTools();
    const adminTool = tools.find((tool) => tool.id === 'admin-tool');
    expect(adminTool?.visible).toBe(false);
    expect(adminTool?.hiddenReasons).toEqual(['admin only']);
    const hiddenNoReason = tools.find((tool) => tool.id === 'hidden-no-reason');
    expect(hiddenNoReason?.visible).toBe(false);
    expect(hiddenNoReason?.hiddenReasons).toEqual(['explicitly hidden by tool visibility']);
    const explicitVisible = tools.find((tool) => tool.id === 'explicit-visible');
    expect(explicitVisible?.visible).toBe(true);
    expect(explicitVisible?.hiddenReasons).toEqual([]);
    // The snapshot reports the explicit reason without exposing the definition.
    const adminDiagnostic = agentScope.snapshot().tools.find((tool) => tool.id === 'admin-tool');
    expect(adminDiagnostic?.visible).toBe(false);
    expect(adminDiagnostic?.hiddenReasons).toEqual(['admin only']);
    expect(adminDiagnostic).not.toHaveProperty('definition');
    await agentScope.dispose();
    await processScope.dispose();
  });

  test('resolves required capabilities by service id and ServiceKey scope', async () => {
    const processCapability = serviceKey<unknown>('capability.fs', 'process');
    const agentCapability = serviceKey<unknown>('capability.fs', 'agent');
    const processScope = await createProcessScope([
      makePlugin({
        id: 'process-capability',
        scope: 'process',
        provides: [processCapability],
        setup: (context) => {
          context.provide(processCapability, {});
        },
      }),
    ]);
    const agentScope = await createAgentScope(processScope, [
      makePlugin({
        id: 'tool-source',
        scope: 'agent',
        setup: (context) => {
          context.contributeTool({
            id: 'agent-scoped-tool',
            order: 1,
            definition: { name: 'agent-scoped-tool' },
            requiredCapabilities: [agentCapability],
          });
          context.contributeTool({
            id: 'process-scoped-tool',
            order: 2,
            definition: { name: 'process-scoped-tool' },
            requiredCapabilities: [processCapability],
          });
        },
      }),
    ]);
    const agentScoped = agentScope.listTools().find((tool) => tool.id === 'agent-scoped-tool');
    expect(agentScoped?.visible).toBe(false);
    expect(agentScoped?.hiddenReasons).toEqual(["missing required capability 'capability.fs'"]);
    const processScoped = agentScope.listTools().find((tool) => tool.id === 'process-scoped-tool');
    expect(processScoped?.visible).toBe(true);
    expect(processScoped?.hiddenReasons).toEqual([]);
    await agentScope.dispose();
    await processScope.dispose();
  });

  test('rejects malformed tool requiredCapabilities and visibility metadata', async () => {
    async function expectMalformedTool(contribution: ToolContribution, fragment: string): Promise<void> {
      const err = await expectFailure(
        createProcessScope([
          makePlugin({
            id: 'bad-tool',
            scope: 'process',
            setup: (context) => {
              context.contributeTool(contribution);
            },
          }),
        ]),
        ActivationError,
        'setup failed',
      );
      expect(err.cause).toBeInstanceOf(MalformedPluginError);
      expect(String(err.cause)).toContain(fragment);
    }

    await expectMalformedTool(
      {
        id: 'tool',
        definition: { name: 'tool' },
        requiredCapabilities: 'capability.fs' as unknown as ServiceKey<unknown>[],
      },
      "tool contribution 'tool' requiredCapabilities must be an array of service keys",
    );
    await expectMalformedTool(
      {
        id: 'tool',
        definition: { name: 'tool' },
        requiredCapabilities: [{ id: '' } as unknown as ServiceKey<unknown>],
      },
      "tool contribution 'tool' requiredCapabilities contains a service key with a non-string or empty id",
    );
    await expectMalformedTool(
      {
        id: 'tool',
        definition: { name: 'tool' },
        requiredCapabilities: [{ id: 'capability.fs', scope: 'global' } as unknown as ServiceKey<unknown>],
      },
      "tool contribution 'tool' requiredCapabilities contains service key 'capability.fs' with invalid scope 'global'",
    );
    await expectMalformedTool(
      {
        id: 'tool',
        definition: { name: 'tool' },
        visibility: { visible: 'yes' } as unknown as ToolVisibility,
      },
      "tool contribution 'tool' visibility must declare a boolean visible",
    );
    await expectMalformedTool(
      {
        id: 'tool',
        definition: { name: 'tool' },
        visibility: { visible: false, reason: 7 } as unknown as ToolVisibility,
      },
      "tool contribution 'tool' visibility reason must be a string when present",
    );
  });

  test('sorts tools with omitted order before explicit orders using deterministic tie-breaks', async () => {
    const buildPlugins = (): CapekPlugin<unknown>[] => [
      makePlugin({
        id: 'zeta',
        scope: 'process',
        setup: (context) => {
          context.contributeTool({ id: 'z-unordered', definition: { name: 'z-unordered' } });
          context.contributeTool({ id: 'z-ordered', order: 10, definition: { name: 'z-ordered' } });
        },
      }),
      makePlugin({
        id: 'alpha',
        scope: 'process',
        setup: (context) => {
          context.contributeTool({ id: 'a-unordered', definition: { name: 'a-unordered' } });
          context.contributeTool({ id: 'a-ordered', order: -5, definition: { name: 'a-ordered' } });
        },
      }),
    ];
    const scopeA = await createProcessScope(buildPlugins());
    const scopeB = await createProcessScope(buildPlugins().reverse());
    const expectedIds = ['a-ordered', 'a-unordered', 'z-unordered', 'z-ordered'];
    const expectedOrders = [-5, 0, 0, 10];
    for (const scope of [scopeA, scopeB]) {
      expect(scope.listTools().map((tool) => tool.id)).toEqual(expectedIds);
      expect(scope.listTools().map((tool) => tool.order)).toEqual(expectedOrders);
      expect(scope.snapshot().tools.map((tool) => tool.order)).toEqual(expectedOrders);
      await scope.dispose();
    }
  });

  test('orders tools deterministically regardless of reversed plugin input', async () => {
    const buildPlugins = (): CapekPlugin<unknown>[] => [
      makePlugin({
        id: 'z-tools',
        scope: 'process',
        setup: (context) => {
          context.contributeTool({ id: 'z-tool', order: 2, definition: { name: 'z-tool' } });
        },
      }),
      makePlugin({
        id: 'a-tools',
        scope: 'process',
        setup: (context) => {
          context.contributeTool({ id: 'a-tool-b', order: 1, definition: { name: 'a-tool-b' } });
          context.contributeTool({ id: 'a-tool-a', order: 1, definition: { name: 'a-tool-a' } });
        },
      }),
    ];
    const scopeA = await createProcessScope(buildPlugins());
    const scopeB = await createProcessScope(buildPlugins().reverse());
    const expected = ['a-tool-a', 'a-tool-b', 'z-tool'];
    for (const scope of [scopeA, scopeB]) {
      expect(scope.listTools().map((tool) => tool.id)).toEqual(expected);
      await scope.dispose();
    }
  });

  test('passes through opaque tool definitions carrying parameters, inputSchema, and extra fields', async () => {
    const definition = {
      name: 'search',
      parameters: { type: 'object' },
      inputSchema: { type: 'object' },
      custom: { vendor: 'x' },
      extraFlag: true,
    };
    const scope = await createProcessScope([
      makePlugin({
        id: 'tool-source',
        scope: 'process',
        setup: (context) => {
          context.contributeTool({ id: 'search', order: 1, definition });
        },
      }),
    ]);
    const listed = scope.listTools().find((tool) => tool.id === 'search');
    expect(listed?.definition).toEqual(definition);
    expect(listed?.visible).toBe(true);
    expect(listed?.hiddenReasons).toEqual([]);
    await scope.dispose();
  });

  test('rejects duplicate tool ids registered in a parent scope', async () => {
    const processScope = await createProcessScope([
      makePlugin({
        id: 'process-tools',
        scope: 'process',
        setup: (context) => {
          context.contributeTool({ id: 'shared-tool', order: 1, definition: { name: 'shared' } });
        },
      }),
    ]);
    const err = await expectFailure(
      createAgentScope(processScope, [
        makePlugin({
          id: 'agent-tools',
          scope: 'agent',
          setup: (context) => {
            context.contributeTool({ id: 'shared-tool', order: 2, definition: { name: 'shared' } });
          },
        }),
      ]),
      ActivationError,
      "tool contribution 'shared-tool' is already registered in the process scope",
    );
    expect(err.cause).toBeInstanceOf(DuplicateContributionError);
    await processScope.dispose();
  });

  test('rejects duplicate listener ids registered in a parent scope', async () => {
    const processScope = await createProcessScope([
      makePlugin({
        id: 'process-listeners',
        scope: 'process',
        setup: (context) => {
          context.contributeListener({
            id: 'shared-listener',
            eventTypes: ['run:disposed'],
            handle: () => {},
          });
        },
      }),
    ]);
    const err = await expectFailure(
      createAgentScope(processScope, [
        makePlugin({
          id: 'agent-listeners',
          scope: 'agent',
          setup: (context) => {
            context.contributeListener({
              id: 'shared-listener',
              eventTypes: ['run:terminal'],
              handle: () => {},
            });
          },
        }),
      ]),
      ActivationError,
      "listener 'shared-listener' is already registered in the process scope",
    );
    expect(err.cause).toBeInstanceOf(DuplicateContributionError);
    await processScope.dispose();
  });
});

describe('lifecycle', () => {
  test('activates in deterministic dependency order with plugin id tie-breaks', async () => {
    const log: string[] = [];
    const plugins = ['z-provider', 'a-provider', 'm-provider'].map((id) => (
      makePlugin({
        id,
        scope: 'process',
        setup: () => {
          log.push(`setup:${id}`);
        },
      })
    ));
    await createProcessScope(plugins);
    expect(log).toEqual(['setup:a-provider', 'setup:m-provider', 'setup:z-provider']);
  });

  test('disposes plugins in reverse activation order', async () => {
    const log: string[] = [];
    const xKey = serviceKey<TrackedService>('svc.x', 'process');
    const yKey = serviceKey<TrackedService>('svc.y', 'process');
    const xProvider = makePlugin({
      id: 'x-provider',
      scope: 'process',
      provides: [xKey],
      setup: (context) => {
        log.push('setup:x-provider');
        context.provide(xKey, { label: 'x' });
        return { dispose: () => { log.push('dispose:x-provider'); } };
      },
    });
    const yProvider = makePlugin({
      id: 'y-provider',
      scope: 'process',
      provides: [yKey],
      requires: [xKey],
      setup: (context) => {
        log.push('setup:y-provider');
        context.provide(yKey, { label: 'y' });
        return { dispose: () => { log.push('dispose:y-provider'); } };
      },
    });
    const scope = await createProcessScope([yProvider, xProvider]);
    expect(log).toEqual(['setup:x-provider', 'setup:y-provider']);
    await scope.dispose();
    expect(log).toEqual([
      'setup:x-provider',
      'setup:y-provider',
      'dispose:y-provider',
      'dispose:x-provider',
    ]);
  });

  test('rolls back completed plugins when a later setup fails and preserves the original error', async () => {
    const log: string[] = [];
    const first = makePlugin({
      id: 'first',
      scope: 'process',
      setup: () => {
        log.push('setup:first');
        return { dispose: () => { log.push('dispose:first'); } };
      },
    });
    const boom = new Error('setup boom');
    const second = makePlugin({
      id: 'second',
      scope: 'process',
      requires: [valueService],
      setup: (context) => {
        log.push('setup:second');
        context.contributeTool({
          id: 'partial-tool',
          order: 1,
          definition: { name: 'partial' },
        });
        throw boom;
      },
    });
    const provider = valueProvider('provider', valueService, 'dep', log);
    const err = await expectFailure(
      createProcessScope([provider, second, first]),
      ActivationError,
      "plugin 'second' setup failed",
    );
    expect(err.cause).toBe(boom);
    expect(log).toEqual([
      'setup:first',
      'setup:provider',
      'setup:second',
      'dispose:provider',
      'dispose:first',
    ]);
  });

  test('preserves disposal errors alongside the setup error during rollback', async () => {
    const log: string[] = [];
    const broken = makePlugin({
      id: 'broken',
      scope: 'process',
      setup: () => {
        log.push('setup:broken');
        return {
          dispose: () => {
            log.push('dispose:broken');
            throw new Error('rollback dispose boom');
          },
        };
      },
    });
    const failing = makePlugin({
      id: 'failing',
      scope: 'process',
      setup: () => {
        log.push('setup:failing');
        throw new Error('setup boom');
      },
    });
    const err = await expectFailure(
      createProcessScope([broken, failing]),
      ActivationError,
      "plugin 'failing' setup failed",
    );
    expect(String(err.cause)).toContain('setup boom');
    expect(err.disposalErrors).toHaveLength(1);
    expect(err.disposalErrors[0].pluginId).toBe('broken');
    expect(String(err.disposalErrors[0].error)).toContain('rollback dispose boom');
    expect(log).toEqual(['setup:broken', 'setup:failing', 'dispose:broken']);
  });

  test('aggregates disposal failures across plugins and still disposes every plugin', async () => {
    const log: string[] = [];
    const broken = makePlugin({
      id: 'broken',
      scope: 'process',
      setup: () => ({
        dispose: () => {
          log.push('dispose:broken');
          throw new Error('dispose boom');
        },
      }),
    });
    const healthy = makePlugin({
      id: 'healthy',
      scope: 'process',
      setup: () => ({
        dispose: () => {
          log.push('dispose:healthy');
        },
      }),
    });
    const scope = await createProcessScope([broken, healthy]);
    const err = await expectFailure(scope.dispose(), DisposalError, 'disposal failed with 1 error');
    expect(err.failures).toHaveLength(1);
    expect(err.failures[0].pluginId).toBe('broken');
    expect(log).toEqual(['dispose:healthy', 'dispose:broken']);
    expect(scope.snapshot().status).toBe('disposed');
  });
});

describe('scopes', () => {
  test('isolates services between two agent scopes under one process scope', async () => {
    const log: string[] = [];
    const processScope = await createProcessScope([
      valueProvider('process-provider', valueService, 'process', log),
    ]);
    const agentOne = await createAgentScope(processScope, [
      valueProvider('agent-one', agentService, 'one', log),
    ]);
    const agentTwo = await createAgentScope(processScope, []);
    expect(agentOne.require(agentService).label).toBe('one');
    expect(agentOne.require(valueService).label).toBe('process');
    expect(agentTwo.optional(agentService)).toBeUndefined();
    expect(agentTwo.require(valueService).label).toBe('process');
    expect(processScope.optional(agentService)).toBeUndefined();
    await agentOne.dispose();
    await agentTwo.dispose();
    await processScope.dispose();
  });

  test('isolates services between two run scopes under one agent scope', async () => {
    const log: string[] = [];
    const { processScope, agentScope } = await makeRunChain({
      processPlugins: [valueProvider('process-provider', valueService, 'process', log)],
      agentPlugins: [valueProvider('agent-provider', agentService, 'agent', log)],
    });
    const runOne = await createRunScope(agentScope, 'run-one', [
      valueProvider('run-one-provider', runService, 'one', log),
    ]);
    const runTwo = await createRunScope(agentScope, 'run-two', []);
    expect(runOne.require(runService).label).toBe('one');
    expect(runTwo.optional(runService)).toBeUndefined();
    expect(runTwo.require(agentService).label).toBe('agent');
    expect(runTwo.require(valueService).label).toBe('process');
    expect(agentScope.optional(runService)).toBeUndefined();
    await runOne.cancel('done').completion;
    await runTwo.cancel('done').completion;
    await agentScope.dispose();
    await processScope.dispose();
  });

  test('does not leak an agent-scoped override into a sibling agent scope', async () => {
    const log: string[] = [];
    const processScope = await createProcessScope([]);
    const baseOne = valueProvider('base-one', agentService, 'one', log);
    const overrideOne = makePlugin({
      id: 'override-one',
      scope: 'agent',
      provides: [agentService],
      overrides: [{ key: agentService, replacedProvider: 'base-one' }],
      setup: (context) => {
        context.provide(agentService, { label: 'one-overridden' });
      },
    });
    const agentOne = await createAgentScope(processScope, [baseOne, overrideOne]);
    const agentTwo = await createAgentScope(processScope, [
      valueProvider('base-two', agentService, 'two', log),
    ]);
    expect(agentOne.require(agentService).label).toBe('one-overridden');
    expect(agentTwo.require(agentService).label).toBe('two');
    expect(processScope.optional(agentService)).toBeUndefined();
    await agentOne.dispose();
    await agentTwo.dispose();
    await processScope.dispose();
  });

  test('rejects a child scope plugin that provides a process-scoped service', async () => {
    const processScope = await createProcessScope([]);
    const plugin = makePlugin({
      id: 'agent-provider',
      scope: 'agent',
      provides: [valueService],
      setup: () => {},
    });
    await expectFailure(
      createAgentScope(processScope, [plugin]),
      ScopeValidationError,
      "cannot provide service 'service.value' with scope 'process'",
    );
    await processScope.dispose();
  });

  test('rejects a child scope plugin that shadows a parent service by id', async () => {
    const log: string[] = [];
    const processScope = await createProcessScope([
      valueProvider('process-provider', valueService, 'process', log),
    ]);
    const agentShadowKey = serviceKey<TrackedService>('service.value', 'agent');
    const plugin = makePlugin({
      id: 'agent-shadow',
      scope: 'agent',
      provides: [agentShadowKey],
      setup: () => {},
    });
    await expectFailure(
      createAgentScope(processScope, [plugin]),
      ServiceCollisionError,
      "child scopes do not replace parent services",
    );
    await processScope.dispose();
  });

  test('rejects a plugin installed into the wrong scope kind', async () => {
    const plugin = makePlugin({
      id: 'agent-plugin',
      scope: 'agent',
      setup: () => {},
    });
    await expectFailure(
      createProcessScope([plugin]),
      ScopeValidationError,
      "declared for the 'agent' scope but is being installed into a 'process' scope",
    );
  });

  test('rejects duplicate plugin ids within one composition', async () => {
    const plugin = makePlugin({ id: 'same-id', scope: 'process', setup: () => {} });
    await expectFailure(
      createProcessScope([plugin, plugin]),
      DuplicatePluginError,
      "duplicate plugin id 'same-id'",
    );
  });
});

describe('conflicting service key scopes', () => {
  test('rejects a dependency whose ServiceKey scope does not match the provider in the same composition', async () => {
    const xAgent = serviceKey<TrackedService>('svc.conflict', 'agent');
    const xProcess = serviceKey<TrackedService>('svc.conflict', 'process');
    const log: string[] = [];
    const provider = makePlugin({
      id: 'provider',
      scope: 'agent',
      provides: [xAgent],
      setup: (context) => {
        log.push('setup:provider');
        context.provide(xAgent, { label: 'x' });
      },
    });
    const dependent = makePlugin({
      id: 'dependent',
      scope: 'agent',
      requires: [xProcess],
      setup: () => {
        log.push('setup:dependent');
      },
    });
    const processScope = await createProcessScope([]);
    await expectFailure(
      createAgentScope(processScope, [provider, dependent]),
      ScopeValidationError,
      "conflicting ServiceKey scopes cannot satisfy the dependency",
    );
    expect(log).toEqual([]);
    await processScope.dispose();
  });

  test('rejects a dependency whose ServiceKey scope does not match a parent provider', async () => {
    const xProcess = serviceKey<TrackedService>('svc.parent-conflict', 'process');
    const xAgent = serviceKey<TrackedService>('svc.parent-conflict', 'agent');
    const log: string[] = [];
    const processScope = await createProcessScope([
      makePlugin({
        id: 'parent-provider',
        scope: 'process',
        provides: [xProcess],
        setup: (context) => {
          log.push('setup:parent-provider');
          context.provide(xProcess, { label: 'parent' });
        },
      }),
    ]);
    const dependent = makePlugin({
      id: 'agent-dependent',
      scope: 'agent',
      requires: [xAgent],
      setup: () => {
        log.push('setup:agent-dependent');
      },
    });
    await expectFailure(
      createAgentScope(processScope, [dependent]),
      ScopeValidationError,
      "conflicting ServiceKey scopes cannot satisfy the dependency",
    );
    expect(log).toEqual(['setup:parent-provider']);
    await processScope.dispose();
  });

  test('rejects optional dependencies with mismatched scopes instead of resolving undefined', async () => {
    const xAgent = serviceKey<TrackedService>('svc.optional-conflict', 'agent');
    const xProcess = serviceKey<TrackedService>('svc.optional-conflict', 'process');
    const provider = makePlugin({
      id: 'provider',
      scope: 'agent',
      provides: [xAgent],
      setup: (context) => {
        context.provide(xAgent, { label: 'x' });
      },
    });
    const dependent = makePlugin({
      id: 'dependent',
      scope: 'agent',
      optional: [xProcess],
      setup: () => {},
    });
    const processScope = await createProcessScope([]);
    await expectFailure(
      createAgentScope(processScope, [provider, dependent]),
      ScopeValidationError,
      'conflicting ServiceKey scopes',
    );
    await processScope.dispose();
  });

  test('refuses to resolve a service through a ServiceKey with a different scope', async () => {
    const scope = await createProcessScope([
      valueProvider('provider', valueService, 'value', []),
    ]);
    const agentScopedView = serviceKey<TrackedService>('service.value', 'agent');
    expect(() => scope.require(agentScopedView)).toThrow(ScopeValidationError);
    expect(() => scope.optional(agentScopedView)).toThrow(ScopeValidationError);
    expect(scope.require(valueService).label).toBe('value');
    await scope.dispose();
  });
});

describe('malformed metadata', () => {
  test('rejects a non-array plugin list with a typed error', async () => {
    await expectFailure(
      createProcessScope('not-an-array' as unknown as CapekPlugin<unknown>[]),
      MalformedPluginError,
      'plugins must be an array',
    );
  });

  test('rejects non-object plugin entries', async () => {
    await expectFailure(
      createProcessScope([null as unknown as CapekPlugin<unknown>]),
      MalformedPluginError,
      'plugin entries must be objects',
    );
  });

  test('rejects non-array provides, requires, and optional metadata before setup', async () => {
    const log: string[] = [];
    for (const field of ['provides', 'requires', 'optional'] as const) {
      const plugin = makePlugin({ id: `bad-${field}`, scope: 'process', setup: () => { log.push(`setup:bad-${field}`); } });
      (plugin as unknown as Record<string, unknown>)[field] = 'service.value';
      await expectFailure(
        createProcessScope([plugin]),
        MalformedPluginError,
        `plugin 'bad-${field}' ${field} must be an array of service keys`,
      );
    }
    expect(log).toEqual([]);
  });

  test('rejects service keys with invalid shapes and scopes before setup', async () => {
    const badIdPlugin = makePlugin({
      id: 'bad-id',
      scope: 'process',
      provides: [{ id: '', scope: 'process' } as ServiceKey<unknown>],
      setup: () => {},
    });
    await expectFailure(
      createProcessScope([badIdPlugin]),
      MalformedPluginError,
      'a service key with a non-string or empty id',
    );

    const badScopePlugin = makePlugin({
      id: 'bad-scope',
      scope: 'process',
      provides: [{ id: 'svc.bad', scope: 'bogus' } as unknown as ServiceKey<unknown>],
      setup: () => {},
    });
    await expectFailure(
      createProcessScope([badScopePlugin]),
      MalformedPluginError,
      "invalid scope 'bogus'",
    );
  });

  test('rejects malformed override entries before setup', async () => {
    const log: string[] = [];
    const base = valueProvider('base', valueService, 'base', log);
    const badOverride = makePlugin({
      id: 'bad-override',
      scope: 'process',
      provides: [valueService],
      overrides: [{ key: valueService, replacedProvider: '' } as ServiceOverride],
      setup: () => {},
    });
    await expectFailure(
      createProcessScope([base, badOverride]),
      MalformedPluginError,
      "plugin 'bad-override' override for service 'service.value' must name a non-empty replacedProvider",
    );
    expect(log).toEqual([]);

    const nonObjectOverride = makePlugin({
      id: 'non-object-override',
      scope: 'process',
      provides: [valueService],
      overrides: ['base'] as unknown as ServiceOverride[],
      setup: () => {},
    });
    await expectFailure(
      createProcessScope([base, nonObjectOverride]),
      MalformedPluginError,
      "plugin 'non-object-override' overrides contains a non-object entry",
    );
    expect(log).toEqual([]);
  });

  test('rejects a context section with an unknown phase', async () => {
    const plugin = makePlugin({
      id: 'bad-phase',
      scope: 'process',
      setup: (context) => {
        context.contributeContext({
          id: 'section',
          phase: 'bogus' as ContextPhase,
          order: 1,
          provide: () => 'content',
        });
      },
    });
    const err = await expectFailure(createProcessScope([plugin]), ActivationError, 'setup failed');
    expect(err.cause).toBeInstanceOf(MalformedPluginError);
    expect(String(err.cause)).toContain("unknown phase 'bogus'");
  });

  test('rejects a tool contribution without a definition name', async () => {
    const plugin = makePlugin({
      id: 'bad-tool',
      scope: 'process',
      setup: (context) => {
        context.contributeTool({
          id: 'tool',
          order: 1,
          definition: { name: '' },
        });
      },
    });
    const err = await expectFailure(createProcessScope([plugin]), ActivationError, 'setup failed');
    expect(err.cause).toBeInstanceOf(MalformedPluginError);
    expect(String(err.cause)).toContain('definition name must be a non-empty string');
  });

  test('rejects a listener with unknown event types', async () => {
    const plugin = makePlugin({
      id: 'bad-listener',
      scope: 'process',
      setup: (context) => {
        context.contributeListener({
          id: 'listener',
          eventTypes: ['run:bogus'] as unknown as KernelEventType[],
          handle: () => {},
        });
      },
    });
    const err = await expectFailure(createProcessScope([plugin]), ActivationError, 'setup failed');
    expect(err.cause).toBeInstanceOf(MalformedPluginError);
    expect(String(err.cause)).toContain("unknown event type 'run:bogus'");
  });

  test('rejects a listener whose eventTypes is not an array', async () => {
    for (const badEventTypes of [undefined, 42, 'run:started']) {
      const plugin = makePlugin({
        id: 'bad-event-types',
        scope: 'process',
        setup: (context) => {
          context.contributeListener({
            id: 'listener',
            eventTypes: badEventTypes as unknown as KernelEventType[],
            handle: () => {},
          });
        },
      });
      const err = await expectFailure(createProcessScope([plugin]), ActivationError, 'setup failed');
      expect(err.cause).toBeInstanceOf(MalformedPluginError);
      expect(String(err.cause)).toContain("listener 'listener' eventTypes must be an array");
    }
  });
});

describe('declared provider enforcement', () => {
  test('fails setup when a plugin provides and then immediately disposes its declared service', async () => {
    const plugin = makePlugin({
      id: 'self-disposing',
      scope: 'process',
      provides: [valueService],
      setup: (context) => {
        const registration = context.provide(valueService, { label: 'gone' });
        registration.dispose();
      },
    });
    const err = await expectFailure(createProcessScope([plugin]), ActivationError, 'setup failed');
    expect(String(err.cause)).toContain(
      "declared service 'service.value' but did not provide it during setup",
    );
  });

  test('rejects a double provide of the same service by one plugin with a clear typed error', async () => {
    const plugin = makePlugin({
      id: 'double-provider',
      scope: 'process',
      provides: [valueService],
      setup: (context) => {
        context.provide(valueService, { label: 'first' });
        context.provide(valueService, { label: 'second' });
      },
    });
    const err = await expectFailure(createProcessScope([plugin]), ActivationError, 'setup failed');
    expect(err.cause).toBeInstanceOf(MalformedPluginError);
    expect(String(err.cause)).toContain(
      "provided service 'service.value' more than once during setup",
    );
  });
});

describe('diagnostics', () => {
  test('reports effective providers including inherited services', async () => {
    const log: string[] = [];
    const processScope = await createProcessScope([
      valueProvider('base', valueService, 'base', log),
      makePlugin({
        id: 'overrider',
        scope: 'process',
        provides: [valueService],
        overrides: [{ key: valueService, replacedProvider: 'base' }],
        setup: (context) => {
          context.provide(valueService, { label: 'overridden' });
        },
      }),
      valueProvider('other', otherService, 'other', log),
    ]);
    const agentScope = await createAgentScope(processScope, [
      valueProvider('agent-provider', agentService, 'agent', log),
    ]);
    const runScope = await createRunScope(agentScope, 'diag-run', [
      valueProvider('run-provider', runService, 'run', log),
    ]);
    const services = runScope.snapshot().services;
    const byId = new Map(services.map((entry) => [entry.keyId, entry]));
    expect(byId.get('service.value')?.providerPluginId).toBe('overrider');
    expect(byId.get('service.value')?.providerScope).toBe('process');
    expect(byId.get('service.other')?.providerScope).toBe('process');
    expect(byId.get('service.agent')?.providerScope).toBe('agent');
    expect(byId.get('service.run')?.providerScope).toBe('run');
    await runScope.cancel('done').completion;
    await agentScope.dispose();
    await processScope.dispose();
  });

  test('reports plugin activation status observed during setup', async () => {
    const log: string[] = [];
    const seen: unknown[] = [];
    const first = valueProvider('first', valueService, 'first', log);
    const second = makePlugin({
      id: 'second',
      scope: 'process',
      setup: (context) => {
        const snapshot = context.diagnostics.snapshot();
        seen.push(snapshot.plugins.map((plugin) => [plugin.id, plugin.status]));
      },
    });
    await createProcessScope([first, second]);
    expect(seen).toEqual([
      [['first', 'active'], ['second', 'pending']],
    ]);
  });

  test('never exposes plugin options or service values', async () => {
    const secret = 'SUPER-SECRET-KEY-42';
    const secretService = serviceKey<{ token: string }>('service.secret', 'process');
    const plugin = makePlugin({
      id: 'secret-plugin',
      scope: 'process',
      provides: [secretService],
      setup: (context, options) => {
        expect((options as { apiKey: string }).apiKey).toBe(secret);
        context.provide(secretService, { token: secret });
      },
    });
    const scope = await createProcessScope(
      [plugin],
      { 'secret-plugin': { apiKey: secret } },
    );
    const serialized = JSON.stringify(scope.snapshot());
    expect(serialized).not.toContain(secret);
    expect(scope.require(secretService).token).toBe(secret);
    await scope.dispose();
  });
});


describe('run lifecycle and cancellation', () => {
  test('completes a run with terminal and disposed events in order', async () => {
    const events: string[] = [];
    const log: string[] = [];
    const { processScope, agentScope, runScope } = await makeRunChain({
      processPlugins: [
        makePlugin({
          id: 'telemetry',
          scope: 'process',
          setup: (context) => {
            context.contributeListener({
              id: 'telemetry-listener',
              eventTypes: ['run:started', 'run:terminal', 'run:disposed'],
              handle: (event) => {
                events.push(event.type);
              },
            });
          },
        }),
      ],
      runPlugins: [
        valueProvider('run-provider', runService, 'run', log),
      ],
    });
    await runScope.start();
    await runScope.markTerminal('completed');
    expect(events).toEqual(['run:started', 'run:terminal', 'run:disposed']);
    expect(runScope.runStatus).toBe('disposed');
    expect(runScope.snapshot().runOutcome).toBe('completed');
    expect(log).toEqual(['setup:run-provider', 'dispose:run-provider']);
    await agentScope.dispose();
    await processScope.dispose();
  });

  test('cancels a run with prompt acknowledgement, awaited cleanup, and ordered lifecycle events', async () => {
    const order: string[] = [];
    const gate = deferred<void>();
    const { processScope, agentScope, runScope } = await makeRunChain({
      runPlugins: [
        makePlugin({
          id: 'run-listener',
          scope: 'run',
          setup: (context) => {
            context.contributeListener({
              id: 'run-events',
              eventTypes: ['run:started', 'run:terminal', 'run:disposed'],
              handle: (event) => {
                order.push(event.type);
              },
            });
          },
        }),
        makePlugin({
          id: 'run-provider',
          scope: 'run',
          provides: [runService],
          setup: (context) => {
            context.provide(runService, { label: 'run' });
            return {
              dispose: () => {
                order.push('dispose:run-provider');
              },
            };
          },
        }),
      ],
    });

    await runScope.start();
    runScope.registerCleanupBarrier(async () => {
      await gate.promise;
      order.push('barrier:flushed');
    });

    const cancellation = runScope.cancel('user-stop');
    expect(cancellation.acknowledged).toBe(true);
    await Promise.resolve();
    await Promise.resolve();
    expect(order).toEqual(['run:started', 'run:terminal']);
    expect(order).not.toContain('barrier:flushed');
    expect(runScope.runStatus).toBe('terminal');

    gate.resolve();
    await cancellation.completion;
    expect(order).toEqual([
      'run:started',
      'run:terminal',
      'barrier:flushed',
      'dispose:run-provider',
      'run:disposed',
    ]);
    expect(runScope.runStatus).toBe('disposed');
    expect(runScope.snapshot().runOutcome).toBe('cancelled');
    await agentScope.dispose();
    await processScope.dispose();
  });

  test('acknowledges false when cancel arrives after terminal', async () => {
    const { processScope, agentScope, runScope } = await makeRunChain();
    await runScope.start();
    await runScope.markTerminal('completed');
    const late = runScope.cancel('late');
    expect(late.acknowledged).toBe(false);
    await late.completion;
    await agentScope.dispose();
    await processScope.dispose();
  });

  test('rejects a second start and disposal of a live run', async () => {
    const { processScope, agentScope, runScope } = await makeRunChain();
    await runScope.start();
    await expect(runScope.start()).rejects.toBeInstanceOf(LifecycleError);
    await expect(runScope.dispose()).rejects.toBeInstanceOf(LifecycleError);
    await runScope.cancel('cleanup').completion;
    await agentScope.dispose();
    await processScope.dispose();
  });

  test('surfaces listener failures after disposal still completes', async () => {
    const log: string[] = [];
    const { processScope, agentScope, runScope } = await makeRunChain({
      runPlugins: [
        makePlugin({
          id: 'run-listeners',
          scope: 'run',
          setup: (context) => {
            context.contributeListener({
              id: 'failing-listener',
              eventTypes: ['run:terminal'],
              handle: () => {
                throw new Error('listener boom');
              },
            });
            context.contributeListener({
              id: 'disposed-observer',
              eventTypes: ['run:disposed'],
              handle: () => {
                log.push('run:disposed');
              },
            });
          },
        }),
        valueProvider('run-provider', runService, 'run', log),
      ],
    });
    await runScope.start();
    const cancellation = runScope.cancel('stop');
    const err = await expectFailure(cancellation.completion, RunTerminalError, "run 'run-1' terminal cleanup had 1 error");
    expect(String(err.errors[0])).toContain("listener 'failing-listener'");
    expect(log).toEqual(['setup:run-provider', 'dispose:run-provider', 'run:disposed']);
    await agentScope.dispose();
    await processScope.dispose();
  });

  test('parent scope disposal cancels a running child run with a named reason', async () => {
    const events: string[] = [];
    const log: string[] = [];
    const processScope = await createProcessScope([
      makePlugin({
        id: 'telemetry',
        scope: 'process',
        setup: (context) => {
          context.contributeListener({
            id: 'telemetry-listener',
            eventTypes: ['run:terminal', 'run:disposed'],
            handle: (event) => {
              if (event.type === 'run:terminal') {
                events.push(`terminal:${event.outcome}:${event.reason ?? ''}`);
              } else {
                events.push(event.type);
              }
            },
          });
        },
      }),
    ]);
    const agentScope = await createAgentScope(processScope, [
      makePlugin({
        id: 'agent-plugin',
        scope: 'agent',
        setup: () => ({
          dispose: () => {
            log.push('dispose:agent-plugin');
          },
        }),
      }),
    ]);
    const runScope = await createRunScope(agentScope, 'child-run', [
      valueProvider('run-provider', runService, 'run', log),
    ]);
    await runScope.start();
    await agentScope.dispose();
    expect(events).toEqual(['terminal:cancelled:parent scope disposed', 'run:disposed']);
    expect(runScope.runStatus).toBe('disposed');
    expect(log).toEqual(['setup:run-provider', 'dispose:run-provider', 'dispose:agent-plugin']);
    await processScope.dispose();
  });

  test('dispatches listeners child scope first, then ancestors, in registration order', async () => {
    const order: string[] = [];
    const listener = (id: string) => ({
      id,
      eventTypes: ['run:disposed'] as const,
      handle: () => {
        order.push(id);
      },
    });
    const processScope = await createProcessScope([
      makePlugin({
        id: 'p1',
        scope: 'process',
        setup: (context) => {
          context.contributeListener(listener('process-listener'));
        },
      }),
    ]);
    const agentScope = await createAgentScope(processScope, [
      makePlugin({
        id: 'a1',
        scope: 'agent',
        setup: (context) => {
          context.contributeListener(listener('agent-listener'));
        },
      }),
    ]);
    const runScope = await createRunScope(agentScope, 'order-run', [
      makePlugin({
        id: 'r1',
        scope: 'run',
        setup: (context) => {
          context.contributeListener(listener('run-listener'));
        },
      }),
    ]);
    await runScope.start();
    await runScope.markTerminal('completed');
    expect(order).toEqual(['run-listener', 'agent-listener', 'process-listener']);
    await agentScope.dispose();
    await processScope.dispose();
  });
  test('marks a failed terminal outcome and dispatches it before disposal', async () => {
    const events: string[] = [];
    const { processScope, agentScope, runScope } = await makeRunChain({
      runPlugins: [
        makePlugin({
          id: 'observer',
          scope: 'run',
          setup: (context) => {
            context.contributeListener({
              id: 'outcome-observer',
              eventTypes: ['run:terminal'],
              handle: (event) => {
                if (event.type === 'run:terminal') {
                  events.push(`terminal:${event.outcome}`);
                }
              },
            });
          },
        }),
      ],
    });
    await runScope.start();
    await runScope.markTerminal('failed');
    expect(events).toEqual(['terminal:failed']);
    expect(runScope.runStatus).toBe('disposed');
    expect(runScope.snapshot().runOutcome).toBe('failed');
    await agentScope.dispose();
    await processScope.dispose();
  });

  test('cancels a created run before start without a started event', async () => {
    const order: string[] = [];
    const { processScope, agentScope, runScope } = await makeRunChain({
      runPlugins: [
        makePlugin({
          id: 'observer',
          scope: 'run',
          setup: (context) => {
            context.contributeListener({
              id: 'observer-listener',
              eventTypes: ['run:started', 'run:terminal', 'run:disposed'],
              handle: (event) => {
                order.push(event.type);
              },
            });
          },
        }),
      ],
    });
    const cancellation = runScope.cancel('before-start');
    expect(cancellation.acknowledged).toBe(true);
    await cancellation.completion;
    expect(order).toEqual(['run:terminal', 'run:disposed']);
    expect(runScope.runStatus).toBe('disposed');
    expect(runScope.snapshot().runOutcome).toBe('cancelled');
    await agentScope.dispose();
    await processScope.dispose();
  });

  test('completes disposal when a cleanup barrier rejects and reports it through the cancellation', async () => {
    const order: string[] = [];
    const { processScope, agentScope, runScope } = await makeRunChain({
      runPlugins: [
        makePlugin({
          id: 'observer',
          scope: 'run',
          setup: (context) => {
            context.contributeListener({
              id: 'disposed-observer',
              eventTypes: ['run:disposed'],
              handle: () => {
                order.push('run:disposed');
              },
            });
            return { dispose: () => { order.push('dispose:plugin'); } };
          },
        }),
      ],
    });
    await runScope.start();
    runScope.registerCleanupBarrier(async () => {
      order.push('barrier:begin');
      throw new Error('barrier boom');
    });
    const cancellation = runScope.cancel('stop');
    const err = await expectFailure(
      cancellation.completion,
      RunTerminalError,
      "run 'run-1' terminal cleanup had 1 error",
    );
    expect(String(err.errors[0])).toContain('barrier boom');
    expect(runScope.runStatus).toBe('disposed');
    expect(order).toEqual(['barrier:begin', 'dispose:plugin', 'run:disposed']);
    await agentScope.dispose();
    await processScope.dispose();
  });

  test('process scope disposal cascades into a live run before process plugins dispose', async () => {
    const order: string[] = [];
    const processScope = await createProcessScope([
      makePlugin({
        id: 'process-plugin',
        scope: 'process',
        setup: () => ({
          dispose: () => {
            order.push('dispose:process-plugin');
          },
        }),
      }),
    ]);
    const agentScope = await createAgentScope(processScope, [
      makePlugin({
        id: 'agent-plugin',
        scope: 'agent',
        setup: () => ({
          dispose: () => {
            order.push('dispose:agent-plugin');
          },
        }),
      }),
    ]);
    const runScope = await createRunScope(agentScope, 'live-run', [
      makePlugin({
        id: 'run-observer',
        scope: 'run',
        setup: (context) => {
          context.contributeListener({
            id: 'run-observer-listener',
            eventTypes: ['run:terminal', 'run:disposed'],
            handle: (event) => {
              if (event.type === 'run:terminal') {
                order.push(`terminal:${event.outcome}:${event.reason ?? ''}`);
              } else {
                order.push(event.type);
              }
            },
          });
          return { dispose: () => { order.push('dispose:run-plugin'); } };
        },
      }),
    ]);
    await runScope.start();
    await processScope.dispose();
    expect(runScope.runStatus).toBe('disposed');
    expect(order).toEqual([
      'terminal:cancelled:parent scope disposed',
      'dispose:run-plugin',
      'run:disposed',
      'dispose:agent-plugin',
      'dispose:process-plugin',
    ]);
  });

  test('serializes terminal dispatch and disposal after the started dispatch completes', async () => {
    const order: string[] = [];
    const startGate = deferred<void>();
    const { processScope, agentScope, runScope } = await makeRunChain({
      runPlugins: [
        makePlugin({
          id: 'run-listeners',
          scope: 'run',
          setup: (context) => {
            context.contributeListener({
              id: 'start-listener',
              eventTypes: ['run:started'],
              handle: async () => {
                order.push('start:begin');
                await startGate.promise;
                order.push('start:end');
              },
            });
            context.contributeListener({
              id: 'terminal-listener',
              eventTypes: ['run:terminal', 'run:disposed'],
              handle: (event) => {
                order.push(event.type);
              },
            });
            return { dispose: () => { order.push('dispose:run-plugin'); } };
          },
        }),
      ],
    });
    const startPromise = runScope.start();
    const cancellation = runScope.cancel('stop');
    expect(cancellation.acknowledged).toBe(true);
    await Promise.resolve();
    await Promise.resolve();
    expect(order).toEqual(['start:begin']);
    expect(runScope.runStatus).toBe('terminal');
    startGate.resolve();
    await startPromise;
    await cancellation.completion;
    expect(order).toEqual([
      'start:begin',
      'start:end',
      'run:terminal',
      'dispose:run-plugin',
      'run:disposed',
    ]);
    expect(runScope.runStatus).toBe('disposed');
    await agentScope.dispose();
    await processScope.dispose();
  });

  test('a synchronous cancel from a started listener still completes every started listener before terminal', async () => {
    const order: string[] = [];
    let acknowledged = false;
    let terminalCompletion: Promise<void> | undefined;
    const { processScope, agentScope, runScope } = await makeRunChain({
      runPlugins: [
        makePlugin({
          id: 'run-listeners',
          scope: 'run',
          setup: (context) => {
            context.contributeListener({
              id: 'first-started',
              eventTypes: ['run:started'],
              handle: () => {
                order.push('started:first');
                const cancellation = runScope.cancel('reentrant-stop');
                acknowledged = cancellation.acknowledged;
                terminalCompletion = cancellation.completion;
              },
            });
            context.contributeListener({
              id: 'second-started',
              eventTypes: ['run:started', 'run:terminal', 'run:disposed'],
              handle: (event) => {
                if (event.type === 'run:started') {
                  order.push('started:second');
                } else {
                  order.push(event.type);
                }
              },
            });
          },
        }),
      ],
    });
    await runScope.start();
    expect(acknowledged).toBe(true);
    await terminalCompletion;
    expect(order).toEqual([
      'started:first',
      'started:second',
      'run:terminal',
      'run:disposed',
    ]);
    expect(runScope.runStatus).toBe('disposed');
    await agentScope.dispose();
    await processScope.dispose();
  });
});

describe('exit gate: synthetic composition of current services', () => {
  const sessionStoreKey = serviceKey<{ label: string }>('session.store', 'process');
  const modelServiceKey = serviceKey<{ label: string }>('model.service', 'process');
  const providerRegistryKey = serviceKey<{ label: string }>('providers.registry', 'process');
  const fsCapabilityKey = serviceKey<{ label: string }>('capability.fs', 'agent');
  const shellCapabilityKey = serviceKey<{ label: string }>('capability.shell', 'agent');
  const questionCapabilityKey = serviceKey<{ label: string }>('capability.question', 'agent');
  const toolSourceKey = serviceKey<{ label: string }>('tool.source', 'agent');
  const contextAssemblerKey = serviceKey<{ label: string }>('context.assembler', 'agent');
  const workspaceServiceKey = serviceKey<{ label: string }>('workspace.service', 'agent');
  const driverKey = serviceKey<{ label: string }>('driver.service', 'agent');
  const runSessionKey = serviceKey<{ label: string }>('run.session', 'run');

  function processPlugins(log: string[]): CapekPlugin<unknown>[] {
    return [
      makePlugin({
        id: 'model',
        version: '1.0.0',
        scope: 'process',
        provides: [modelServiceKey],
        setup: (context) => {
          log.push('setup:model');
          context.provide(modelServiceKey, { label: 'model' });
          return { dispose: () => { log.push('dispose:model'); } };
        },
      }),
      makePlugin({
        id: 'providers',
        scope: 'process',
        provides: [providerRegistryKey],
        setup: (context) => {
          log.push('setup:providers');
          context.provide(providerRegistryKey, { label: 'providers' });
          return { dispose: () => { log.push('dispose:providers'); } };
        },
      }),
      makePlugin({
        id: 'session',
        scope: 'process',
        provides: [sessionStoreKey],
        setup: (context) => {
          log.push('setup:session');
          context.provide(sessionStoreKey, { label: 'session' });
          return { dispose: () => { log.push('dispose:session'); } };
        },
      }),
      makePlugin({
        id: 'telemetry',
        scope: 'process',
        setup: (context) => {
          context.contributeListener({
            id: 'telemetry-listener',
            eventTypes: ['run:started', 'run:terminal', 'run:disposed'],
            handle: (event) => {
              log.push(`event:${event.type}:${event.type === 'run:terminal' ? event.outcome : ''}`);
            },
          });
        },
      }),
    ];
  }

  function agentPlugins(log: string[]): CapekPlugin<unknown>[] {
    return [
      makePlugin({
        id: 'driver',
        scope: 'agent',
        provides: [driverKey],
        requires: [contextAssemblerKey, toolSourceKey],
        optional: [workspaceServiceKey],
        setup: (context) => {
          log.push('setup:driver');
          context.provide(driverKey, { label: 'driver' });
          return { dispose: () => { log.push('dispose:driver'); } };
        },
      }),
      makePlugin({
        id: 'tool-source',
        scope: 'agent',
        provides: [toolSourceKey],
        requires: [fsCapabilityKey, shellCapabilityKey],
        setup: (context) => {
          log.push('setup:tool-source');
          context.provide(toolSourceKey, { label: 'tool-source' });
          context.contributeTool({
            id: 'read-file',
            order: 10,
            definition: { name: 'read-file' },
            requiredCapabilities: [fsCapabilityKey],
          });
          context.contributeTool({
            id: 'write-file',
            order: 20,
            definition: { name: 'write-file' },
            requiredCapabilities: [fsCapabilityKey],
          });
          context.contributeTool({
            id: 'shell',
            order: 30,
            definition: { name: 'shell' },
            requiredCapabilities: [shellCapabilityKey],
          });
          context.contributeTool({
            id: 'ask-user',
            order: 40,
            definition: { name: 'ask-user' },
            requiredCapabilities: [questionCapabilityKey],
          });
          context.contributeContext({
            id: 'capabilities',
            phase: 'capabilities',
            order: 400,
            provide: () => 'capability guidance',
          });
          return { dispose: () => { log.push('dispose:tool-source'); } };
        },
      }),
      makePlugin({
        id: 'workspace',
        scope: 'agent',
        provides: [workspaceServiceKey],
        setup: (context) => {
          log.push('setup:workspace');
          context.provide(workspaceServiceKey, { label: 'workspace' });
          context.contributeContext({
            id: 'workspace',
            phase: 'workspace',
            order: 300,
            provide: () => 'workspace context',
          });
          return { dispose: () => { log.push('dispose:workspace'); } };
        },
      }),
      makePlugin({
        id: 'shell-capability',
        scope: 'agent',
        provides: [shellCapabilityKey],
        setup: (context) => {
          log.push('setup:shell-capability');
          context.provide(shellCapabilityKey, { label: 'shell-capability' });
          return { dispose: () => { log.push('dispose:shell-capability'); } };
        },
      }),
      makePlugin({
        id: 'fs-capability',
        scope: 'agent',
        provides: [fsCapabilityKey],
        setup: (context) => {
          log.push('setup:fs-capability');
          context.provide(fsCapabilityKey, { label: 'fs-capability' });
          return { dispose: () => { log.push('dispose:fs-capability'); } };
        },
      }),
      makePlugin({
        id: 'context-assembler',
        scope: 'agent',
        provides: [contextAssemblerKey],
        requires: [sessionStoreKey],
        setup: (context) => {
          log.push('setup:context-assembler');
          context.provide(contextAssemblerKey, { label: 'context-assembler' });
          context.contributeContext({
            id: 'identity',
            phase: 'identity',
            order: 100,
            provide: () => 'identity section',
          });
          context.contributeContext({
            id: 'instructions',
            phase: 'instructions',
            order: 200,
            provide: () => 'instructions section',
          });
          return { dispose: () => { log.push('dispose:context-assembler'); } };
        },
      }),
    ];
  }

  test('composes process, agent, and run services deterministically through the full hierarchy', async () => {
    const log: string[] = [];
    const processScope = await createProcessScope(processPlugins(log));
    const agentScope = await createAgentScope(processScope, agentPlugins(log));
    const runScope = await createRunScope(agentScope, 'exit-gate-run', [
      makePlugin({
        id: 'run-session',
        scope: 'run',
        provides: [runSessionKey],
        requires: [workspaceServiceKey],
        setup: (context) => {
          log.push('setup:run-session');
          context.provide(runSessionKey, { label: 'run-session' });
          context.contributeContext({
            id: 'task',
            phase: 'task',
            order: 500,
            provide: () => 'task section',
          });
          return { dispose: () => { log.push('dispose:run-session'); } };
        },
      }),
    ]);

    // Deterministic activation order: dependencies first, plugin id tie-breaks.
    expect(log).toEqual([
      'setup:model',
      'setup:providers',
      'setup:session',
      'setup:context-assembler',
      'setup:fs-capability',
      'setup:shell-capability',
      'setup:tool-source',
      'setup:workspace',
      'setup:driver',
      'setup:run-session',
    ]);

    // Cross-scope service resolution.
    expect(agentScope.require(sessionStoreKey).label).toBe('session');
    expect(runScope.require(modelServiceKey).label).toBe('model');
    expect(runScope.require(workspaceServiceKey).label).toBe('workspace');
    expect(runScope.require(runSessionKey).label).toBe('run-session');
    expect(runScope.require(driverKey).label).toBe('driver');

    // Tool inventory with capability-derived visibility.
    const tools = runScope.listTools();
    expect(tools.map((tool) => tool.id)).toEqual([
      'read-file',
      'write-file',
      'shell',
      'ask-user',
    ]);
    expect(tools.filter((tool) => tool.visible).map((tool) => tool.id)).toEqual([
      'read-file',
      'write-file',
      'shell',
    ]);
    const askUser = tools.find((tool) => tool.id === 'ask-user');
    expect(askUser?.hiddenReasons).toEqual(["missing required capability 'capability.question'"]);

    // Context sections in stable phase order across scopes.
    const built = await runScope.buildContext();
    expect(built.map((section) => [section.id, section.phase])).toEqual([
      ['identity', 'identity'],
      ['instructions', 'instructions'],
      ['workspace', 'workspace'],
      ['capabilities', 'capabilities'],
      ['task', 'task'],
    ]);

    // Read-only diagnostics with effective providers and no secrets.
    const snapshot = runScope.snapshot();
    const providerByKey = new Map(snapshot.services.map((entry) => [entry.keyId, entry.providerPluginId]));
    expect(providerByKey.get('session.store')).toBe('session');
    expect(providerByKey.get('tool.source')).toBe('tool-source');
    expect(providerByKey.get('run.session')).toBe('run-session');
    expect(snapshot.plugins.map((plugin) => plugin.status)).toEqual(
      snapshot.plugins.map(() => 'active'),
    );
    expect(snapshot.listeners.map((entry) => entry.id)).toEqual(['telemetry-listener']);

    // Run lifecycle through the inherited process listener.
    await runScope.start();
    const cancellation = runScope.cancel('exit-gate-stop');
    expect(cancellation.acknowledged).toBe(true);
    await cancellation.completion;
    expect(log).toContain('event:run:started:');
    expect(log).toContain('event:run:terminal:cancelled');
    expect(log).toContain('event:run:disposed:');

    // Reverse disposal: run, then agent plugins in reverse activation order,
    // then process plugins in reverse activation order.
    await agentScope.dispose();
    await processScope.dispose();
    const disposalLog = log.filter((entry) => entry.startsWith('dispose:'));
    expect(disposalLog).toEqual([
      'dispose:run-session',
      'dispose:driver',
      'dispose:workspace',
      'dispose:tool-source',
      'dispose:shell-capability',
      'dispose:fs-capability',
      'dispose:context-assembler',
      'dispose:session',
      'dispose:providers',
      'dispose:model',
    ]);
  });

  test('activation order is independent of plugin array order', async () => {
    const logA: string[] = [];
    const logB: string[] = [];
    const pluginsA = agentPlugins(logA);
    const pluginsB = agentPlugins(logB).reverse();
    const processScope = await createProcessScope(processPlugins([]));
    const agentA = await createAgentScope(processScope, pluginsA);
    const agentB = await createAgentScope(processScope, pluginsB);
    const setupsA = logA.filter((entry) => entry.startsWith('setup:'));
    const setupsB = logB.filter((entry) => entry.startsWith('setup:'));
    expect(setupsB).toEqual(setupsA);
    expect(setupsA).toEqual([
      'setup:context-assembler',
      'setup:fs-capability',
      'setup:shell-capability',
      'setup:tool-source',
      'setup:workspace',
      'setup:driver',
    ]);
    await agentA.dispose();
    await agentB.dispose();
    await processScope.dispose();
  });
});

describe('child unregistration on disposal', () => {
  test('disposing one child removes only that child and keeps active siblings', async () => {
    const log: string[] = [];
    const processScope = await createProcessScope([
      valueProvider('process.p', valueService, 'p', log),
    ]);
    const agentA = await createAgentScope(processScope, [
      valueProvider('agent.a', agentService, 'a', log),
    ]);
    const agentB = await createAgentScope(processScope, [
      valueProvider('agent.b', agentService, 'b', log),
    ]);

    expect(processScope.childCount).toBe(2);
    await agentA.dispose();
    expect(processScope.childCount).toBe(1);

    // The surviving sibling remains functional and is the only child left.
    expect(agentB.require(agentService).label).toBe('b');
    await agentB.dispose();
    expect(processScope.childCount).toBe(0);
    await processScope.dispose();

    expect(log.filter((entry) => entry.startsWith('dispose:'))).toEqual([
      'dispose:agent.a',
      'dispose:agent.b',
      'dispose:process.p',
    ]);
  });

  test('parent disposal disposes only remaining children in reverse creation order', async () => {
    const log: string[] = [];
    const processScope = await createProcessScope([
      valueProvider('process.p', valueService, 'p', log),
    ]);
    const agentA = await createAgentScope(processScope, [
      valueProvider('agent.a', agentService, 'a', log),
    ]);
    const agentB = await createAgentScope(processScope, [
      valueProvider('agent.b', agentService, 'b', log),
    ]);

    await agentA.dispose();
    await processScope.dispose();

    expect(processScope.childCount).toBe(0);
    expect(agentB.snapshot().status).toBe('disposed');
    expect(log.filter((entry) => entry.startsWith('dispose:'))).toEqual([
      'dispose:agent.a',
      'dispose:agent.b',
      'dispose:process.p',
    ]);
  });

  test('concurrent child and parent disposal settles safely with exactly one disposal each', async () => {
    const log: string[] = [];
    const processScope = await createProcessScope([
      valueProvider('process.p', valueService, 'p', log),
    ]);
    const agentScope = await createAgentScope(processScope, [
      valueProvider('agent.c', agentService, 'c', log),
    ]);

    const results = await Promise.allSettled([
      processScope.dispose(),
      agentScope.dispose(),
      agentScope.dispose(),
    ]);

    expect(results.map((result) => result.status)).toEqual(['fulfilled', 'fulfilled', 'fulfilled']);
    expect(processScope.childCount).toBe(0);
    expect(agentScope.snapshot().status).toBe('disposed');
    expect(log.filter((entry) => entry === 'dispose:agent.c')).toHaveLength(1);
    expect(log.filter((entry) => entry === 'dispose:process.p')).toHaveLength(1);
  });
});
