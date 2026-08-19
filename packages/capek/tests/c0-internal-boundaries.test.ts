import { describe, expect, test } from 'bun:test';
import { existsSync } from 'node:fs';
import { dirname, relative, resolve } from 'node:path';
import {
  evaluateRules,
  isWithin,
  parseImports,
  resolveLocalSpecifier,
  scanDirectory,
  type DependencyRule,
  type ScannedFile,
} from './helpers/import-scan';

const repositoryRoot = resolve(import.meta.dir, '../../..');
const packageSourceRoot = resolve(repositoryRoot, 'packages/capek/src');
const capekaiPackagePrefix = '@capekai/';

function dir(name: string): string {
  return resolve(packageSourceRoot, name);
}

const leafConcerns = [
  'storage',
  'configuration',
  'context',
  'memory',
  'skills',
  'session-search',
  'scheduler',
];

const kernelSourceRoot = dir('kernel');

/**
 * Strict kernel self-containment check: every import must be a local
 * relative specifier (starting with '.') that resolves inside the kernel
 * directory. Bare imports, package roots, @/ aliases, require calls, and
 * dynamic imports that do not resolve within the kernel are all violations.
 * The shared rule engine cannot express a catch-all bare-import rejection,
 * so this check is evaluated locally in this test file.
 */
function kernelStrictViolations(files: ScannedFile[]): string[] {
  const violations: string[] = [];
  for (const file of files) {
    for (const imp of parseImports(file.sourceText, file.path)) {
      if (!imp.specifier.startsWith('.')) {
        violations.push(
          `${relative(repositoryRoot, file.path)} imports ${imp.specifier} (${imp.kind}) [rule: kernel-strict-self-containment]`,
        );
        continue;
      }
      const resolved = resolve(dirname(file.path), imp.specifier);
      if (!isWithin(resolved, kernelSourceRoot)) {
        violations.push(
          `${relative(repositoryRoot, file.path)} imports ${imp.specifier} (${imp.kind}) resolves outside kernel [rule: kernel-strict-self-containment]`,
        );
      }
    }
  }
  return violations;
}

