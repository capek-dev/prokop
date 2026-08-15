import { describe, expect, test } from 'bun:test';
import { resolve } from 'node:path';
import {
  evaluateRules,
  parseImports,
  scanDirectory,
  type DependencyRule,
  type ScannedFile,
  type SpecifierMatcher,
} from '../helpers/import-scan';

const repositoryRoot = resolve(import.meta.dir, '../../../../');
const serverSourceRoot = resolve(repositoryRoot, 'packages/server/src');

const bootstrapDir = resolve(serverSourceRoot, 'bootstrap');
const transportDir = resolve(serverSourceRoot, 'transport');
const applicationDir = resolve(serverSourceRoot, 'application');
const domainsDir = resolve(serverSourceRoot, 'domains');
const infrastructureDir = resolve(serverSourceRoot, 'infrastructure');
const adaptersDir = resolve(serverSourceRoot, 'adapters');
const adaptersCapekDir = resolve(adaptersDir, 'capek');
const layerDirs = [bootstrapDir, transportDir, applicationDir, domainsDir, infrastructureDir, adaptersDir];
const infrastructureSqliteDir = resolve(infrastructureDir, 'sqlite');

const honoMatchers: SpecifierMatcher[] = [
  { exact: 'hono' },
  { prefix: 'hono/' },
  { prefix: '@hono/' },
];

const compatBarrelExceptions: Record<string, string[]> = {
  'packages/server/src/capek-adapter.ts': ['@capekai/core/compat/jean2'],
  'packages/server/src/capek-event-adapter.ts': ['@capekai/core/compat/jean2'],
  'packages/server/src/configuration/models.ts': ['@capekai/core/compat/jean2'],
  'packages/server/src/configuration/tool-env.ts': ['@capekai/core/compat/jean2'],
  'packages/server/src/core/chat-handler.ts': ['@capekai/core/compat/jean2'],
  'packages/server/src/core/handlers/misc.ts': ['@capekai/core/compat/jean2'],
  'packages/server/src/core/handlers/providers.ts': ['@capekai/core/compat/jean2'],
  'packages/server/src/core/handlers/session-lifecycle.ts': ['@capekai/core/compat/jean2'],
  'packages/server/src/core/session-handler.ts': ['@capekai/core/compat/jean2'],
  'packages/server/src/core/session-title.ts': ['@capekai/core/compat/jean2'],
  'packages/server/src/index.ts': ['@capekai/core/compat/jean2'],
  'packages/server/src/providers/codex.ts': ['@capekai/core/compat/jean2'],
  'packages/server/src/providers/gmail.ts': ['@capekai/core/compat/jean2'],
  'packages/server/src/providers/oauth-manager.ts': ['@capekai/core/compat/jean2'],
  'packages/server/src/routes/config.ts': ['@capekai/core/compat/jean2'],
  'packages/server/src/routes/tools.ts': ['@capekai/core/compat/jean2'],
  'packages/server/src/sandbox/index.ts': ['@capekai/core/compat/jean2'],
  'packages/server/src/sandbox/routes.ts': ['@capekai/core/compat/jean2'],
  'packages/server/src/scheduler/runner.ts': ['@capekai/core/compat/jean2'],
  'packages/server/src/store/compaction-recovery.ts': ['@capekai/core/compat/jean2'],
  'packages/server/src/tools/tool-installer.ts': ['@capekai/core/compat/jean2'],
};

