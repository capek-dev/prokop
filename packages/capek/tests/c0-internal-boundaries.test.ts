import { describe, expect, test } from 'bun:test';
import { resolve } from 'node:path';
import {
  evaluateRules,
  parseImports,
  scanDirectory,
  type DependencyRule,
  type ScannedFile,
} from './helpers/import-scan';

const repositoryRoot = resolve(import.meta.dir, '../../..');
const packageSourceRoot = resolve(repositoryRoot, 'packages/capek/src');

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

const c0Rules: DependencyRule[] = [
  {
    name: 'leaf-concern-self-containment',
    rationale: 'Leaf concerns must not import outside their own directory while they have no declared contracts.',
    appliesTo: leafConcerns.map(dir),
    allowedResolvedDirs: 'own-concern',
  },
  {
    name: 'facade-no-compat-or-optional-domains',
    rationale: 'The facade composes core services and must not depend on the migration barrel or optional domain plugins.',
    appliesTo: [dir('facade')],
    forbiddenResolvedDirs: [dir('compat'), dir('memory'), dir('skills'), dir('session-search'), dir('scheduler')],
  },
  {
    name: 'compat-no-facade',
    rationale: 'The compatibility barrel must not import the facade; the facade is built on the same internals.',
    appliesTo: [dir('compat')],
    forbiddenResolvedDirs: [dir('facade')],
  },
  {
    name: 'tools-no-core',
    rationale: 'Tools are capability providers and must not import the runtime core outside the named contract edges.',
    appliesTo: [dir('tools')],
    forbiddenResolvedDirs: [dir('core')],
    exceptions: {
      'packages/capek/src/tools/llm-api.ts': ['../core/model-utils'],
      'packages/capek/src/tools/tool-output-artifacts.ts': ['../core/tool-builders/types'],
    },
  },
  {
    name: 'runtime-no-core-or-tools',
    rationale: 'The runtime host must not import turn-execution internals or concrete tool implementations.',
    appliesTo: [dir('runtime')],
    forbiddenResolvedDirs: [dir('core'), dir('tools')],
    exceptions: {
      'packages/capek/src/runtime/events.ts': ['../core/step-handlers'],
      'packages/capek/src/runtime/host.ts': ['../tools/workspace-capability'],
    },
  },
  {
    name: 'core-no-optional-domains',
    rationale: 'Optional domains are plugins; core must not import memory, skills, session-search, or scheduler.',
    appliesTo: [dir('core')],
    forbiddenResolvedDirs: [dir('memory'), dir('skills'), dir('session-search'), dir('scheduler')],
    exceptions: {
      'packages/capek/src/core/stream/system-message.ts': [
        '../../session-search',
        '../../memory',
        '../../skills',
      ],
      'packages/capek/src/core/tool-builders/agent-tools.ts': [
        '../../memory',
        '../../skills',
      ],
      'packages/capek/src/core/tool-builders/workspace-tools.ts': [
        '../../scheduler/scheduler-tool',
        '../../session-search',
        '../../memory',
        '../../skills',
      ],
    },
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
    forbiddenResolvedDirs: [dir('storage'), dir('providers')],
    exceptions: {
      'packages/capek/src/sandbox/model.ts': ['../storage/runtime'],
      'packages/capek/src/sandbox/provider-types.ts': ['../providers/types'],
    },
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
    expect(result.staleExceptions.some((message) => message.includes('tools/tool-output-artifacts.ts'))).toBe(true);
    expect(result.staleExceptions.some((message) => message.includes('tools/llm-api.ts'))).toBe(false);
  });
});