const c0Rules: DependencyRule[] = [
  {
    name: 'leaf-concern-self-containment',
    rationale: 'Leaf concerns must not import outside their own directory while they have no declared contracts.',
    appliesTo: leafConcerns.map(dir),
    allowedResolvedDirs: 'own-concern',
    exceptions: {
      'packages/capek/src/skills/registry.ts': ['../runtime/host-layout'],
    },
  },
  {
    name: 'tools-no-core',
    rationale: 'Tools are capability providers and must not import the runtime core outside the named contract edges.',
    appliesTo: [dir('tools')],
    forbiddenResolvedDirs: [dir('core')],
    exceptions: {
      'packages/capek/src/tools/llm-api.ts': ['../core/model-utils'],
    },
  },
  {
    name: 'runtime-no-core-or-tools',
    rationale: 'The runtime host must not import turn-execution internals or concrete tool implementations.',
    appliesTo: [dir('runtime')],
    forbiddenResolvedDirs: [dir('core'), dir('tools')],
    exceptions: {
      'packages/capek/src/runtime/events.ts': ['../core/step-handlers'],
    },
  },
  {
    name: 'core-no-optional-domains',
    rationale: 'Optional domains are plugins; core must not import memory, skills, session-search, scheduler, or goals implementations. The goals accessor seam (`../goals/service`) is the one allowed edge, mirroring the C6 policy accessors: chat-handler resolves the scoped goal domain service through it and never touches the implementation.',
    appliesTo: [dir('core')],
    forbiddenResolvedDirs: [dir('memory'), dir('skills'), dir('session-search'), dir('scheduler'), dir('goals')],
    exceptions: {
      'packages/capek/src/core/chat-handler.ts': ['../goals/service'],
    },
  },
  {
    name: 'plugins-no-session-search-ownership',
    rationale: 'C5 moved session-search tool and guidance ownership to the session-search domain plugin. Plugin modules must not import the guidance constant or the tool implementation from the session-search domain; the host seam stays process-scoped and is unaffected. Two narrow exceptions remain: the fixed legacy system-message adapter keeps the guidance constant import for byte-identical compat output, and the session-search domain plugin module owns the tool wiring.',
    appliesTo: [dir('plugins')],
    forbiddenSpecifiers: [
      { prefix: '../session-search', name: 'SESSION_SEARCH_GUIDANCE' },
      { prefix: '../session-search', name: 'sessionSearchToolDefinition' },
      { prefix: '../session-search', name: 'executeSessionSearchTool' },
    ],
    exceptions: {
      'packages/capek/src/plugins/session-search-domain.ts': [
        '../session-search/session-search-tool',
      ],
    },
  },
  {
    name: 'plugins-no-scheduler-ownership',
    rationale: 'C5 moved scheduler tool ownership to the scheduler domain plugin. Plugin modules must not import the tool implementation from the scheduler domain; the host seam stays process-scoped and is unaffected. The scheduler domain plugin module owns the tool wiring.',
    appliesTo: [dir('plugins')],
    forbiddenSpecifiers: [
      { prefix: '../scheduler', name: 'schedulerToolDefinition' },
      { prefix: '../scheduler', name: 'executeSchedulerTool' },
      { prefix: '../scheduler', name: 'executeSchedulerToolWithHost' },
    ],
    exceptions: {
      'packages/capek/src/plugins/scheduler-domain.ts': [
        '../scheduler/scheduler-tool',
      ],
    },
  },
  {
    name: 'plugins-no-subagent-ownership',
    rationale: 'C5 moved the task tool, ancestry policy, child-session execution, and self-delegation guidance ownership to the subagent domain plugin. Plugin modules must not import the task tool implementation or the guidance constant from the subagent domain. Two narrow exceptions remain: the fixed legacy system-message adapter keeps the guidance constant import for byte-identical compat output, and the subagent domain plugin module owns the tool wiring.',
    appliesTo: [dir('plugins')],
    forbiddenSpecifiers: [
      { prefix: '../subagent', name: 'getSubagentToolDefinition' },
      { prefix: '../subagent', name: 'executeSubagent' },
      { prefix: '../subagent', name: 'executeSubagentWithDeps' },
      { prefix: '../subagent', name: 'selfDelegationGuidance' },
    ],
    exceptions: {
      'packages/capek/src/plugins/legacy-system-message.ts': ['../subagent/guidance'],
      'packages/capek/src/plugins/subagent-domain.ts': [
        '../subagent/child-session',
        '../subagent/guidance',
        '../subagent/policy',
        '../subagent/task-tool',
      ],
    },
  },
  {
    name: 'subagent-domain-no-core',
    rationale: 'The subagent domain owns the task tool and child-session execution. Its only core edge is the model/provider resolution helper (task-tool), which stays in core until C7. C6 moved the retry stream ownership to the retry domain, so child-session consumes `retry/stream-chat.ts` and no longer imports core for its turn execution. Any other core import is a violation.',
    appliesTo: [dir('subagent')],
    forbiddenResolvedDirs: [dir('core')],
    exceptions: {
      'packages/capek/src/subagent/task-tool.ts': ['../core/provider-utils'],
    },
  },
  {
    name: 'retry-domain-no-core',
    rationale: 'C6 moved retry policy ownership (classification, backoff, circuit state, and the side-effect barrier) plus the retry stream loop to the retry domain. Its only core edges are the session interrupt manager (backoff cancellation), the wrapped turn stream, and their type-only imports in stream-chat.ts, which stay in core until C6/C7. Any other core import is a violation.',
    appliesTo: [dir('retry')],
    forbiddenResolvedDirs: [dir('core')],
    exceptions: {
      'packages/capek/src/retry/stream-chat.ts': [
        '../core/agent',
        '../core/interrupt',
        '../core/step-handlers',
      ],
    },
  },
  {
    name: 'compaction-domain-no-core',
    rationale: 'C6 step 2 moved compaction policy ownership (policy resolution, threshold formula, trigger, summary strategy, pruning, failure cooldown, replay, recovery, and the concurrency guard) to the compaction domain. Its only core edges are the model construction and provider discovery helpers used by the summary task, which stay in core until C7. Any other core import is a violation.',
    appliesTo: [dir('compaction')],
    forbiddenResolvedDirs: [dir('core')],
    exceptions: {
      'packages/capek/src/compaction/task.ts': [
        '../core/model-utils',
        '../core/provider-utils',
      ],
    },
  },
  {
    name: 'permission-domain-no-core',
    rationale: 'C6 step 3 moved permission decision, grants, timeout, and interaction policy ownership to the permission domain. The domain depends on the runtime host contract and SDK types only; any core import is a violation.',
    appliesTo: [dir('permission')],
    forbiddenResolvedDirs: [dir('core')],
  },
  {
    name: 'workspace-domain-no-core',
    rationale: 'C6 step 4 moved workspace containment and path classification policy ownership to the workspace domain. The domain depends on SDK constants, node path/os, and the host contract only; any core import is a violation.',
    appliesTo: [dir('workspace')],
    forbiddenResolvedDirs: [dir('core')],
  },
  {
    name: 'tool-output-domain-no-core',
    rationale: 'C6 step 5 moved tool-output bounding, envelope, retrieval, wrap, and truncation policy ownership to the tool-output domain. The domain depends on the AI SDK, the SDK tool types, and the storage accessors only; any core import is a violation.',
    appliesTo: [dir('tool-output')],
    forbiddenResolvedDirs: [dir('core')],
  },
  {
    name: 'workflow-domain-no-core',
    rationale: 'The workflow domain owns decomposition, leaf fan-out, synthesis, and the shared orchestrator model-turn implementation. Its only core edges are the model construction and structured-output helpers used by the orchestrator session, which stay in core until C7. Any other core import is a violation.',
    appliesTo: [dir('workflow')],
    forbiddenResolvedDirs: [dir('core')],
    exceptions: {
      'packages/capek/src/workflow/orchestrator-session.ts': [
        '../core/model-utils',
        '../core/structured-output',
      ],
    },
  },
  {
    name: 'goals-domain-no-core',
    rationale: 'The goal domain owns evaluation and the persistent goal loop; it must not import the runtime core.',
    appliesTo: [dir('goals')],
    forbiddenResolvedDirs: [dir('core')],
  },
  {
    name: 'plugins-no-goal-ownership',
    rationale: 'C5 moved the goal evaluator and goal loop implementation ownership to the goal domain plugin. Plugin modules must not import the goal domain implementation except the goal domain plugin itself.',
    appliesTo: [dir('plugins')],
    forbiddenSpecifiers: [
      { prefix: '../goals', name: 'evaluateGoal' },
      { prefix: '../goals', name: 'evaluateGoalWithDeps' },
      { prefix: '../goals', name: 'runGoalLoop' },
      { prefix: '../goals', name: 'runGoalLoopWithDeps' },
      { prefix: '../goals', name: 'buildContinuationMessage' },
    ],
    exceptions: {
      'packages/capek/src/plugins/goal-domain.ts': ['../goals'],
    },
  },
  {
    name: 'plugins-no-memory-ownership',
    rationale: 'C5 moved the memory tool payloads and memory context sections ownership to the memory domain plugin. Plugin modules must not import the memory implementation except the memory domain plugin itself and the fixed legacy adapters that reproduce the pre-C5 builder byte-for-byte.',
    appliesTo: [dir('plugins')],
    forbiddenSpecifiers: [
      { prefix: '../memory', name: 'executeMemoryTool' },
      { prefix: '../memory', name: 'memoryToolDefinition' },
      { prefix: '../memory', name: 'MEMORY_GUIDANCE' },
      { prefix: '../memory', name: 'loadMemoryInstructions' },
    ],
    exceptions: {
      'packages/capek/src/plugins/memory-domain.ts': ['../memory'],
      'packages/capek/src/plugins/legacy-system-message.ts': ['../memory'],
      'packages/capek/src/plugins/context-sections.ts': ['../memory'],
    },
  },
  {
    name: 'plugins-no-skills-ownership',
    rationale: 'C5 moved the skill tool payloads and the skill-management guidance ownership to the skills domain plugin. Plugin modules must not import the skills implementation except the skills domain plugin itself and the fixed legacy adapters that reproduce the pre-C5 builder byte-for-byte.',
    appliesTo: [dir('plugins')],
    forbiddenSpecifiers: [
      { prefix: '../skills', name: 'executeSkillTool' },
      { prefix: '../skills', name: 'buildSkillToolDefinition' },
      { prefix: '../skills', name: 'createSkillTool' },
      { prefix: '../skills', name: 'buildSkillManageToolDescription' },
      { prefix: '../skills', name: 'executeSkillManageTool' },
      { prefix: '../skills', name: 'skillManageToolDefinition' },
      { prefix: '../skills', name: 'SKILL_MANAGE_GUIDANCE' },
    ],
    exceptions: {
      'packages/capek/src/plugins/skills-domain.ts': ['../skills'],
    },
  },
  {
    name: 'plugins-no-workflow-ownership',
    rationale: 'C5 moved the workflow tool, decomposition, synthesis, and orchestrator-session implementation ownership to the workflow domain plugin. Plugin modules must not import the workflow domain implementation except the workflow domain plugin itself and the orchestrator-session provider bridge, which pins the named shared contract to the current implementation.',
    appliesTo: [dir('plugins')],
    forbiddenSpecifiers: [
      { prefix: '../workflow', name: 'executeWorkflow' },
      { prefix: '../workflow', name: 'executeWorkflowWithDeps' },
      { prefix: '../workflow', name: 'getWorkflowToolDefinition' },
      { prefix: '../workflow', name: 'resolveWorkflowToolDefinitionWithDeps' },
      { prefix: '../workflow', name: 'buildWorkflowToolDefinition' },
      { prefix: '../workflow', name: 'decomposeTask' },
      { prefix: '../workflow', name: 'decomposeTaskWithDeps' },
      { prefix: '../workflow', name: 'synthesizeResults' },
      { prefix: '../workflow', name: 'synthesizeResultsWithDeps' },
      { prefix: '../workflow', name: 'runOrchestratorSession' },
      { prefix: '../workflow', name: 'canSpawnSubagent' },
    ],
    exceptions: {
      'packages/capek/src/plugins/workflow-domain.ts': ['../workflow/execution'],
      'packages/capek/src/plugins/orchestrator-session.ts': ['../workflow/orchestrator-session'],
    },
  },
  {
    name: 'core-no-plugins',
    rationale: 'The turn-execution core consumes contracts only. The fixed context builder and provider values live in plugins; a core import of plugins would reintroduce the fixed builder or optional-domain coupling that C3 removed from the runtime path.',
    appliesTo: [dir('core')],
    forbiddenResolvedDirs: [dir('plugins')],
  },
  {
    name: 'core-no-sandbox',
    rationale: 'Sandbox behavior is a plugin; core must not import the sandbox controller.',
    appliesTo: [dir('core')],
    forbiddenResolvedDirs: [dir('sandbox')],
    exceptions: {
      'packages/capek/src/core/interrupt.ts': ['../sandbox/controller'],
    },
  },
  {
    name: 'sandbox-no-storage-or-providers',
    rationale: 'Sandbox must not import storage implementations or the provider registry.',
    appliesTo: [dir('sandbox')],
    forbiddenResolvedDirs: [dir('storage'), resolve(dir('providers'), 'registry.ts')],
    exceptions: {
      'packages/capek/src/sandbox/model.ts': ['../storage/runtime'],
    },
  },
  {
    name: 'kernel-purity',
    rationale: 'The kernel is dependency-free: no external AI/runtime libraries, no Jean2 or Capek package roots, no Bun or Node product APIs, and no imports outside its own directory.',
    appliesTo: [dir('kernel')],
    allowedResolvedDirs: 'own-concern',
    forbiddenSpecifiers: [
      { prefix: '@ai-sdk/' },
      { exact: 'ai' },
      { prefix: capekaiPackagePrefix },
      { exact: 'hono' },
      { prefix: 'bun:' },
      { prefix: 'node:' },
      { exact: '@capekai/core' },
    ],
  },
  {
    name: 'plugins-no-core',
    rationale: 'C2 provider plugins wrap current seam contracts only; the turn-execution core is composed later and must not be imported by plugins.',
    appliesTo: [dir('plugins')],
    forbiddenResolvedDirs: [dir('core')],
  },
  {
    name: 'core-no-kernel',
    rationale: 'The kernel is a composition-only concern; the turn-execution core must not import it.',
    appliesTo: [dir('core')],
    forbiddenResolvedDirs: [dir('kernel')],
  },
  {
    name: 'facade-core-no-standard-tool-list',
    rationale: 'The runtime core consumes effective contributed tools. The fixed standard tool list is installed coding-bundle behavior in the plugins layer only.',
    appliesTo: [dir('core')],
    forbiddenSpecifiers: [
      { exact: '../tools/standard-tools' },
    ],
  },
  {
    name: 'bundles-compose-plugins-and-kernel',
    rationale: 'Bundles are ordinary TypeScript composition over the plugin and kernel layers only; they must not reach into the runtime core, facade, or compat.',
    appliesTo: [dir('bundles')],
    allowedResolvedDirs: [dir('plugins'), dir('kernel')],
  },
];