const serverWebSocketExceptions: Record<string, string[]> = {
  'packages/server/src/index.ts': ['bun'],
  'packages/server/src/core/chat-handler.ts': ['bun'],
  'packages/server/src/core/client-registry.ts': ['bun'],
  'packages/server/src/core/message-router.ts': ['bun'],
  'packages/server/src/core/router-context.ts': ['bun'],
  'packages/server/src/core/session-control-registry.ts': ['bun'],
  'packages/server/src/core/session-handler.ts': ['bun'],
  'packages/server/src/core/handlers/control.ts': ['bun'],
  'packages/server/src/core/handlers/misc.ts': ['bun'],
  'packages/server/src/core/handlers/permissions.ts': ['bun'],
  'packages/server/src/core/handlers/providers.ts': ['bun'],
  'packages/server/src/core/handlers/queue.ts': ['bun'],
  'packages/server/src/core/handlers/session-lifecycle.ts': ['bun'],
  'packages/server/src/services/terminal/event-manager.ts': ['bun'],
  'packages/server/src/services/terminal/manager.ts': ['bun'],
};

const sqliteExceptions: Record<string, string[]> = {
  'packages/server/src/store/index.ts': ['bun:sqlite'],
  'packages/server/src/store/response-formats.ts': ['bun:sqlite'],
};

const aiSdkExceptions: Record<string, string[]> = {
  'packages/server/src/core/session-title.ts': ['ai'],
  'packages/server/src/mcp/manager.ts': ['ai'],
  'packages/server/src/mcp/converter.ts': ['ai'],
  'packages/server/src/providers/codex.ts': ['ai', '@ai-sdk/openai'],
};

const globalBaselineRules: DependencyRule[] = [
  {
    name: 'no-direct-compat-barrel',
    rationale: 'No server file may import @capekai/core/compat/jean2 outside the recorded temporary exceptions. Retired by S8.',
    appliesTo: [serverSourceRoot],
    forbiddenSpecifiers: [{ exact: '@capekai/core/compat/jean2' }],
    exceptions: compatBarrelExceptions,
  },
  {
    name: 'bun-server-websocket-transport-only',
    rationale: 'ServerWebSocket belongs to transport. Current consumers are temporary exceptions; new consumers fail.',
    appliesTo: [serverSourceRoot],
    forbiddenSpecifiers: [{ exact: 'bun', name: 'ServerWebSocket' }],
    allowedInDirs: [transportDir],
    exceptions: serverWebSocketExceptions,
  },
  {
    name: 'sqlite-infrastructure-only',
    rationale: 'SQLite belongs to infrastructure. Current store consumers are temporary exceptions; new consumers fail.',
    appliesTo: [serverSourceRoot],
    forbiddenSpecifiers: [{ exact: 'bun:sqlite' }],
    allowedInDirs: [infrastructureSqliteDir],
    exceptions: sqliteExceptions,
  },
  {
    name: 'no-direct-ai-sdk',
    rationale: 'Model invocation belongs to Capek. Server AI SDK imports are temporary exceptions; new imports fail.',
    appliesTo: [serverSourceRoot],
    forbiddenSpecifiers: [
      { exact: 'ai' },
      { prefix: '@ai-sdk/' },
      { exact: '@openrouter/ai-sdk-provider' },
      { exact: 'vercel-minimax-ai-provider' },
      { exact: 'zhipu-ai-provider' },
    ],
    exceptions: aiSdkExceptions,
  },
];

const layerRules: DependencyRule[] = [
  {
    name: 'layer-bootstrap',
    rationale: 'Bootstrap composes the six layers; relative imports must stay inside the layer directories.',
    appliesTo: [bootstrapDir],
    allowedResolvedDirs: layerDirs,
  },
  {
    name: 'layer-transport',
    rationale: 'Transport may invoke application services. No SQLite, AI SDK, or Capek implementation imports.',
    appliesTo: [transportDir],
    forbiddenSpecifiers: [
      { exact: 'bun:sqlite' },
      { exact: 'ai' },
      { prefix: '@ai-sdk/' },
      { prefix: '@capekai/core' },
    ],
    allowedResolvedDirs: [transportDir, applicationDir],
  },
  {
    name: 'layer-application',
    rationale: 'Application depends on domains and ports. No Hono, Bun, or SQL.',
    appliesTo: [applicationDir],
    forbiddenSpecifiers: [
      ...honoMatchers,
      { exact: 'bun' },
      { exact: 'bun:sqlite' },
    ],
    allowedResolvedDirs: [applicationDir, domainsDir],
  },
  {
    name: 'layer-domains',
    rationale: 'Domains own product rules. No Hono, Bun WebSocket, SQLite, or Capek implementations.',
    appliesTo: [domainsDir],
    forbiddenSpecifiers: [
      ...honoMatchers,
      { exact: 'bun' },
      { exact: 'bun:sqlite' },
      { prefix: '@capekai/core' },
    ],
    allowedResolvedDirs: [domainsDir],
  },
  {
    name: 'layer-infrastructure',
    rationale: 'Infrastructure implements ports. It may import domains and application ports but not transport route handlers.',
    appliesTo: [infrastructureDir],
    allowedResolvedDirs: [infrastructureDir, domainsDir, applicationDir],
  },
  {
    name: 'layer-adapters',
    rationale: 'Adapters translate Capek contracts and Jean2 ports. No transport imports.',
    appliesTo: [adaptersDir],
    allowedResolvedDirs: [adaptersDir, applicationDir, domainsDir],
  },
  {
    name: 'layer-adapters-capek-only',
    rationale: 'Only the Capek adapter directory translates Capek contracts. SDK and client-event adapters must not import @capekai/core.',
    appliesTo: [adaptersDir],
    forbiddenSpecifiers: [{ prefix: '@capekai/core' }],
    allowedInDirs: [adaptersCapekDir],
  },
];