describe('C0 internal dependency boundaries', () => {
  test('parser captures every required import form', () => {
    const fixture = [
      "import { alpha } from 'value-import';",
      "import type { beta } from 'type-import';",
      "import { type gamma } from 'inline-type-import';",
      "import 'side-effect-import';",
      "import delta from 'default-import';",
      "import * as epsilon from 'namespace-import';",
      "export { zeta } from 'export-from';",
      "export type { eta } from 'export-type-from';",
      "export { type theta } from 'inline-export-type-from';",
      "export * from 'export-star';",
      "const iota = require('require-call');",
      "const kappa = await import('dynamic-import');",
    ].join('\n');

    const imports = parseImports(fixture, resolve(packageSourceRoot, 'fixture.ts'));

    expect(imports.map((imp) => [imp.specifier, imp.kind, imp.names])).toEqual([
      ['value-import', 'value', ['alpha']],
      ['type-import', 'type', ['beta']],
      ['inline-type-import', 'type', ['gamma']],
      ['side-effect-import', 'side-effect', []],
      ['default-import', 'value', ['delta']],
      ['namespace-import', 'value', ['epsilon']],
      ['export-from', 'export-from', ['zeta']],
      ['export-type-from', 'export-type', ['eta']],
      ['inline-export-type-from', 'export-type', ['theta']],
      ['export-star', 'export-from', []],
      ['require-call', 'require', []],
      ['dynamic-import', 'dynamic', []],
    ]);
  });

  test('import names record the imported symbol for aliased imports', () => {
    const imports = parseImports(
      "import { realThing as localAlias } from 'aliased-import';",
      resolve(packageSourceRoot, 'fixture.ts'),
    );

    expect(imports[0].kind).toBe('value');
    expect(imports[0].specifier).toBe('aliased-import');
    expect(imports[0].names).toEqual(['realThing']);
  });

  test('C0 rules pass on the current source with only the named exceptions', () => {
    const result = evaluateRules(
      scanDirectory(packageSourceRoot),
      packageSourceRoot,
      repositoryRoot,
      c0Rules,
    );

    expect(result.violations).toEqual([]);
    expect(result.staleExceptions).toEqual([]);
  });

  test('retired forwarders are absent and no source or test imports through them', () => {
    expect(existsSync(resolve(repositoryRoot, 'packages/capek/src/compat'))).toBe(false);

    const retiredForwarderPaths = [
      'packages/capek/src/core/subagent.ts',
      'packages/capek/src/core/child-session.ts',
      'packages/capek/src/core/workflow.ts',
      'packages/capek/src/core/workflow-decomposer.ts',
      'packages/capek/src/core/workflow-synthesizer.ts',
      'packages/capek/src/tools/permission-request-manager.ts',
      'packages/capek/src/configuration/index.ts',
      'packages/capek/src/providers/index.ts',
      'packages/capek/src/workflow/index.ts',
      'packages/capek/src/subagent/index.ts',
      'packages/capek/src/scheduler/index.ts',
      'packages/capek/src/utils/truncate-tool-result.ts',
      'packages/capek/src/core/goal-evaluator.ts',
      'packages/capek/src/core/subagent-policy.ts',
      'packages/capek/src/core/workflow-orchestrator-session.ts',
      'packages/capek/src/core/retry.ts',
      'packages/capek/src/core/compaction.ts',
      'packages/capek/src/core/compaction-executor.ts',
      'packages/capek/src/core/stream/compaction-threshold.ts',
      'packages/capek/src/tools/ask-user-api.ts',
      'packages/capek/src/tools/workspace-capability.ts',
      'packages/capek/src/tools/tool-output-artifacts.ts',
      'packages/capek/src/core/goal-loop.ts',
      'packages/capek/src/sandbox/provider-types.ts',
    ];
    const sourceFiles = scanDirectory(packageSourceRoot);
    expect(retiredForwarderPaths.filter((repoFile) =>
      sourceFiles.some((file) => relative(repositoryRoot, file.path) === repoFile))).toEqual([]);

    const imports = [...sourceFiles, ...scanDirectory(resolve(repositoryRoot, 'packages/capek/tests'))]
      .flatMap((file) => parseImports(file.sourceText, file.path));
    const retiredImports = imports.filter((imp) => {
      const resolved = resolveLocalSpecifier(imp.specifier, imp.file, packageSourceRoot);
      return retiredForwarderPaths.some((repoFile) => {
        const target = resolve(repositoryRoot, repoFile);
        return resolved === target || resolved === target.slice(0, -3);
      });
    });
    expect(retiredImports).toEqual([]);
  });

  test('a new violation fails while a named exception stays allowed', () => {
    const synthetic: ScannedFile[] = [
      {
        path: resolve(packageSourceRoot, 'tools/new-core-importer.ts'),
        sourceText: "import { getModelWithMetadata } from '../core/model-utils';\n",
      },
      {
        path: resolve(packageSourceRoot, 'tools/llm-api.ts'),
        sourceText: "import { getModelWithMetadata } from '../core/model-utils';\n",
      },
    ];

    const result = evaluateRules(synthetic, packageSourceRoot, repositoryRoot, c0Rules);

    expect(result.violations).toEqual([
      'packages/capek/src/tools/new-core-importer.ts imports ../core/model-utils (value) [rule: tools-no-core]',
    ]);
  });

  test('kernel purity flags product and external imports', () => {
    const synthetic: ScannedFile[] = [
      {
        path: resolve(packageSourceRoot, 'kernel/impure.ts'),
        sourceText: [
          "import { createAgent } from '../facade/create-agent';",
          "import { aliased } from '@/facade/other';",
          "import { generateText } from 'ai';",
          "import { session } from '@capekai/types';",
          "import { Database } from 'bun:sqlite';",
          "import { readFile } from 'node:fs';",
          "const cap = require('@capekai/core');",
          "const dyn = await import('hono');",
          '',
        ].join('\n'),
      },
      {
        path: resolve(packageSourceRoot, 'kernel/pure.ts'),
        sourceText: "import type { ServiceKey } from './types';\n",
      },
    ];

    const result = evaluateRules(synthetic, packageSourceRoot, repositoryRoot, c0Rules);

    expect(result.violations).toEqual([
      'packages/capek/src/kernel/impure.ts imports ../facade/create-agent (value) [rule: kernel-purity]',
      'packages/capek/src/kernel/impure.ts imports @/facade/other (value) [rule: kernel-purity]',
      'packages/capek/src/kernel/impure.ts imports ai (value) [rule: kernel-purity]',
      'packages/capek/src/kernel/impure.ts imports @capekai/types (value) [rule: kernel-purity]',
      'packages/capek/src/kernel/impure.ts imports bun:sqlite (value) [rule: kernel-purity]',
      'packages/capek/src/kernel/impure.ts imports node:fs (value) [rule: kernel-purity]',
      'packages/capek/src/kernel/impure.ts imports @capekai/core (require) [rule: kernel-purity]',
      'packages/capek/src/kernel/impure.ts imports hono (dynamic) [rule: kernel-purity]',
    ]);
    // The synthetic scan omits files referenced by other rules' named
    // exceptions, so only kernel-related staleness is asserted here.
    expect(result.staleExceptions.filter((message) => message.includes('kernel'))).toEqual([]);
  });

  test('kernel strict self-containment passes on the current kernel source', () => {
    expect(kernelStrictViolations(scanDirectory(kernelSourceRoot))).toEqual([]);
  });

  test('the runtime core builds context only through the assembler contract', () => {
    const coreFiles = scanDirectory(dir('core'));
    const agentSource = coreFiles.find((file) => file.path.endsWith('core/agent.ts'));
    expect(agentSource).toBeDefined();
    const agentImports = parseImports(agentSource!.sourceText, agentSource!.path);
    expect(agentImports.some((imp) =>
      imp.specifier === '../context/assembler' && imp.names.includes('getContextAssembler'))).toBe(true);

    const violations: string[] = [];
    for (const file of coreFiles) {
      for (const imp of parseImports(file.sourceText, file.path)) {
        if (imp.specifier.includes('system-message') || imp.specifier.includes('legacy-system-message')) {
          violations.push(
            `${relative(repositoryRoot, file.path)} imports ${imp.specifier} (${imp.kind}) [rule: core-assembler-contract-only]`,
          );
        }
      }
    }
    expect(violations).toEqual([]);
  });

  test('the runtime core never imports the hardcoded standard tool list', () => {
    const files = [
      ...scanDirectory(dir('core')),
    ];
    const violations: string[] = [];
    for (const file of files) {
      for (const imp of parseImports(file.sourceText, file.path)) {
        if (imp.specifier.includes('standard-tools')) {
          violations.push(
            `${relative(repositoryRoot, file.path)} imports ${imp.specifier} (${imp.kind}) [rule: facade-core-no-standard-tool-list]`,
          );
        }
      }
    }
    expect(violations).toEqual([]);
  });

  test('the runtime core never imports the concrete session-search domain', () => {
    const violations: string[] = [];
    for (const file of scanDirectory(dir('core'))) {
      for (const imp of parseImports(file.sourceText, file.path)) {
        const resolved = resolveLocalSpecifier(imp.specifier, file.path, packageSourceRoot);
        if (resolved !== null && isWithin(resolved, dir('session-search'))) {
          violations.push(
            `${relative(repositoryRoot, file.path)} imports ${imp.specifier} (${imp.kind}) [rule: core-no-session-search-domain]`,
          );
        }
      }
    }
    expect(violations).toEqual([]);
  });

  test('the runtime core never imports the concrete scheduler domain', () => {
    const violations: string[] = [];
    for (const file of scanDirectory(dir('core'))) {
      for (const imp of parseImports(file.sourceText, file.path)) {
        const resolved = resolveLocalSpecifier(imp.specifier, file.path, packageSourceRoot);
        if (resolved !== null && isWithin(resolved, dir('scheduler'))) {
          violations.push(
            `${relative(repositoryRoot, file.path)} imports ${imp.specifier} (${imp.kind}) [rule: core-no-scheduler-domain]`,
          );
        }
      }
    }
    expect(violations).toEqual([]);
  });



  test('the workflow domain consumes the subagent domain only through the task-tool and policy contracts', () => {
    const allowedEdges: Record<string, string[]> = {
      'packages/capek/src/workflow/execution.ts': [
        '../subagent/task-tool',
        '../subagent/policy',
      ],
    };
    const violations: string[] = [];
    for (const file of scanDirectory(dir('workflow'))) {
      const repoFile = relative(repositoryRoot, file.path);
      for (const imp of parseImports(file.sourceText, file.path)) {
        const resolved = resolveLocalSpecifier(imp.specifier, file.path, packageSourceRoot);
        if (resolved === null || !isWithin(resolved, dir('subagent'))) continue;
        if ((allowedEdges[repoFile] ?? []).includes(imp.specifier)) continue;
        violations.push(
          `${repoFile} imports ${imp.specifier} (${imp.kind}) [rule: workflow-subagent-contract-only]`,
        );
      }
    }
    expect(violations).toEqual([]);
  });

  test('the runtime core imports no memory or skills implementation', () => {
    const violations: string[] = [];
    for (const file of scanDirectory(dir('core'))) {
      for (const imp of parseImports(file.sourceText, file.path)) {
        const resolved = resolveLocalSpecifier(imp.specifier, file.path, packageSourceRoot);
        if (resolved === null) continue;
        if (isWithin(resolved, dir('memory')) || isWithin(resolved, dir('skills'))) {
          violations.push(
            `${relative(repositoryRoot, file.path)} imports ${imp.specifier} (${imp.kind}) [rule: core-no-memory-skills]`,
          );
        }
      }
    }
    expect(violations).toEqual([]);
  });


  test('child-session consumes the retry stream from the retry domain, not core', () => {
    const repoFile = 'packages/capek/src/subagent/child-session.ts';
    const file = scanDirectory(dir('subagent')).find((candidate) => relative(repositoryRoot, candidate.path) === repoFile);
    expect(file, repoFile).toBeDefined();
    const imports = parseImports(file!.sourceText, file!.path);
    expect(imports.some((imp) => imp.specifier === '../retry/stream-chat' && imp.names.includes('streamChatWithRetry'))).toBe(true);
    expect(imports.some((imp) => imp.specifier.includes('core/retry'))).toBe(false);
  });



  test('the permission domain imports no runtime core', () => {
    const violations: string[] = [];
    for (const file of scanDirectory(dir('permission'))) {
      for (const imp of parseImports(file.sourceText, file.path)) {
        const resolved = resolveLocalSpecifier(imp.specifier, file.path, packageSourceRoot);
        if (resolved !== null && isWithin(resolved, dir('core'))) {
          violations.push(
            `${relative(repositoryRoot, file.path)} imports ${imp.specifier} (${imp.kind}) [rule: permission-domain-no-core]`,
          );
        }
      }
    }
    expect(violations).toEqual([]);
  });


  test('the C6 runtime layers enforce the mandatory invariants independent of provider advice', () => {
    // Source-level pins for the C6 step 6 enforcement seams. Each runtime
    // layer must contain the non-overridable check; a custom provider can
    // only advise.
    const pins: Record<string, string[]> = {
      'packages/capek/src/retry/stream-chat.ts': [
        'policyCanRetry',
        '!attemptHadToolActivity',
        '!abortController.signal.aborted',
      ],
      'packages/capek/src/compaction/executor.ts': [
        'session.compacting',
      ],
      'packages/capek/src/workspace/policy.ts': [
        'createWorkspaceCapabilityWithOptions',
        'getWorkspaceService().options',
      ],
      'packages/capek/src/permission/runtime.ts': [
        'isValidPermissionResponse(response)',
        "'denied',",
        'persistCanonicalGrants',
      ],
      'packages/capek/src/tool-output/policy.ts': [
        'retrieveToolOutputForSession',
      ],
    };
    for (const [repoFile, needles] of Object.entries(pins)) {
      const file = scanDirectory(packageSourceRoot).find((candidate) =>
        relative(repositoryRoot, candidate.path) === repoFile);
      expect(file, repoFile).toBeDefined();
      for (const needle of needles) {
        expect(file!.sourceText, needle).toContain(needle);
      }
    }
    // False configurability removed: page limits are storage invariants,
    // not provider options.
    const policyFile = scanDirectory(packageSourceRoot).find((candidate) =>
      relative(repositoryRoot, candidate.path) === 'packages/capek/src/tool-output/policy.ts');
    expect(policyFile!.sourceText).not.toContain('defaultPageChars:');
    expect(policyFile!.sourceText).not.toContain('maxPageChars:');
  });

  test('the goal domain uses only the shared orchestrator implementation edge', () => {
    const violations: string[] = [];
    for (const file of scanDirectory(dir('goals'))) {
      const repoFile = relative(repositoryRoot, file.path);
      for (const imp of parseImports(file.sourceText, file.path)) {
        const resolved = resolveLocalSpecifier(imp.specifier, file.path, packageSourceRoot);
        if (resolved === null || !isWithin(resolved, dir('workflow'))) continue;
        if (repoFile !== 'packages/capek/src/goals/evaluator.ts'
          || imp.specifier !== '../workflow/orchestrator-session') {
          violations.push(
            `${repoFile} imports ${imp.specifier} (${imp.kind}) [rule: goal-shared-orchestrator-owner-only]`,
          );
        }
      }
    }
    expect(violations).toEqual([]);
  });


  test('the C7 runtime spine imports only kernel and runtime contracts', () => {
    const runtimeRoot = dir('runtime');
    const spineFiles = new Set(['agent-runtime.ts', 'default-agent-driver.ts']);
    const files = scanDirectory(runtimeRoot).filter((file) =>
      spineFiles.has(relative(runtimeRoot, file.path)));
    const violations: string[] = [];

    for (const file of files) {
      for (const imported of parseImports(file.sourceText, file.path)) {
        const resolved = resolveLocalSpecifier(imported.specifier, file.path, packageSourceRoot);
        if (!resolved || (!isWithin(resolved, runtimeRoot) && !isWithin(resolved, kernelSourceRoot))) {
          violations.push(`${relative(packageSourceRoot, file.path)} imports ${imported.specifier}`);
        }
      }
    }

    expect(files).toHaveLength(2);
    expect(violations).toEqual([]);
  });

  test('kernel strict self-containment rejects alias, dynamic import, require, and package-root imports', () => {
    const synthetic: ScannedFile[] = [
      {
        path: resolve(kernelSourceRoot, 'impure.ts'),
        sourceText: [
          "import { createAgent } from '@/facade/create-agent';",
          "import { z } from 'zod';",
          "const cap = require('@capekai/core');",
          "const dyn = await import('@capekai/types');",
          "import { generateText } from 'ai';",
          "import { Database } from 'bun:sqlite';",
          "import { readFile } from 'node:fs';",
          '',
        ].join('\n'),
      },
      {
        path: resolve(kernelSourceRoot, 'pure.ts'),
        sourceText: "import type { ServiceKey } from './types';\n",
      },
    ];

    expect(kernelStrictViolations(synthetic)).toEqual([
      'packages/capek/src/kernel/impure.ts imports @/facade/create-agent (value) [rule: kernel-strict-self-containment]',
      'packages/capek/src/kernel/impure.ts imports zod (value) [rule: kernel-strict-self-containment]',
      'packages/capek/src/kernel/impure.ts imports @capekai/core (require) [rule: kernel-strict-self-containment]',
      'packages/capek/src/kernel/impure.ts imports @capekai/types (dynamic) [rule: kernel-strict-self-containment]',
      'packages/capek/src/kernel/impure.ts imports ai (value) [rule: kernel-strict-self-containment]',
      'packages/capek/src/kernel/impure.ts imports bun:sqlite (value) [rule: kernel-strict-self-containment]',
      'packages/capek/src/kernel/impure.ts imports node:fs (value) [rule: kernel-strict-self-containment]',
    ]);
  });
});