describe('server layer boundaries', () => {
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

    const imports = parseImports(fixture, resolve(serverSourceRoot, 'fixture.ts'));

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

  test('global baselines pass with only the recorded temporary exceptions', () => {
    const result = evaluateRules(
      scanDirectory(serverSourceRoot),
      serverSourceRoot,
      repositoryRoot,
      globalBaselineRules,
    );

    expect(result.violations).toEqual([]);
    expect(result.staleExceptions).toEqual([]);
  });

  test('layer rules run against the target directories', () => {
    const result = evaluateRules(
      scanDirectory(serverSourceRoot),
      serverSourceRoot,
      repositoryRoot,
      layerRules,
    );

    expect(result.violations).toEqual([]);
  });

  test('transport layer flags storage, AI SDK, Capek, and SQLite imports', () => {
    const files: ScannedFile[] = [
      {
        path: resolve(transportDir, 'http/routes/sessions.ts'),
        sourceText: [
          "import { Hono } from 'hono';",
          "import { authFromContext } from '../../../application/sessions/auth';",
          "import { getSessionStore } from '../../../store/sessions';",
          "import { streamText } from 'ai';",
          "import { jean2Thing } from '@capekai/core/compat/jean2';",
          "import { Database } from 'bun:sqlite';",
        ].join('\n'),
      },
    ];

    const result = evaluateRules(files, serverSourceRoot, repositoryRoot, layerRules);

    expect(result.violations).toEqual([
      'packages/server/src/transport/http/routes/sessions.ts imports ../../../store/sessions (value) [rule: layer-transport]',
      'packages/server/src/transport/http/routes/sessions.ts imports ai (value) [rule: layer-transport]',
      'packages/server/src/transport/http/routes/sessions.ts imports @capekai/core/compat/jean2 (value) [rule: layer-transport]',
      'packages/server/src/transport/http/routes/sessions.ts imports bun:sqlite (value) [rule: layer-transport]',
    ]);
  });

  test('application layer flags Hono, Bun, and SQLite imports', () => {
    const files: ScannedFile[] = [
      {
        path: resolve(applicationDir, 'sessions/send-message.ts'),
        sourceText: [
          "import { Context } from 'hono';",
          "import type { ServerWebSocket } from 'bun';",
          "import { Database } from 'bun:sqlite';",
          "import { zValidator } from '@hono/zod-validator';",
          "import './sessions-policy';",
          "import '../../domains/sessions/ports';",
        ].join('\n'),
      },
    ];

    const result = evaluateRules(files, serverSourceRoot, repositoryRoot, layerRules);

    expect(result.violations).toEqual([
      'packages/server/src/application/sessions/send-message.ts imports hono (value) [rule: layer-application]',
      'packages/server/src/application/sessions/send-message.ts imports bun (type) [rule: layer-application]',
      'packages/server/src/application/sessions/send-message.ts imports bun:sqlite (value) [rule: layer-application]',
      'packages/server/src/application/sessions/send-message.ts imports @hono/zod-validator (value) [rule: layer-application]',
    ]);
  });

  test('domains layer flags Hono, Bun, SQLite, and Capek imports', () => {
    const files: ScannedFile[] = [
      {
        path: resolve(domainsDir, 'sessions/policy.ts'),
        sourceText: [
          "import { Context } from 'hono';",
          "import type { ServerWebSocket } from 'bun';",
          "import { Database } from 'bun:sqlite';",
          "import { createAgent } from '@capekai/core';",
          "import './participants';",
        ].join('\n'),
      },
    ];

    const result = evaluateRules(files, serverSourceRoot, repositoryRoot, layerRules);

    expect(result.violations).toEqual([
      'packages/server/src/domains/sessions/policy.ts imports hono (value) [rule: layer-domains]',
      'packages/server/src/domains/sessions/policy.ts imports bun (type) [rule: layer-domains]',
      'packages/server/src/domains/sessions/policy.ts imports bun:sqlite (value) [rule: layer-domains]',
      'packages/server/src/domains/sessions/policy.ts imports @capekai/core (value) [rule: layer-domains]',
    ]);
  });

  test('infrastructure layer flags transport route imports', () => {
    const files: ScannedFile[] = [
      {
        path: resolve(infrastructureDir, 'sqlite/repositories/sessions.ts'),
        sourceText: [
          "import { routeHelper } from '../../../transport/http/routes/sessions';",
          "import { Database } from 'bun:sqlite';",
          "import './migrations';",
          "import '../../../domains/sessions/ports';",
          "import '../../../application/sessions/use-case';",
        ].join('\n'),
      },
    ];

    const result = evaluateRules(files, serverSourceRoot, repositoryRoot, layerRules);

    expect(result.violations).toEqual([
      'packages/server/src/infrastructure/sqlite/repositories/sessions.ts imports ../../../transport/http/routes/sessions (value) [rule: layer-infrastructure]',
    ]);
  });

  test('adapters layer flags transport imports and allows Capek contracts', () => {
    const files: ScannedFile[] = [
      {
        path: resolve(adaptersDir, 'capek/storage.ts'),
        sourceText: [
          "import { transportThing } from '../../transport/ws/registry';",
          "import { createAgent } from '@capekai/core';",
          "import './profile';",
          "import '../../application/ports';",
          "import '../../domains/ports';",
        ].join('\n'),
      },
    ];

    const result = evaluateRules(files, serverSourceRoot, repositoryRoot, layerRules);

    expect(result.violations).toEqual([
      'packages/server/src/adapters/capek/storage.ts imports ../../transport/ws/registry (value) [rule: layer-adapters]',
    ]);
  });

  test('bootstrap layer flags imports outside the six layer directories', () => {
    const files: ScannedFile[] = [
      {
        path: resolve(bootstrapDir, 'start.ts'),
        sourceText: [
          "import { startApp } from '../transport/http/app';",
          "import { createApplication } from '../application';",
          "import { openDatabase } from '../infrastructure/sqlite/connection';",
          "import { profile } from '../adapters/capek/profile';",
          "import { legacyStore } from '../store';",
        ].join('\n'),
      },
    ];

    const result = evaluateRules(files, serverSourceRoot, repositoryRoot, layerRules);

    expect(result.violations).toEqual([
      'packages/server/src/bootstrap/start.ts imports ../store (value) [rule: layer-bootstrap]',
    ]);
  });

  test('global compat baseline flags new consumers and keeps exact exceptions', () => {
    const files: ScannedFile[] = [
      {
        path: resolve(serverSourceRoot, 'routes/config.ts'),
        sourceText: "import { x } from '@capekai/core/compat/jean2';\n",
      },
      {
        path: resolve(serverSourceRoot, 'routes/notifications.ts'),
        sourceText: "import { y } from '@capekai/core/compat/jean2';\n",
      },
    ];

    const result = evaluateRules(files, serverSourceRoot, repositoryRoot, [
      globalBaselineRules[0],
    ]);

    expect(result.violations).toEqual([
      'packages/server/src/routes/notifications.ts imports @capekai/core/compat/jean2 (value) [rule: no-direct-compat-barrel]',
    ]);
  });

  test('alias specifiers resolve against the package source root', () => {
    const files: ScannedFile[] = [
      {
        path: resolve(transportDir, 'http/routes/sessions.ts'),
        sourceText: [
          "import { getSessionStore } from '@/store/sessions';",
          "import { authFromContext } from '@/application/sessions/auth';",
        ].join('\n'),
      },
    ];

    const result = evaluateRules(files, serverSourceRoot, repositoryRoot, layerRules);

    expect(result.violations).toEqual([
      'packages/server/src/transport/http/routes/sessions.ts imports @/store/sessions (value) [rule: layer-transport]',
    ]);
  });

  test('only adapters/capek may import @capekai/core', () => {
    const files: ScannedFile[] = [
      {
        path: resolve(adaptersCapekDir, 'storage.ts'),
        sourceText: "import { createAgent } from '@capekai/core';\n",
      },
      {
        path: resolve(adaptersDir, 'sdk/events.ts'),
        sourceText: "import { createAgent } from '@capekai/core';\n",
      },
      {
        path: resolve(adaptersDir, 'client-events/presenter.ts'),
        sourceText: "import { x } from '@capekai/core/storage';\n",
      },
    ];

    const result = evaluateRules(files, serverSourceRoot, repositoryRoot, layerRules);

    expect(result.violations).toEqual([
      'packages/server/src/adapters/sdk/events.ts imports @capekai/core (value) [rule: layer-adapters-capek-only]',
      'packages/server/src/adapters/client-events/presenter.ts imports @capekai/core/storage (value) [rule: layer-adapters-capek-only]',
    ]);
  });

  test('import names record the imported symbol for aliased imports', () => {
    const imports = parseImports(
      "import type { ServerWebSocket as WS } from 'bun';",
      resolve(serverSourceRoot, 'fixture.ts'),
    );

    expect(imports[0].kind).toBe('type');
    expect(imports[0].specifier).toBe('bun');
    expect(imports[0].names).toEqual(['ServerWebSocket']);
  });

  test('ServerWebSocket matcher is sensitive to the imported name', () => {
    const files: ScannedFile[] = [
      {
        path: resolve(serverSourceRoot, 'core/chat-handler.ts'),
        sourceText: "import type { ServerWebSocket } from 'bun';\n",
      },
      {
        path: resolve(serverSourceRoot, 'something/new-socket-file.ts'),
        sourceText: "import type { ServerWebSocket } from 'bun';\n",
      },
      {
        path: resolve(serverSourceRoot, 'something/bun-api-file.ts'),
        sourceText: "import { file } from 'bun';\n",
      },
      {
        path: resolve(serverSourceRoot, 'something/new-aliased-socket-file.ts'),
        sourceText: "import type { ServerWebSocket as WS } from 'bun';\n",
      },
    ];

    const result = evaluateRules(files, serverSourceRoot, repositoryRoot, [
      globalBaselineRules[1],
    ]);

    expect(result.violations).toEqual([
      'packages/server/src/something/new-socket-file.ts imports bun (type) [rule: bun-server-websocket-transport-only]',
      'packages/server/src/something/new-aliased-socket-file.ts imports bun (type) [rule: bun-server-websocket-transport-only]',
    ]);
  });
});
