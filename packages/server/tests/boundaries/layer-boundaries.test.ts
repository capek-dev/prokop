import { describe, expect, test } from 'bun:test';
import { relative, resolve } from 'node:path';
import {
  evaluateRules,
  parseImports,
  resolveLocalSpecifier,
  scanDirectory,
  type DependencyRule,
  type ScannedFile,
  type SpecifierMatcher,
} from '../helpers/import-scan';

const repositoryRoot = resolve(import.meta.dir, '../../../../');
const serverSourceRoot = resolve(repositoryRoot, 'packages/server/src');
const serverTestsRoot = resolve(repositoryRoot, 'packages/server/tests');
const bootstrapDir = resolve(serverSourceRoot, 'bootstrap');
const transportDir = resolve(serverSourceRoot, 'transport');
const applicationDir = resolve(serverSourceRoot, 'application');
const domainsDir = resolve(serverSourceRoot, 'domains');
const infrastructureDir = resolve(serverSourceRoot, 'infrastructure');
const adaptersDir = resolve(serverSourceRoot, 'adapters');
const adaptersCapekDir = resolve(adaptersDir, 'capek');
const routesDir = resolve(serverSourceRoot, 'transport/http/routes');
const utilsDir = resolve(serverSourceRoot, 'utils');
const layerDirs = [bootstrapDir, transportDir, applicationDir, domainsDir, infrastructureDir, adaptersDir];
const infrastructureSqliteDir = resolve(infrastructureDir, 'sqlite');
const builtinToolsDir = resolve(serverSourceRoot, 'tools', 'builtin');

const capekInternalPrefix = '@capekai/core/' + 'internal/';

const honoMatchers: SpecifierMatcher[] = [
  { exact: 'hono' },
  { prefix: 'hono/' },
  { prefix: '@hono/' },
];

// S8 gate: the compat barrel has zero consumers; the rule stays as
// enforcement against reintroduction.
const compatBarrelExceptions: Record<string, string[]> = {};

// S2 exit gate: zero non-transport ServerWebSocket exceptions remain.
const serverWebSocketExceptions: Record<string, string[]> = {};

const layerAdaptersLegacyExceptions: Record<string, string[]> = {
  'packages/server/src/adapters/capek/context-sources.ts': [
    '@/infrastructure/config/preconfig', '@/infrastructure/runtime/paths',
  ],
  'packages/server/src/adapters/capek/events.ts': [
    '@/transport/websocket/broadcast',
  ],
  'packages/server/src/adapters/capek/interaction.ts': [
    '@/infrastructure/sqlite/pending-asks', '@/infrastructure/sqlite/permissions', '@/infrastructure/sqlite/session-store', '@/infrastructure/runtime/environment',
  ],
  'packages/server/src/adapters/capek/runtime-configuration.ts': [
    '@/config', '@/infrastructure/runtime/environment',
  ],
  'packages/server/src/adapters/capek/sandbox.ts': ['@/infrastructure/sandbox'],
  'packages/server/src/adapters/capek/storage.ts': [
    '@/infrastructure/sqlite/message-store', '@/infrastructure/sqlite/session-store',
    '@/infrastructure/sqlite/queued-messages', '@/infrastructure/sqlite/attachments',
    '@/infrastructure/sqlite/response-formats', '@/infrastructure/sqlite/tool-output-artifacts',
    '@/infrastructure/sqlite/workspaces',
  ],
  'packages/server/src/adapters/capek/compaction-recovery.ts': [
    '@/transport/websocket/broadcast', '@/infrastructure/sqlite/message-store', '@/infrastructure/sqlite/session-store',
  ],
  'packages/server/src/adapters/capek/titles.ts': ['@/infrastructure/session-title'],
  'packages/server/src/adapters/capek/tool-source.ts': [
    '@/config', '@/infrastructure/mcp', '@/infrastructure/runtime/paths',
    '@/infrastructure/runtime/env-compat',
  ],
  'packages/server/src/adapters/capek/workspace.ts': [
    '@/infrastructure/sqlite/workspaces', '@/infrastructure/runtime/environment', '@/infrastructure/runtime/paths',
  ],
  'packages/server/src/adapters/capek/bindings.ts': [
    '@/infrastructure/runtime/workspace-dirs',
  ],
  'packages/server/src/adapters/jean2/session-repository.ts': [
    '@/infrastructure/sqlite/session-store', '@/infrastructure/sqlite/message-store', '@/infrastructure/sqlite/queued-messages', '@/infrastructure/sqlite/tool-output-artifacts', '@/infrastructure/sqlite/attachments', '@/infrastructure/sqlite/pending-asks', '@/infrastructure/sqlite/workspaces', '@/adapters/capek/compaction-recovery', '@/infrastructure/session-title',
  ],
  'packages/server/src/adapters/jean2/scheduled-job-repository.ts': [
    '@/infrastructure/sqlite/scheduled-job-store',
  ],
  'packages/server/src/adapters/jean2/scheduled-job-execution.ts': [
    '@/config', '@/infrastructure/config/preconfig', '@/infrastructure/scheduling/scheduled-job-runner',
    '@/infrastructure/sqlite/session-store', '@/infrastructure/sqlite/workspaces', '@/infrastructure/sqlite/scheduled-job-store',
  ],
  'packages/server/src/adapters/jean2/terminal.ts': [
    '@/infrastructure/sqlite/database', '@/infrastructure/sqlite/terminal-session-repository',
  ],
  'packages/server/src/adapters/jean2/agent-workspace.ts': [
    '@/infrastructure/config/preconfig', '@/infrastructure/sqlite/workspaces',
  ],
  'packages/server/src/adapters/jean2/workspace.ts': [
    '@/infrastructure/sqlite/workspaces', '@/infrastructure/sqlite/session-store', '@/infrastructure/sqlite/pinned-messages',
    '@/infrastructure/sqlite/scheduled-job-store', '@/transport/terminal', '@/infrastructure/mcp', '@/infrastructure/runtime/paths',
  ],

  'packages/server/src/adapters/jean2/tools.ts': [
    '@/config/tool-env', '@/config/errors',
  ],
  'packages/server/src/adapters/jean2/oauth.ts': [
    '@/infrastructure/oauth/oauth-manager',
  ],
  'packages/server/src/adapters/jean2/provider-credentials.ts': [
    '@/config/provider-credentials',
  ],
  'packages/server/src/adapters/jean2/mcp.ts': [
    '@/infrastructure/mcp/lifecycle', '@/infrastructure/sqlite/workspaces',
  ],
  'packages/server/src/adapters/jean2/files.ts': [
    '@/infrastructure/sqlite/workspaces', '@/infrastructure/filesystem/workspace-files',
    '@/infrastructure/filesystem/file-preview',
    '@/infrastructure/filesystem/file-mutations',
    '@/infrastructure/filesystem/git-status',
  ],
  'packages/server/src/adapters/jean2/notifications.ts': [
    '@/infrastructure/sqlite/notification-repository', '@/infrastructure/web-push/sender',
    '@/infrastructure/sqlite/session-store', '@/infrastructure/sqlite/scheduled-job-store', '@/infrastructure/sqlite/pending-asks', '@/infrastructure/runtime/environment',
  ],
  'packages/server/src/adapters/jean2/permissions.ts': ['@/infrastructure/sqlite/permissions'],
  'packages/server/src/adapters/jean2/tool-distribution.ts': [
    '@/infrastructure/tools/distribution',
  ],
  'packages/server/src/adapters/jean2/configuration.ts': [
    '@/config/models', '@/config/models-sync', '@/config/prompts',
    '@/config/preconfigs', '@/config/prompts-registry',
  ],
  'packages/server/src/adapters/jean2/maintenance.ts': ['@/infrastructure/sqlite/cleanup'],
  'packages/server/src/adapters/jean2/response-formats.ts': ['@/infrastructure/sqlite/response-formats'],
};

const sqliteExceptions: Record<string, string[]> = {};

const aiSdkExceptions: Record<string, string[]> = {};

// S2 exact per-file exceptions for transport wire handlers that still
// import legacy implementations. S3 retired the session lifecycle, queue,
// control, chat, and session handler entries; S4 retired the misc handler's
// capability-router import. S9 moved permission persistence behind the wired
// permission application.
// Rename compat (jean2 → prokopai): transport reads env through the runtime
// env-compat helper (PROKOPAI_ ?? JEAN2_ resolution) and the terminal
// manager through the same helper. Recorded until transport gets its own
// env-access port. Distinct from layerTransportLegacyExceptions, which stays
// pinned empty by the S4 ask-response gate.
const layerTransportRenameCompatExceptions: Record<string, string[]> = {
  'packages/server/src/transport/websocket/bun-adapter.ts': [
    '@/infrastructure/runtime/env-compat',
  ],
  'packages/server/src/transport/terminal/manager.ts': [
    '@/infrastructure/runtime/env-compat',
  ],
  'packages/server/src/transport/http/middleware/token.ts': [
    '@/infrastructure/runtime/env-compat',
  ],
};

const layerTransportLegacyExceptions: Record<string, string[]> = {};

// The HTTP app composition file needs three composition-root reads that the
// transport whitelist does not cover: the version constant for /api/info,
// the client-enabled feature flag, and the wired application fallback for
// callers that construct the app without a pre-built application. All are
// pinned here until createApp takes an explicit feature/config contract.
const layerTransportAppExceptions: Record<string, string[]> = {
  'packages/server/src/transport/http/app.ts': [
    '@/version',
    '@/infrastructure/runtime/environment',
    '@/infrastructure/runtime/env-compat',
    '@/infrastructure/runtime/client-assets',
    '@/bootstrap/application',
  ],
};

// HTTP route legacy exceptions are empty. The session route's presentation-helper
// exception is documented separately in the transport rule below.
const layerHttpRoutesLegacyExceptions: Record<string, string[]> = {};

// HTTP route legacy exceptions are empty. The session route uses relative
// presentation helpers that resolve inside the routes directory, so no
// transport presentation exceptions remain.

// The sandbox route moved from src/sandbox/routes.ts into the unified HTTP
// routes directory. It still reads the sandbox controller through the Capek
// contracts seam and the sandbox activation flag directly; both are pinned
// here until the route is migrated onto a sandbox application port.
const layerHttpRoutesSandboxExceptions: Record<string, string[]> = {
  'packages/server/src/transport/http/routes/sandbox.ts': [
    '@/adapters/capek/contracts', '@/infrastructure/sandbox',
  ],
};

// Bootstrap has no exceptions. The root reads process configuration and
// composes the layers without injecting a store accessor.
const layerBootstrapExceptions: Record<string, string[]> = {};

// S5 filesystem isolation: the filesystem infrastructure moves the exact
// pre-slice implementation. It owns no adapter imports; the two utility
// imports (binary detection and the HTTP error hierarchy used by editable
// file mutations) are the only exceptions, pinned by the S5 gate below.
const layerInfrastructureExceptions: Record<string, string[]> = {
  'packages/server/src/infrastructure/sqlite/database.ts': ['@/config', '@/utils/perf'],
  'packages/server/src/infrastructure/mcp/manager.ts': ['@/version'],
  'packages/server/src/infrastructure/daemon/index.ts': ['@/config'],
  'packages/server/src/infrastructure/session-title.ts': ['@/config'],
  'packages/server/src/infrastructure/tools/distribution.ts': ['@/config'],
  'packages/server/src/infrastructure/tools/tool-installer.ts': ['@/config'],
  'packages/server/src/infrastructure/providers/provider-credential-files.ts': [
    '@/config/errors', '@/config/files',
  ],
  'packages/server/src/infrastructure/oauth/oauth-manager.ts': [
    '@/transport/websocket/broadcast',
  ],
  'packages/server/src/infrastructure/providers/gmail.ts': [
    '@/transport/websocket/broadcast',
  ],
  'packages/server/src/infrastructure/web-push/retry-scheduler.ts': [
    '@/adapters/jean2/notifications',
  ],
};

const globalBaselineRules: DependencyRule[] = [
  {
    name: 'no-direct-compat-barrel',
    rationale: 'No server file may import @capekai/core/compat/jean2. S8 retired the barrel and this rule prevents reintroduction.',
    appliesTo: [serverSourceRoot],
    forbiddenSpecifiers: [{ exact: '@capekai/core/compat/jean2' }],
    exceptions: compatBarrelExceptions,
  },
  {
    name: 'bun-server-websocket-transport-only',
    rationale: 'ServerWebSocket belongs to transport. New consumers outside transport fail.',
    appliesTo: [serverSourceRoot],
    forbiddenSpecifiers: [{ exact: 'bun', name: 'ServerWebSocket' }],
    allowedInDirs: [transportDir],
    exceptions: serverWebSocketExceptions,
  },
  {
    name: 'sqlite-infrastructure-only',
    rationale: 'SQLite is infrastructure-only (built-in tools ship their own standalone databases). New consumers fail.',
    appliesTo: [serverSourceRoot],
    forbiddenSpecifiers: [{ exact: 'bun:sqlite' }],
    allowedInDirs: [infrastructureSqliteDir, builtinToolsDir],
    exceptions: sqliteExceptions,
  },
  {
    name: 'no-direct-ai-sdk',
    rationale: 'Model construction and invocation belong to Capek. Server AI SDK imports are forbidden.',
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
  {
    name: 'no-store-compat-surface',
    rationale: 'The store compatibility directory is removed. Server source must import actual owners.',
    appliesTo: [serverSourceRoot],
    forbiddenSpecifiers: [{ exact: '@/store' }, { prefix: '@/store/' }],
    exceptions: {},
  },
  {
    name: 'no-direct-capek-internals',
    rationale: 'Public Capek subpaths are the contract; internal paths are not resolvable outside packages/capek.',
    appliesTo: [serverSourceRoot, serverTestsRoot],
    forbiddenSpecifiers: [{ prefix: capekInternalPrefix }],
    exceptions: {},
  },
];

const layerRules: DependencyRule[] = [
  {
    name: 'layer-bootstrap',
    rationale: 'Bootstrap composes the six layers; relative imports must stay inside the layer directories.',
    appliesTo: [bootstrapDir],
    allowedResolvedDirs: layerDirs,
    exceptions: layerBootstrapExceptions,
  },
  {
    name: 'layer-transport',
    rationale: 'Transport may invoke application services. No SQLite, AI SDK, or Capek implementation imports. HTTP route files are governed by the stricter layer-http-routes rule; the app composition file carries pinned composition-root exceptions (version, client flag, wired application fallback).',
    appliesTo: [transportDir],
    excludedDirs: [routesDir],
    forbiddenSpecifiers: [
      { exact: 'bun:sqlite' },
      { exact: 'ai' },
      { prefix: '@ai-sdk/' },
      { prefix: '@capekai/core' },
    ],
    allowedResolvedDirs: [transportDir, applicationDir, adaptersCapekDir],
    exceptions: {
      ...layerTransportLegacyExceptions,
      ...layerTransportRenameCompatExceptions,
      ...layerTransportAppExceptions,
    },
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
    rationale: 'Infrastructure implements ports. It may import domains and application ports but not transport route handlers. The built-in tools catalog is a server-internal asset leaf (installer collision guard).',
    appliesTo: [infrastructureDir],
    allowedResolvedDirs: [infrastructureDir, domainsDir, applicationDir, adaptersCapekDir, builtinToolsDir],
    exceptions: layerInfrastructureExceptions,
  },
  {
    name: 'layer-adapters',
    rationale: 'Adapters translate Capek contracts and Jean2 ports. Transport-owned implementation exceptions are explicit and documented; the built-in tools catalog is a server-internal asset leaf (resolver and catalog seam).',
    appliesTo: [adaptersDir],
    allowedResolvedDirs: [adaptersDir, applicationDir, domainsDir, builtinToolsDir],
    exceptions: layerAdaptersLegacyExceptions,
  },
  {
    name: 'layer-adapters-capek-only',
    rationale: 'Only the Capek adapter directory translates Capek contracts. SDK and client-event adapters must not import @capekai/core.',
    appliesTo: [adaptersDir],
    forbiddenSpecifiers: [{ prefix: '@capekai/core' }],
    allowedInDirs: [adaptersCapekDir],
  },
  {
    name: 'layer-http-routes',
    rationale: 'HTTP routes invoke application use cases. No SQLite, AI SDK, or Capek implementation imports. No HTTP route legacy exceptions remain; the session route presentation helpers are documented separately in the transport rule.',
    appliesTo: [routesDir],
    forbiddenSpecifiers: [
      { exact: 'bun:sqlite' },
      { exact: 'ai' },
      { prefix: '@ai-sdk/' },
      { prefix: '@capekai/core' },
    ],
    allowedResolvedDirs: [routesDir, transportDir, applicationDir, utilsDir],
    exceptions: {
      ...layerHttpRoutesLegacyExceptions,
      ...layerHttpRoutesSandboxExceptions,
    },
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

  test('global baselines pass with only the recorded exceptions', () => {
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
    expect(result.staleExceptions).toEqual([]);
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
      'packages/server/src/transport/http/routes/sessions.ts imports ../../../store/sessions (value) [rule: layer-http-routes]',
      'packages/server/src/transport/http/routes/sessions.ts imports ai (value) [rule: layer-http-routes]',
      'packages/server/src/transport/http/routes/sessions.ts imports @capekai/core/compat/jean2 (value) [rule: layer-http-routes]',
      'packages/server/src/transport/http/routes/sessions.ts imports bun:sqlite (value) [rule: layer-http-routes]',
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
        path: resolve(serverSourceRoot, 'providers/codex.ts'),
        sourceText: "import { x } from '@capekai/core/compat/jean2';\n",
      },
      {
        path: resolve(routesDir, 'notifications.ts'),
        sourceText: "import { y } from '@capekai/core/compat/jean2';\n",
      },
    ];

    const result = evaluateRules(files, serverSourceRoot, repositoryRoot, [
      globalBaselineRules[0],
    ]);

    // S8 emptied the exception map, so every barrel consumer is flagged.
    expect(result.violations).toEqual([
      'packages/server/src/providers/codex.ts imports @capekai/core/compat/jean2 (value) [rule: no-direct-compat-barrel]',
      'packages/server/src/transport/http/routes/notifications.ts imports @capekai/core/compat/jean2 (value) [rule: no-direct-compat-barrel]',
    ]);
    expect(compatBarrelExceptions).toEqual({});
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
      'packages/server/src/transport/http/routes/sessions.ts imports @/store/sessions (value) [rule: layer-http-routes]',
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
      'packages/server/src/core/chat-handler.ts imports bun (type) [rule: bun-server-websocket-transport-only]',
      'packages/server/src/something/new-socket-file.ts imports bun (type) [rule: bun-server-websocket-transport-only]',
      'packages/server/src/something/new-aliased-socket-file.ts imports bun (type) [rule: bun-server-websocket-transport-only]',
    ]);
  });

  test('S2 gate: no source file outside transport imports ServerWebSocket and no exceptions remain', () => {
    expect(serverWebSocketExceptions).toEqual({});

    const result = evaluateRules(
      scanDirectory(serverSourceRoot),
      serverSourceRoot,
      repositoryRoot,
      [globalBaselineRules[1]],
    );

    expect(result.violations).toEqual([]);
    expect(result.staleExceptions).toEqual([]);
  });

  test('S2 gate: transport bun imports are confined to the socket and terminal adapters', () => {
    const allowedTransportBunFiles = [
      'packages/server/src/transport/websocket/bun-adapter.ts',
      'packages/server/src/transport/terminal/event-manager.ts',
      'packages/server/src/transport/terminal/manager.ts',
    ];

    const bunImports = scanDirectory(serverSourceRoot)
      .flatMap((file) => parseImports(file.sourceText, file.path).map((imp) => ({ file, imp })))
      .filter(({ imp }) => imp.specifier === 'bun' && imp.names.includes('ServerWebSocket'));

    const filesWithBun = bunImports.map(({ file }) => relative(repositoryRoot, file.path));
    expect(filesWithBun.sort()).toEqual(allowedTransportBunFiles.sort());
  });

  test('S3 gate: session and control wire handlers import neither store nor Capek implementations', () => {
    const s3HandlerFiles = [
      'packages/server/src/transport/websocket/chat-handler.ts',
      'packages/server/src/transport/websocket/session-handler.ts',
      'packages/server/src/transport/websocket/message-router.ts',
      'packages/server/src/transport/websocket/handlers/control.ts',
      'packages/server/src/transport/websocket/handlers/queue.ts',
      'packages/server/src/transport/websocket/handlers/session-lifecycle.ts',
      'packages/server/src/transport/http/routes/sessions.ts',
    ];

    for (const repoFile of s3HandlerFiles) {
      expect(Object.keys(layerTransportLegacyExceptions)).not.toContain(repoFile);
      const compatList = compatBarrelExceptions[repoFile] ?? [];
      expect(compatList).toEqual([]);
    }

    // The session route's presentation helpers are relative imports inside the
    // routes directory; no transport presentation exception remains.
    expect(layerHttpRoutesLegacyExceptions['packages/server/src/transport/http/routes/sessions.ts']).toBeUndefined();

    const imports = scanDirectory(serverSourceRoot)
      .flatMap((file) => parseImports(file.sourceText, file.path).map((imp) => ({ file, imp })));

    const offenders: string[] = [];
    for (const { file, imp } of imports) {
      const repoFile = relative(repositoryRoot, file.path);
      if (!s3HandlerFiles.includes(repoFile)) continue;
      if (imp.specifier === '@/store' || imp.specifier.startsWith('@/store/')) {
        offenders.push(`${repoFile} imports ${imp.specifier}`);
      }
      if (imp.specifier.startsWith('@capekai/core')) {
        offenders.push(`${repoFile} imports ${imp.specifier}`);
      }
    }
    expect(offenders).toEqual([]);

    expect(Object.keys(layerHttpRoutesLegacyExceptions)).not.toContain('packages/server/src/transport/http/routes/sessions.ts');
  });

  test('S9 gate: permission wire handlers use the wired permission application', () => {
    const handlerPath = resolve(transportDir, 'websocket/handlers/permissions.ts');
    const file = scanDirectory(serverSourceRoot).find((candidate) => candidate.path === handlerPath);
    expect(file).toBeDefined();

    const imports = parseImports(file!.sourceText, file!.path);
    expect(imports.map((imp) => imp.specifier).sort()).toEqual([
      '../application',
      '../connection-id',
      '../router-context',
      '@prokopai/sdk',
    ].sort());
    expect(imports.some((imp) => imp.specifier === '@/store/permissions')).toBe(false);
    expect(file!.sourceText).toContain('requireWireApplication().permissions.list');
    expect(file!.sourceText).toContain('requireWireApplication().permissions.revoke');
    expect(file!.sourceText).toContain('requireWireApplication().permissions.revokeAll');
  });

  test('S9 gate: Jean2 permission adapter is the only store-backed permission seam', () => {
    const adapterPath = resolve(adaptersDir, 'jean2/permissions.ts');
    const file = scanDirectory(serverSourceRoot).find((candidate) => candidate.path === adapterPath);
    expect(file).toBeDefined();
    expect(Object.keys(layerAdaptersLegacyExceptions)).toContain(
      'packages/server/src/adapters/jean2/permissions.ts',
    );
    expect(parseImports(file!.sourceText, file!.path).map((imp) => imp.specifier).sort()).toEqual([
      '@/application/ports/permissions',
      '@/infrastructure/sqlite/permissions',
    ].sort());
  });

  test('S5 gate: the capek session-search adapter imports only capek contracts and application ports', () => {
    expect(Object.keys(layerAdaptersLegacyExceptions)).not.toContain(
      'packages/server/src/adapters/capek/session-search.ts',
    );

    const adapterPath = resolve(adaptersCapekDir, 'session-search.ts');
    const file = scanDirectory(serverSourceRoot).find((candidate) => candidate.path === adapterPath);
    expect(file).toBeDefined();
    const imports = parseImports(file!.sourceText, file!.path);

    const allowedSpecifiers = [
      '@capekai/core/hosts',
      '@prokopai/sdk',
      '@/application/ports/session-search',
    ];
    expect(imports.map((imp) => imp.specifier).sort()).toEqual([...allowedSpecifiers].sort());

    const forbiddenPrefixes = ['@/store', '@/session-search', '@/infrastructure', 'bun:sqlite'];
    for (const imp of imports) {
      for (const prefix of forbiddenPrefixes) {
        expect(imp.specifier.startsWith(prefix)).toBe(false);
      }
    }
  });

  test('S5 gate: the capek session-search adapter flags store and infrastructure imports', () => {
    const files: ScannedFile[] = [
      {
        path: resolve(adaptersCapekDir, 'session-search.ts'),
        sourceText: [
          "import { configureSessionSearchHost } from '@capekai/core/compat/jean2';",
          "import { getDatabase } from '@/store';",
          "import { searchMessages } from '@/infrastructure/sqlite/session-search-query-repository';",
        ].join('\n'),
      },
    ];

    const result = evaluateRules(files, serverSourceRoot, repositoryRoot, layerRules);

    expect(result.violations).toEqual([
      'packages/server/src/adapters/capek/session-search.ts imports @/store (value) [rule: layer-adapters]',
      'packages/server/src/adapters/capek/session-search.ts imports @/infrastructure/sqlite/session-search-query-repository (value) [rule: layer-adapters]',
    ]);
  });

  test('S4 gate: the scheduler route invokes only the scheduling application and presentation helpers', () => {
    expect(Object.keys(layerHttpRoutesLegacyExceptions)).not.toContain(
      'packages/server/src/transport/http/routes/scheduler.ts',
    );

    const routePath = resolve(routesDir, 'scheduler.ts');
    const file = scanDirectory(serverSourceRoot).find((candidate) => candidate.path === routePath);
    expect(file).toBeDefined();
    const imports = parseImports(file!.sourceText, file!.path);

    const allowedSpecifiers = [
      'hono',
      '@prokopai/sdk',
      '@/application/scheduling',
      './validate',
      './schemas',
      '@/application/http-errors',
    ];
    expect(imports.map((imp) => imp.specifier).sort()).toEqual([...allowedSpecifiers].sort());

    const forbiddenPrefixes = ['@/store', '@/scheduler', '@capekai/core', '@/infrastructure', 'bun:sqlite'];
    for (const imp of imports) {
      for (const prefix of forbiddenPrefixes) {
        expect(imp.specifier.startsWith(prefix)).toBe(false);
      }
    }
  });

  test('S4 gate: the scheduler route flags store and runner imports', () => {
    const files: ScannedFile[] = [
      {
        path: resolve(routesDir, 'scheduler.ts'),
        sourceText: [
          "import { createScheduledJob } from '@/store/scheduled-jobs';",
          "import { runScheduledJob } from '@/scheduler/runner';",
        ].join('\n'),
      },
    ];

    const result = evaluateRules(files, serverSourceRoot, repositoryRoot, layerRules);
    expect(result.violations).toEqual([
      'packages/server/src/transport/http/routes/scheduler.ts imports @/store/scheduled-jobs (value) [rule: layer-http-routes]',
      'packages/server/src/transport/http/routes/scheduler.ts imports @/scheduler/runner (value) [rule: layer-http-routes]',
    ]);
  });

  test('S4/S5 gate: the capek scheduler adapter imports only capek contracts and application ports', () => {
    expect(Object.keys(layerAdaptersLegacyExceptions)).not.toContain(
      'packages/server/src/adapters/capek/scheduler.ts',
    );

    const adapterPath = resolve(adaptersCapekDir, 'scheduler.ts');
    const file = scanDirectory(serverSourceRoot).find((candidate) => candidate.path === adapterPath);
    expect(file).toBeDefined();
    const imports = parseImports(file!.sourceText, file!.path);

    const allowedSpecifiers = [
      '@capekai/core/hosts',
      '@/application/ports/scheduling',
    ];
    expect(imports.map((imp) => imp.specifier).sort()).toEqual([...allowedSpecifiers].sort());

    const forbiddenPrefixes = ['@/store', '@/scheduler', '@/infrastructure', 'bun:sqlite'];
    for (const imp of imports) {
      for (const prefix of forbiddenPrefixes) {
        expect(imp.specifier.startsWith(prefix)).toBe(false);
      }
    }
  });

  test('S4/S5 gate: the capek scheduler adapter flags store and infrastructure imports', () => {
    const files: ScannedFile[] = [
      {
        path: resolve(adaptersCapekDir, 'scheduler.ts'),
        sourceText: [
          "import { configureSchedulerHost } from '@capekai/core/compat/jean2';",
          "import { getScheduledJob } from '@/store/scheduled-jobs';",
          "import { runScheduledJob } from '@/scheduler/runner';",
        ].join('\n'),
      },
    ];

    const result = evaluateRules(files, serverSourceRoot, repositoryRoot, layerRules);
    expect(result.violations).toEqual([
      'packages/server/src/adapters/capek/scheduler.ts imports @/store/scheduled-jobs (value) [rule: layer-adapters]',
      'packages/server/src/adapters/capek/scheduler.ts imports @/scheduler/runner (value) [rule: layer-adapters]',
    ]);
  });

  test('S9 gate: the scheduled-job store owns lazy repository wiring', () => {
    const storePath = resolve(infrastructureSqliteDir, 'scheduled-job-store.ts');
    const file = scanDirectory(serverSourceRoot).find((candidate) => candidate.path === storePath);
    expect(file).toBeDefined();

    const imports = parseImports(file!.sourceText, file!.path);
    expect(imports.map((imp) => imp.specifier).sort()).toEqual([
      '@prokopai/sdk',
      '@/application/ports/scheduling',
      './database',
      './scheduled-job-repository',
    ].sort());
    expect(file!.sourceText).not.toContain('@/store');
  });

  test('S5 gate: the infrastructure scheduled-job repository imports only ports and the scheduling domain', () => {
    const repoPath = resolve(infrastructureSqliteDir, 'scheduled-job-repository.ts');
    const file = scanDirectory(serverSourceRoot).find((candidate) => candidate.path === repoPath);
    expect(file).toBeDefined();

    const imports = parseImports(file!.sourceText, file!.path);
    expect(imports.map((imp) => imp.specifier).sort()).toEqual([
      '@prokopai/sdk',
      '@/application/ports/scheduling',
      '@/domains/scheduling/job-lifecycle',
      '@/domains/scheduling/schedule',
      'bun:sqlite',
      'crypto',
    ].sort());
  });

  test('S9 gate: the capek compaction-recovery adapter wires domain recovery to owned storage and broadcasts', () => {
    const adapterPath = resolve(adaptersCapekDir, 'compaction-recovery.ts');
    const file = scanDirectory(serverSourceRoot).find((candidate) => candidate.path === adapterPath);
    expect(file).toBeDefined();

    const imports = parseImports(file!.sourceText, file!.path);
    expect([...new Set(imports.map((imp) => imp.specifier))].sort()).toEqual([
      '@capekai/core/execution',
      '@/application/ports/session',
      '@/adapters/capek/events',
      '@/transport/websocket/broadcast',
      '@/infrastructure/sqlite/message-store',
      '@/infrastructure/sqlite/session-store',
    ].sort());

    const sourceText = file!.sourceText;
    expect(sourceText).toContain('reconcileSessionCompactionWithDeps');
    expect(sourceText).toContain('reconcileAllSessionsCompactionWithDeps');
    expect(sourceText).toContain('reconcileSessionWithDeps');
    expect(sourceText).toContain('reconcileAllSessionsWithDeps');
    expect(sourceText).toContain('export interface ReconcileOptions');
    expect(sourceText).not.toContain('@/store');
  });

  test('S5 gate: the compaction recovery port is fulfilled without SQL crossing into the capek domain', () => {
    // The inward-facing port lives with the other session ports; the Capek
    // domain depends on deps only. The server store remains the current
    // query provider until the remaining storage migration.
    const portsPath = resolve(applicationDir, 'ports/session.ts');
    const file = scanDirectory(serverSourceRoot).find((candidate) => candidate.path === portsPath);
    expect(file).toBeDefined();
    expect(file!.sourceText).toContain('export interface CompactionRecoveryPort');
    expect(file!.sourceText).toContain('listOrphanedCompactionTriggers(sessionId: string): Message[]');
  });

  test('S4 gate: web-push dispatch consumes the scheduling domain notification policy', () => {
    // The scheduled-run eligibility policy is shared with the scheduling
    // domain through the Jean2 notification adapter; the compat dispatch
    // module forwards to the adapter-built application.
    const adapterPath = resolve(adaptersDir, 'jean2/notifications.ts');
    const adapterFile = scanDirectory(serverSourceRoot).find((candidate) => candidate.path === adapterPath);
    expect(adapterFile).toBeDefined();

    const imports = parseImports(adapterFile!.sourceText, adapterFile!.path);
    expect(
      imports.some((imp) => imp.specifier === '@/domains/scheduling/notifications'),
    ).toBe(true);
  });

  test('S4 gate: scheduling domain files import neither transport nor infrastructure', () => {
    const result = evaluateRules(
      scanDirectory(serverSourceRoot),
      serverSourceRoot,
      repositoryRoot,
      [layerRules[3]], // layer-domains
    );

    const schedulingViolations = result.violations.filter((v) =>
      v.includes('packages/server/src/domains/scheduling/'),
    );
    expect(schedulingViolations).toEqual([]);
  });

  test('S4 gate: the agents route invokes only the agents application and presentation helpers', () => {
    expect(Object.keys(layerHttpRoutesLegacyExceptions)).not.toContain(
      'packages/server/src/transport/http/routes/agents.ts',
    );

    const routePath = resolve(routesDir, 'agents.ts');
    const file = scanDirectory(serverSourceRoot).find((candidate) => candidate.path === routePath);
    expect(file).toBeDefined();
    const imports = parseImports(file!.sourceText, file!.path);

    const allowedSpecifiers = [
      'hono',
      '@/application/agents',
      './validate',
      './schemas',
      '@/application/http-errors',
    ];
    expect(imports.map((imp) => imp.specifier).sort()).toEqual([...allowedSpecifiers].sort());

    const forbiddenPrefixes = ['@/store', '@/agents', '@/infrastructure', 'bun:sqlite', '@/core'];
    for (const imp of imports) {
      for (const prefix of forbiddenPrefixes) {
        expect(imp.specifier.startsWith(prefix)).toBe(false);
      }
    }
  });

  test('S4 gate: the agents route flags store and filesystem imports', () => {
    const files: ScannedFile[] = [
      {
        path: resolve(routesDir, 'agents.ts'),
        sourceText: [
          "import { listAgents } from '@/agents/storage';",
          "import { getAgentMemory } from '@/agents/memory';",
        ].join('\n'),
      },
    ];

    const result = evaluateRules(files, serverSourceRoot, repositoryRoot, layerRules);
    expect(result.violations).toEqual([
      'packages/server/src/transport/http/routes/agents.ts imports @/agents/storage (value) [rule: layer-http-routes]',
      'packages/server/src/transport/http/routes/agents.ts imports @/agents/memory (value) [rule: layer-http-routes]',
    ]);
  });

  test('S4 gate: the jean2 agent adapter imports only the preconfig and workspace store implementations', () => {
    const adapterPath = resolve(adaptersDir, 'jean2/agent-workspace.ts');
    const file = scanDirectory(serverSourceRoot).find((candidate) => candidate.path === adapterPath);
    expect(file).toBeDefined();

    const imports = parseImports(file!.sourceText, file!.path);
    expect(imports.map((imp) => imp.specifier).sort()).toEqual([
      '@/application/ports/agents',
      '@/infrastructure/config/preconfig',
      '@/infrastructure/sqlite/workspaces',
    ].sort());
  });

  test('S4 gate: retired agent compatibility modules are absent and unimported', () => {
    const files = scanDirectory(serverSourceRoot);
    const retired = [
      'packages/server/src/agents/memory.ts',
      'packages/server/src/agents/storage.ts',
    ] as const;
    const retiredPaths = new Set(retired.map((path) => resolve(repositoryRoot, path)));
    const imports = files.flatMap((file) => parseImports(file.sourceText, file.path));

    for (const path of retired) {
      expect(files.some((file) => relative(repositoryRoot, file.path) === path)).toBe(false);
    }
    for (const imp of imports) {
      expect(imp.specifier.startsWith('@/agents')).toBe(false);
      const resolved = resolveLocalSpecifier(imp.specifier, imp.file, serverSourceRoot);
      expect(resolved === null || !retiredPaths.has(resolved)).toBe(true);
    }
  });

  test('S4 gate: the infrastructure agent directory adapter imports only the directory port', () => {
    const infraPath = resolve(infrastructureDir, 'agents/agent-directory-filesystem.ts');
    const file = scanDirectory(serverSourceRoot).find((candidate) => candidate.path === infraPath);
    expect(file).toBeDefined();

    const imports = parseImports(file!.sourceText, file!.path);
    expect(imports.map((imp) => imp.specifier).sort()).toEqual([
      '@/application/ports/agents',
      'fs',
      'fs/promises',
    ].sort());
  });

  test('S4 gate: agents domain files import neither transport nor infrastructure', () => {
    const result = evaluateRules(
      scanDirectory(serverSourceRoot),
      serverSourceRoot,
      repositoryRoot,
      [layerRules[3]], // layer-domains
    );

    const agentsViolations = result.violations.filter((v) =>
      v.includes('packages/server/src/domains/agents/'),
    );
    expect(agentsViolations).toEqual([]);
  });

  test('S4 gate: the transport control registry implements the controller domain through the application port layer', () => {
    const registryPath = resolve(transportDir, 'websocket/control-registry.ts');
    const file = scanDirectory(serverSourceRoot).find((candidate) => candidate.path === registryPath);
    expect(file).toBeDefined();

    const imports = parseImports(file!.sourceText, file!.path);
    expect(
      imports.some((imp) =>
        imp.specifier === '@/application/ports/control'
        && imp.names.includes('applyClaim')
        && imp.names.includes('decideControllerGate')
        && imp.names.includes('applyResume')
        && imp.names.includes('decideDisconnectTransition')
      ),
    ).toBe(true);
    // Dependency direction: transport reaches the policy only through the
    // application port layer, never by importing the domain directly.
    for (const imp of imports) {
      expect(imp.specifier.startsWith('@/domains')).toBe(false);
    }
  });

  test('S4 gate: the controller domain imports only SDK types and sibling modules', () => {
    const allowedSpecifiers = [
      '@prokopai/sdk',
      './policy',
      './ask-routing',
      './index',
    ];
    const violations: string[] = [];
    for (const file of scanDirectory(serverSourceRoot)) {
      if (!file.path.includes('domains/controllers')) continue;
      for (const imp of parseImports(file.sourceText, file.path)) {
        if (!allowedSpecifiers.includes(imp.specifier)) {
          violations.push(`${relative(repositoryRoot, file.path)} imports ${imp.specifier}`);
        }
      }
    }
    expect(violations).toEqual([]);

    // The layer-domains rule must pass for the controller domain.
    const result = evaluateRules(
      scanDirectory(serverSourceRoot),
      serverSourceRoot,
      repositoryRoot,
      [layerRules[3]], // layer-domains
    );
    const controllerViolations = result.violations.filter((v) =>
      v.includes('packages/server/src/domains/controllers/'),
    );
    expect(controllerViolations).toEqual([]);
  });

  test('S4 gate: the application control port re-exports the controller domain policy', () => {
    const portPath = resolve(applicationDir, 'ports/control.ts');
    const file = scanDirectory(serverSourceRoot).find((candidate) => candidate.path === portPath);
    expect(file).toBeDefined();

    const imports = parseImports(file!.sourceText, file!.path);
    expect(imports.map((imp) => imp.specifier).sort()).toEqual([
      '@prokopai/sdk',
      '@/domains/controllers',
    ].sort());
    const domainImport = imports.find((imp) => imp.specifier === '@/domains/controllers');
    expect(domainImport?.kind).toBe('export-from');
  });

  test('S4 gate: the ask response handler uses the controller domain eligibility through the port, not the legacy capability router', () => {
    const miscPath = resolve(transportDir, 'websocket/handlers/misc.ts');
    const file = scanDirectory(serverSourceRoot).find((candidate) => candidate.path === miscPath);
    expect(file).toBeDefined();

    const imports = parseImports(file!.sourceText, file!.path);
    expect(
      imports.some((imp) =>
        imp.specifier === '@/application/ports/control'
        && imp.names.includes('checkAskResponseEligibility')
      ),
    ).toBe(true);
    expect(
      imports.some((imp) => imp.specifier === '@/core/capability-router'),
    ).toBe(false);
    expect(layerTransportLegacyExceptions).toEqual({});
  });

  test('S9 gate: the capability router is absent and cannot be reintroduced', () => {
    const files = scanDirectory(serverSourceRoot);
    const retiredPath = resolve(serverSourceRoot, 'core/capability-router.ts');
    const retiredPaths = new Set([retiredPath, retiredPath.replace(/\.tsx?$/, '')]);
    const imports = files.flatMap((file) => parseImports(file.sourceText, file.path));

    expect(files.some((file) => file.path === retiredPath)).toBe(false);
    for (const imp of imports) {
      expect(imp.specifier).not.toBe('@/core/capability-router');
      const resolved = resolveLocalSpecifier(imp.specifier, imp.file, serverSourceRoot);
      expect(resolved === null || !retiredPaths.has(resolved)).toBe(true);
    }
  });

  test('S9 gate: the tool-output artifact implementation is owned by SQLite infrastructure', () => {
    const storePath = resolve(infrastructureSqliteDir, 'tool-output-artifacts.ts');
    const file = scanDirectory(serverSourceRoot).find((candidate) => candidate.path === storePath);
    expect(file).toBeDefined();

    expect(parseImports(file!.sourceText, file!.path).map((imp) => imp.specifier).sort()).toEqual([
      '@/adapters/capek/contracts',
      './database',
      'node:crypto',
    ].sort());
    expect(file!.sourceText).not.toContain('@/store');
  });

  test('S9 gate: session and message store wiring is owned by SQLite infrastructure', () => {
    const owners = [
      [
        'sessions',
        resolve(infrastructureSqliteDir, 'session-store.ts'),
        [
          '@/application/ports/session-message',
          '@/infrastructure/session-search/fts',
          '@prokopai/sdk',
          './attachments',
          './database',
          './session-repository',
          './workspaces',
          'fs',
          'node:os',
          'node:path',
        ],
        'createSessionRepository',
      ],
      [
        'messages',
        resolve(infrastructureSqliteDir, 'message-store.ts'),
        [
          '@/application/ports/session-message',
          '@/infrastructure/session-search/fts-projector',
          '@prokopai/sdk',
          './database',
          './message-repository',
          './session-store',
        ],
        'createMessageRepository',
      ],
    ] as const;

    for (const [label, path, expectedSpecifiers, factory] of owners) {
      const file = scanDirectory(serverSourceRoot).find((candidate) => candidate.path === path);
      expect(file, label).toBeDefined();
      expect([...new Set(parseImports(file!.sourceText, file!.path).map((imp) => imp.specifier))].sort(), label)
        .toEqual([...expectedSpecifiers].sort());
      expect(file!.sourceText, label).not.toContain('@/store');
      expect(file!.sourceText, label).toContain(factory);
    }
  });

  test('S5 gate: the infrastructure session and message repositories import only the inward port and SQLite types', () => {
    for (const path of [
      resolve(infrastructureSqliteDir, 'session-repository.ts'),
      resolve(infrastructureSqliteDir, 'message-repository.ts'),
      resolve(infrastructureSqliteDir, 'session-message-schema.ts'),
    ]) {
      const file = scanDirectory(serverSourceRoot).find((candidate) => candidate.path === path);
      expect(file).toBeDefined();

      const imports = parseImports(file!.sourceText, file!.path);
      const specifiers = [...new Set(imports.map((imp) => imp.specifier))].sort();
      if (path.endsWith('session-message-schema.ts')) {
        expect(specifiers).toEqual(['bun:sqlite']);
      } else {
        expect(specifiers).toEqual([
          '@/application/ports/session-message',
          '@prokopai/sdk',
          'bun:sqlite',
        ]);
        // The Database import is type-only; no runtime SQLite API leaks
        // beyond the injected accessor.
        const sqliteImports = imports.filter((imp) => imp.specifier === 'bun:sqlite');
        expect(sqliteImports.every((imp) => imp.kind === 'type')).toBe(true);
      }
      // Infrastructure owns no store or FTS implementation imports.
      expect(file!.sourceText).not.toContain("@/store");
      expect(file!.sourceText).not.toContain("@/session-search");
    }
  });

  test('S4 gate: the workspaces route invokes only the workspace application and presentation helpers', () => {
    expect(Object.keys(layerHttpRoutesLegacyExceptions)).not.toContain(
      'packages/server/src/transport/http/routes/workspaces.ts',
    );

    const routePath = resolve(routesDir, 'workspaces.ts');
    const file = scanDirectory(serverSourceRoot).find((candidate) => candidate.path === routePath);
    expect(file).toBeDefined();
    const imports = parseImports(file!.sourceText, file!.path);

    const allowedSpecifiers = [
      'hono',
      '@prokopai/sdk',
      '@/application/workspaces',
      './validate',
      './schemas',
      '@/application/http-errors',
    ];
    expect(imports.map((imp) => imp.specifier).sort()).toEqual([...allowedSpecifiers].sort());

    const forbiddenPrefixes = ['@/store', '@/services', '@/mcp', '@/paths', '@/core', 'fs', 'fs/promises', 'path'];
    for (const imp of imports) {
      for (const prefix of forbiddenPrefixes) {
        expect(imp.specifier.startsWith(prefix)).toBe(false);
      }
    }
  });

  test('S4 gate: the workspaces route flags store, filesystem, terminal, and mcp imports', () => {
    const files: ScannedFile[] = [
      {
        path: resolve(routesDir, 'workspaces.ts'),
        sourceText: [
          "import { listWorkspaces } from '@/store';",
          "import { mkdirSync } from 'fs';",
          "import { getTerminalManager } from '@/services/terminal';",
          "import * as mcp from '@/mcp';",
        ].join('\n'),
      },
    ];

    const result = evaluateRules(files, serverSourceRoot, repositoryRoot, layerRules);
    expect(result.violations).toEqual([
      'packages/server/src/transport/http/routes/workspaces.ts imports @/store (value) [rule: layer-http-routes]',
      'packages/server/src/transport/http/routes/workspaces.ts imports @/services/terminal (value) [rule: layer-http-routes]',
      'packages/server/src/transport/http/routes/workspaces.ts imports @/mcp (value) [rule: layer-http-routes]',
    ]);
  });

  test('S4 gate: the jean2 workspace adapter imports only the store, terminal, mcp, paths, and policy implementations', () => {
    const adapterPath = resolve(adaptersDir, 'jean2/workspace.ts');
    const file = scanDirectory(serverSourceRoot).find((candidate) => candidate.path === adapterPath);
    expect(file).toBeDefined();

    const imports = parseImports(file!.sourceText, file!.path);
    expect(imports.map((imp) => imp.specifier).sort()).toEqual([
      '@/adapters/capek/workspace-paths',
      '@/application/ports/workspace',
      '@/infrastructure/mcp',
      '@/infrastructure/runtime/paths',
      '@/transport/terminal',
      '@/infrastructure/sqlite/pinned-messages',
      '@/infrastructure/sqlite/scheduled-job-store',
      '@/infrastructure/sqlite/session-store',
      '@/infrastructure/sqlite/workspaces',
      'fs',
    ].sort());
  });

  test('S4 gate: the workspace domain imports only SDK types and sibling modules', () => {
    const allowedSpecifiers = [
      '@prokopai/sdk',
      './record',
      './index',
    ];
    const violations: string[] = [];
    for (const file of scanDirectory(serverSourceRoot)) {
      if (!file.path.includes('domains/workspaces')) continue;
      for (const imp of parseImports(file.sourceText, file.path)) {
        if (!allowedSpecifiers.includes(imp.specifier)) {
          violations.push(`${relative(repositoryRoot, file.path)} imports ${imp.specifier}`);
        }
      }
    }
    expect(violations).toEqual([]);

    const result = evaluateRules(
      scanDirectory(serverSourceRoot),
      serverSourceRoot,
      repositoryRoot,
      [layerRules[3]], // layer-domains
    );
    const workspaceViolations = result.violations.filter((v) =>
      v.includes('packages/server/src/domains/workspaces/'),
    );
    expect(workspaceViolations).toEqual([]);
  });

  test('S5 gate: file mutations consume the Capek workspace policy through the adapter port', () => {
    const mutationsPath = resolve(serverSourceRoot, 'adapters/jean2/files.ts');
    const file = scanDirectory(serverSourceRoot).find((candidate) => candidate.path === mutationsPath);
    expect(file).toBeDefined();

    const imports = parseImports(file!.sourceText, file!.path);
    expect(
      imports.some((imp) =>
        imp.specifier === '@/adapters/capek/workspace-paths'
        && imp.names.includes('workspacePathPolicyPort')
      ),
    ).toBe(true);
    expect(
      imports.some((imp) => imp.specifier === '@/infrastructure/filesystem/file-mutations'),
    ).toBe(true);
    expect(imports.some((imp) => imp.specifier === '@/domains/workspaces')).toBe(false);
    // The editable ops are built once over the policy and the exact
    // pre-slice operations stay in the infrastructure module.
    expect(file!.sourceText).toContain('createEditableFileOps(workspacePathPolicyPort)');
    const infraPath = resolve(infrastructureDir, 'filesystem/file-mutations.ts');
    const infraFile = scanDirectory(serverSourceRoot).find((candidate) => candidate.path === infraPath);
    expect(infraFile).toBeDefined();
    expect(infraFile!.sourceText).toContain('isPathInside');
    expect(infraFile!.sourceText).toContain('selectEditableRoot');
    expect(infraFile!.sourceText).toContain('resolveCandidatePath');
  });

  test('S5 gate: file preview containment resolves through the Capek workspace policy', () => {
    const previewPath = resolve(serverSourceRoot, 'adapters/jean2/files.ts');
    const file = scanDirectory(serverSourceRoot).find((candidate) => candidate.path === previewPath);
    expect(file).toBeDefined();

    const sourceText = file!.sourceText;
    expect(sourceText).toContain('createFilePreview(workspacePathPolicyPort)');
    expect(sourceText).not.toContain('fullPath.startsWith(allowed)');

    const infraPath = resolve(infrastructureDir, 'filesystem/file-preview.ts');
    const infraFile = scanDirectory(serverSourceRoot).find((candidate) => candidate.path === infraPath);
    expect(infraFile).toBeDefined();
    expect(infraFile!.sourceText).toContain('containment.isPathWithinWorkspace');
    expect(infraFile!.sourceText).not.toContain('fullPath.startsWith(allowed)');
  });

  test('S5 gate: the files route invokes only the files application and presentation helpers', () => {
    expect(Object.keys(layerHttpRoutesLegacyExceptions)).not.toContain(
      'packages/server/src/transport/http/routes/files.ts',
    );

    const routePath = resolve(routesDir, 'files.ts');
    const file = scanDirectory(serverSourceRoot).find((candidate) => candidate.path === routePath);
    expect(file).toBeDefined();
    const imports = parseImports(file!.sourceText, file!.path);

    const allowedSpecifiers = [
      'hono',
      'fs',
      'os',
      'path',
      '@prokopai/sdk',
      '@/application/files',
      '@/application/http-errors',
      './schemas',
      './validate',
    ];
    expect(imports.map((imp) => imp.specifier).sort()).toEqual([...allowedSpecifiers].sort());

    const forbiddenPrefixes = ['@/store', '@/services', '@/utils/paths'];
    for (const imp of imports) {
      for (const prefix of forbiddenPrefixes) {
        expect(imp.specifier.startsWith(prefix)).toBe(false);
      }
    }
    expect(file!.sourceText).toContain('registerFileRoutes(app: Hono, files: FilesApplication)');
  });

  test('S5 gate: the files route flags store and service imports', () => {
    const files: ScannedFile[] = [
      {
        path: resolve(routesDir, 'files.ts'),
        sourceText: [
          "import { getWorkspace } from '@/store';",
          "import { listDirectory } from '@/services/files';",
        ].join('\n'),
      },
    ];

    const result = evaluateRules(files, serverSourceRoot, repositoryRoot, layerRules);

    expect(result.violations).toEqual([
      'packages/server/src/transport/http/routes/files.ts imports @/store (value) [rule: layer-http-routes]',
      'packages/server/src/transport/http/routes/files.ts imports @/services/files (value) [rule: layer-http-routes]',
    ]);
  });

  test('S5 gate: the jean2 files adapter imports only the store, the workspace path policy, and the filesystem infrastructure', () => {
    const adapterPath = resolve(adaptersDir, 'jean2/files.ts');
    const file = scanDirectory(serverSourceRoot).find((candidate) => candidate.path === adapterPath);
    expect(file).toBeDefined();

    const imports = parseImports(file!.sourceText, file!.path);
    expect(imports.map((imp) => imp.specifier).sort()).toEqual([
      '@/adapters/capek/workspace-paths',
      '@/application/ports/files',
      '@/infrastructure/filesystem/file-mutations',
      '@/infrastructure/filesystem/file-preview',
      '@/infrastructure/filesystem/git-status',
      '@/infrastructure/filesystem/workspace-files',
      '@/infrastructure/sqlite/workspaces',
    ].sort());
  });

  test('S5 gate: the files application imports only its port, SDK types, and path helpers', () => {
    const filesPath = resolve(applicationDir, 'files/index.ts');
    const file = scanDirectory(serverSourceRoot).find((candidate) => candidate.path === filesPath);
    expect(file).toBeDefined();

    const imports = parseImports(file!.sourceText, file!.path);
    expect(imports.map((imp) => imp.specifier).sort()).toEqual([
      '@prokopai/sdk',
      '../ports/files',
      'path',
    ].sort());
    expect(file!.sourceText).not.toContain("@/store");
    expect(file!.sourceText).not.toContain("@/services");
  });

  test('S5 gate: the filesystem infrastructure modules import only utilities, binaries, and their siblings', () => {
    const expectedImports: Record<string, string[]> = {
      'packages/server/src/infrastructure/filesystem/workspace-files.ts': [
        '@prokopai/sdk', 'fast-glob', 'fs', 'fs/promises', 'ignore', 'path',
      ],
      'packages/server/src/infrastructure/filesystem/file-preview.ts': [
        '@prokopai/sdk', './binary-detection', 'fs/promises', 'path',
      ],
      'packages/server/src/infrastructure/filesystem/file-mutations.ts': [
        '@prokopai/sdk', './binary-detection', '@/application/http-errors',
        './file-preview', 'crypto', 'fs/promises', 'path',
      ],
      'packages/server/src/infrastructure/filesystem/git-status.ts': [
        '@prokopai/sdk', './binary-detection', './file-preview', 'fs/promises', 'path',
      ],
    };

    for (const [repoFile, specifiers] of Object.entries(expectedImports)) {
      const file = scanDirectory(serverSourceRoot).find((candidate) =>
        relative(repositoryRoot, candidate.path) === repoFile);
      expect(file, repoFile).toBeDefined();
      const imports = parseImports(file!.sourceText, file!.path);
      expect([...new Set(imports.map((imp) => imp.specifier))].sort(), repoFile)
        .toEqual([...specifiers].sort());
      expect(file!.sourceText).not.toContain("@/adapters");
      expect(file!.sourceText).not.toContain("@/store");
    }

    // Filesystem modules have no infrastructure exceptions. Their exact allowed
    // imports are asserted above.
    expect(Object.keys(layerInfrastructureExceptions)
      .filter((path) => path.startsWith('packages/server/src/infrastructure/filesystem/')))
      .toEqual([]);
  });

  test('S5 gate: the terminal manager keeps PTY and transport ownership and persists through the port', () => {
    const managerPath = resolve(transportDir, 'terminal/manager.ts');
    const file = scanDirectory(serverSourceRoot).find((candidate) => candidate.path === managerPath);
    expect(file).toBeDefined();

    const imports = parseImports(file!.sourceText, file!.path);
    expect(
      imports.some((imp) =>
        imp.specifier === '@/application/ports/terminal'
        && imp.names.includes('TerminalSessionStorePort')
      ),
    ).toBe(true);
    // The manager must not reach into the store.
    expect(imports.some((imp) => imp.specifier.startsWith('@/store'))).toBe(false);
    // PTY/transport ownership stays here: bun websocket types and the
    // bun-pty spawn remain (the local getDefaultShell selection is kept).
    expect(imports.some((imp) => imp.specifier === 'bun')).toBe(true);
    expect(
      imports.some((imp) => imp.specifier === 'bun-pty' && imp.names.includes('spawn')),
    ).toBe(true);
  });

  test('S9 gate: terminal session store wiring is owned by SQLite infrastructure', () => {
    const storePath = resolve(infrastructureSqliteDir, 'terminal-session-store.ts');
    const file = scanDirectory(serverSourceRoot).find((candidate) => candidate.path === storePath);
    expect(file).toBeDefined();

    const imports = parseImports(file!.sourceText, file!.path);
    expect(imports.map((imp) => imp.specifier).sort()).toEqual([
      '@/application/ports/terminal',
      './database',
      './terminal-session-repository',
    ].sort());
    expect(file!.sourceText).not.toContain('@/store');
    expect(file!.sourceText).not.toContain('SELECT * FROM');
    expect(file!.sourceText).not.toContain('INSERT INTO');
  });

  test('S5 gate: the infrastructure terminal repository imports only the inward port and SQLite types', () => {
    const repoPath = resolve(infrastructureSqliteDir, 'terminal-session-repository.ts');
    const file = scanDirectory(serverSourceRoot).find((candidate) => candidate.path === repoPath);
    expect(file).toBeDefined();

    const imports = parseImports(file!.sourceText, file!.path);
    expect(imports.map((imp) => imp.specifier).sort()).toEqual([
      '@/application/ports/terminal',
      'bun:sqlite',
    ]);
    expect(imports.some((imp) => imp.specifier === 'bun:sqlite' && imp.kind !== 'type')).toBe(false);
  });

  test('S4 gate: the tools route invokes only the tools application and presentation helpers', () => {
    expect(Object.keys(layerHttpRoutesLegacyExceptions)).not.toContain(
      'packages/server/src/transport/http/routes/tools.ts',
    );
    expect(Object.keys(compatBarrelExceptions)).not.toContain(
      'packages/server/src/transport/http/routes/tools.ts',
    );

    const routePath = resolve(routesDir, 'tools.ts');
    const file = scanDirectory(serverSourceRoot).find((candidate) => candidate.path === routePath);
    expect(file).toBeDefined();
    const imports = parseImports(file!.sourceText, file!.path);

    const allowedSpecifiers = [
      'hono',
      '@/application/tools',
      './validate',
      './schemas',
    ];
    expect(imports.map((imp) => imp.specifier).sort()).toEqual([...allowedSpecifiers].sort());

    const forbiddenPrefixes = ['@/store', '@/config', '@capekai/core', '@/tools'];
    for (const imp of imports) {
      for (const prefix of forbiddenPrefixes) {
        expect(imp.specifier.startsWith(prefix)).toBe(false);
      }
    }
  });

  test('S4 gate: the tools route flags compat barrel and configuration imports', () => {
    const files: ScannedFile[] = [
      {
        path: resolve(routesDir, 'tools.ts'),
        sourceText: [
          "import { listTools } from '@capekai/core/compat/jean2';",
          "import * as toolEnv from '@/config/tool-env';",
        ].join('\n'),
      },
    ];

    const result = evaluateRules(files, serverSourceRoot, repositoryRoot, layerRules);
    expect(result.violations).toEqual([
      'packages/server/src/transport/http/routes/tools.ts imports @capekai/core/compat/jean2 (value) [rule: layer-http-routes]',
      'packages/server/src/transport/http/routes/tools.ts imports @/config/tool-env (value) [rule: layer-http-routes]',
    ]);
  });

  test('S5 gate: the mcp route invokes only the mcp application and presentation helpers', () => {
    expect(Object.keys(layerHttpRoutesLegacyExceptions)).not.toContain(
      'packages/server/src/transport/http/routes/mcp.ts',
    );

    const routePath = resolve(routesDir, 'mcp.ts');
    const file = scanDirectory(serverSourceRoot).find((candidate) => candidate.path === routePath);
    expect(file).toBeDefined();
    const imports = parseImports(file!.sourceText, file!.path);

    const allowedSpecifiers = [
      'hono',
      '@/application/mcp',
      './validate',
      './schemas',
      '@/application/http-errors',
    ];
    expect(imports.map((imp) => imp.specifier).sort()).toEqual([...allowedSpecifiers].sort());

    const forbiddenPrefixes = ['@/store', '@/mcp', '@/services'];
    for (const imp of imports) {
      for (const prefix of forbiddenPrefixes) {
        expect(imp.specifier.startsWith(prefix)).toBe(false);
      }
    }
  });

  test('S5 gate: the mcp route flags store and mcp implementation imports', () => {
    const files: ScannedFile[] = [
      {
        path: resolve(routesDir, 'mcp.ts'),
        sourceText: [
          "import { getWorkspace } from '@/store';",
          "import * as mcp from '@/mcp';",
        ].join('\n'),
      },
    ];

    const result = evaluateRules(files, serverSourceRoot, repositoryRoot, layerRules);
    expect(result.violations).toEqual([
      'packages/server/src/transport/http/routes/mcp.ts imports @/store (value) [rule: layer-http-routes]',
      'packages/server/src/transport/http/routes/mcp.ts imports @/mcp (value) [rule: layer-http-routes]',
    ]);
  });

  test('S4/S5 gate: the tool-installation domain imports only SDK types, path, and sibling modules', () => {
    const allowedSpecifiers = [
      '@prokopai/sdk',
      '@capekai/tool',
      'path',
      './policy',
      './selection',
      './repository-schema',
      './index',
    ];
    const violations: string[] = [];
    for (const file of scanDirectory(serverSourceRoot)) {
      if (!file.path.includes('domains/tool-installation')) continue;
      for (const imp of parseImports(file.sourceText, file.path)) {
        if (!allowedSpecifiers.includes(imp.specifier)) {
          violations.push(`${relative(repositoryRoot, file.path)} imports ${imp.specifier}`);
        }
      }
    }
    expect(violations).toEqual([]);

    const result = evaluateRules(
      scanDirectory(serverSourceRoot),
      serverSourceRoot,
      repositoryRoot,
      [layerRules[3]], // layer-domains
    );
    const domainViolations = result.violations.filter((v) =>
      v.includes('packages/server/src/domains/tool-installation/'),
    );
    expect(domainViolations).toEqual([]);
  });

  test('S4 gate: the tool installer and repository implementations consume the tool-installation domain policy', () => {
    const installerPath = resolve(infrastructureDir, 'tools/tool-installer.ts');
    const installerFile = scanDirectory(serverSourceRoot).find((candidate) => candidate.path === installerPath);
    expect(installerFile).toBeDefined();
    const installerImports = parseImports(installerFile!.sourceText, installerFile!.path);
    expect(
      installerImports.some((imp) =>
        imp.specifier === '@/domains/tool-installation'
        && imp.names.includes('buildSourceInstallManifest')
        && imp.names.includes('buildUrlInstallManifest')
        && imp.names.includes('validateToolModuleExports')
        && imp.names.includes('toolInstallDir')
      ),
    ).toBe(true);

    const repositoryPath = resolve(infrastructureDir, 'tools/tool-repository.ts');
    const repositoryFile = scanDirectory(serverSourceRoot).find((candidate) => candidate.path === repositoryPath);
    expect(repositoryFile).toBeDefined();
    const repositoryImports = parseImports(repositoryFile!.sourceText, repositoryFile!.path);
    expect(
      repositoryImports.some((imp) =>
        imp.specifier === '@/domains/tool-installation'
        && imp.names.includes('validateToolRepositoryShape')
        && imp.names.includes('resolveArtifactUrlFor')
        && imp.names.includes('resolveVersionUrlFor')
      ),
    ).toBe(true);
  });

  test('S5 gate: the jean2 mcp adapter imports only the mcp implementation and the workspace store', () => {
    const adapterPath = resolve(adaptersDir, 'jean2/mcp.ts');
    const file = scanDirectory(serverSourceRoot).find((candidate) => candidate.path === adapterPath);
    expect(file).toBeDefined();

    const imports = parseImports(file!.sourceText, file!.path);
    expect(imports.map((imp) => imp.specifier).sort()).toEqual([
      '@/application/ports/mcp',
      '@/infrastructure/mcp/lifecycle',
      '@/infrastructure/sqlite/workspaces',
    ].sort());
  });

  test('S9 gate: the Jean2 configuration adapter is the concrete configuration seam', () => {
    const adapterPath = resolve(adaptersDir, 'jean2/configuration.ts');
    const file = scanDirectory(serverSourceRoot).find((candidate) => candidate.path === adapterPath);
    expect(file).toBeDefined();
    expect(parseImports(file!.sourceText, file!.path).map((imp) => imp.specifier).sort()).toEqual([
      '@/application/ports/configuration',
      '@/config/models',
      '@/config/models-sync',
      '@/config/preconfigs',
      '@/config/prompts',
      '@/config/prompts-registry',
    ].sort());
  });

  test('S4 gate: the jean2 tool adapters import only the wrapped implementations and the capek catalog seam', () => {
    const distributionPath = resolve(adaptersDir, 'jean2/tool-distribution.ts');
    const distributionFile = scanDirectory(serverSourceRoot).find((candidate) => candidate.path === distributionPath);
    expect(distributionFile).toBeDefined();
    const distributionImports = parseImports(distributionFile!.sourceText, distributionFile!.path);
    expect(distributionImports.map((imp) => imp.specifier).sort()).toEqual([
      '@/application/ports/tool-distribution',
      '@/infrastructure/tools/distribution',
    ].sort());

    const toolsPath = resolve(adaptersDir, 'jean2/tools.ts');
    const toolsFile = scanDirectory(serverSourceRoot).find((candidate) => candidate.path === toolsPath);
    expect(toolsFile).toBeDefined();
    const toolsImports = parseImports(toolsFile!.sourceText, toolsFile!.path);
    expect(toolsImports.map((imp) => imp.specifier).sort()).toEqual([
      '@/adapters/capek/tool-source',
      '@/application/ports/tool-distribution',
      '@/config/errors',
      '@/config/tool-env',
    ].sort());
  });

  test('S9 gate: scheduled execution is owned by infrastructure and the Jean2 adapter', () => {
    const runnerPath = resolve(infrastructureDir, 'scheduling/scheduled-job-runner.ts');
    const runner = scanDirectory(serverSourceRoot).find((candidate) => candidate.path === runnerPath);
    expect(runner).toBeDefined();
    expect(parseImports(runner!.sourceText, runner!.path).map((imp) => imp.specifier).sort()).toEqual([
      '@/adapters/capek/contracts',
      '@/application/ports/scheduling',
      '@prokopai/sdk',
      'crypto',
    ].sort());

    const adapterPath = resolve(adaptersDir, 'jean2/scheduled-job-execution.ts');
    const adapter = scanDirectory(serverSourceRoot).find((candidate) => candidate.path === adapterPath);
    expect(adapter).toBeDefined();
    expect(parseImports(adapter!.sourceText, adapter!.path).map((imp) => imp.specifier).sort()).toEqual([
      '@/adapters/capek/execution-scope',
      '@/application/ports/scheduling',
      '@/config',
      '@/infrastructure/config/preconfig',
      '@/infrastructure/scheduling/scheduled-job-runner',
      '@/infrastructure/sqlite/scheduled-job-store',
      '@/infrastructure/sqlite/session-store',
      '@/infrastructure/sqlite/workspaces',
      '@prokopai/sdk',
    ].sort());
    expect(adapter!.sourceText).not.toContain('@/scheduler/runner');
  });

  test('S10 gate: stateful session execution enters the composed scope', () => {
    const executionPath = resolve(adaptersCapekDir, 'execution.ts');
    const execution = scanDirectory(serverSourceRoot).find((candidate) => candidate.path === executionPath);
    expect(execution).toBeDefined();
    expect(parseImports(execution!.sourceText, execution!.path).map((imp) => imp.specifier)).toContain('./execution-scope');
    expect(execution!.sourceText).toContain('withJean2ExecutionScope');

    const scopePath = resolve(adaptersCapekDir, 'execution-scope.ts');
    const scope = scanDirectory(serverSourceRoot).find((candidate) => candidate.path === scopePath);
    expect(scope).toBeDefined();
    expect(parseImports(scope!.sourceText, scope!.path).map((imp) => imp.specifier)).toContain('./composition');
    expect(scope!.sourceText).not.toContain('createCurrentProcessScope');
    expect(scope!.sourceText).not.toContain('createCurrentAgentScope');
    for (const identity of [
      'handleCapekChat',
      'handleCapekSessionEditMessage',
      'regenerateCapekSessionTitle',
      'executeCapekCompaction',
      'revertCapekToStep',
      'forkCapekSession',
    ]) {
      expect(execution!.sourceText).toContain(identity);
    }
  });

  test('S10 gate: startup owns execution composition creation and disposal', () => {
    const startupPath = resolve(serverSourceRoot, 'index.ts');
    const startup = scanDirectory(serverSourceRoot).find((candidate) => candidate.path === startupPath);
    expect(startup).toBeDefined();
    expect(parseImports(startup!.sourceText, startup!.path).map((imp) => imp.specifier)).toContain(
      '@/adapters/capek/execution-scope',
    );

    const source = startup!.sourceText;
    expect(source.indexOf('const agents = createRuntime();')).toBeLessThan(
      source.indexOf('await initializeJean2ExecutionScope();'),
    );
    expect(source.indexOf('await disposeJean2ExecutionScope();')).toBeGreaterThan(
      source.indexOf('const cleanup ='),
    );
    expect(source).toContain('if (cleanupPromise !== null) return cleanupPromise;');
    expect(source).toContain("console.error('Startup cleanup failed:', cleanupError);");
    expect(source.indexOf('await disposeJean2ExecutionScope();')).toBeLessThan(
      source.indexOf('attempt(() => closeDatabase());'),
    );
  });

  test('S9 gate: the store compatibility directory is absent and no source file imports @/store', () => {
    const files = scanDirectory(serverSourceRoot);
    expect(files.some((file) => file.path === resolve(serverSourceRoot, 'store/index.ts'))).toBe(false);
    expect(files.some((file) => file.path.startsWith(`${resolve(serverSourceRoot, 'store')}/`))).toBe(false);

    for (const file of files) {
      expect(parseImports(file.sourceText, file.path).some((imp) =>
        imp.specifier === '@/store' || imp.specifier.startsWith('@/store/'),
      )).toBe(false);
    }
  });

  test('S9 gate: maintenance and response-format routes use applications', () => {
    const maintenance = scanDirectory(serverSourceRoot).find((candidate) =>
      candidate.path === resolve(routesDir, 'maintenance.ts'));
    const formats = scanDirectory(serverSourceRoot).find((candidate) =>
      candidate.path === resolve(routesDir, 'response-formats.ts'));
    expect(maintenance).toBeDefined();
    expect(formats).toBeDefined();
    for (const file of [maintenance!, formats!]) {
      expect(parseImports(file.sourceText, file.path).some((imp) => imp.specifier.startsWith('@/store'))).toBe(false);
    }
    expect(maintenance!.sourceText).toContain('maintenance.vacuum');
    expect(formats!.sourceText).toContain('responseFormats.list');
    expect(Object.keys(layerHttpRoutesLegacyExceptions)).not.toContain('packages/server/src/transport/http/routes/maintenance.ts');
    expect(Object.keys(layerHttpRoutesLegacyExceptions)).not.toContain('packages/server/src/transport/http/routes/response-formats.ts');
  });

  test('S9 gate: MCP and tool implementations live under infrastructure', () => {
    const files = scanDirectory(serverSourceRoot);
    for (const oldPath of [
      'packages/server/src/mcp/index.ts',
      'packages/server/src/mcp/manager.ts',
      'packages/server/src/mcp/converter.ts',
      'packages/server/src/tools/tool-installer.ts',
      'packages/server/src/tools/tool-repository.ts',
      'packages/server/src/tools/tool-npm-installer.ts',
      'packages/server/src/tools/tool-bundler.ts',
    ]) {
      expect(files.some((file) => relative(repositoryRoot, file.path) === oldPath)).toBe(false);
    }
    for (const ownerPath of [
      'packages/server/src/infrastructure/mcp/manager.ts',
      'packages/server/src/infrastructure/mcp/converter.ts',
      'packages/server/src/infrastructure/tools/tool-installer.ts',
      'packages/server/src/infrastructure/tools/tool-repository.ts',
    ]) {
      expect(files.some((file) => relative(repositoryRoot, file.path) === ownerPath)).toBe(true);
    }
    const lifecycle = files.find((file) => relative(repositoryRoot, file.path) === 'packages/server/src/infrastructure/mcp/lifecycle.ts');
    const distribution = files.find((file) => relative(repositoryRoot, file.path) === 'packages/server/src/infrastructure/tools/distribution.ts');
    expect(lifecycle?.sourceText).not.toContain("from '@/mcp'");
    expect(distribution?.sourceText).not.toContain("from '@/tools/tool-installer'");
    expect(distribution?.sourceText).not.toContain("from '@/tools/tool-repository'");
  });

  test('S9 gate: retired compatibility wrappers, including the scheduler lifecycle seam, are absent and unimported', () => {
    const files = scanDirectory(serverSourceRoot);
    const retired = [
      'packages/server/src/core/session-title.ts',
      'packages/server/src/core/preconfig.ts',
      'packages/server/src/paths.ts',
      'packages/server/src/env.ts',
      'packages/server/src/utils/binaryDetection.ts',
      'packages/server/src/utils/paths.ts',
      'packages/server/src/utils/http-errors.ts',
      'packages/server/src/session-search/fts.ts',
      'packages/server/src/scheduler/index.ts',
      'packages/server/src/tools/index.ts',
    ] as const;
    const retiredPaths = new Set(retired.map((path) => resolve(repositoryRoot, path)));
    const retiredSpecifiers = new Set([
      '@/core/session-title',
      '@/core/preconfig',
      '@/env',
      '@/paths',
      '@/utils/binaryDetection',
      '@/utils/paths',
      '@/utils/http-errors',
      '@/session-search/fts',
      '@/scheduler',
      '@/tools',
    ]);
    const retiredSpecifierPrefixes = ['@/scheduler/', '@/env/', '@/paths/', '@/utils/http-errors/'];
    const retiredResolvedPaths = new Set([
      ...retiredPaths,
      ...[...retiredPaths].map((path) => path.replace(/\.tsx?$/, '')),
    ]);
    const imports = files.flatMap((file) => parseImports(file.sourceText, file.path));

    for (const path of retired) {
      expect(files.some((file) => relative(repositoryRoot, file.path) === path)).toBe(false);
    }
    for (const imp of imports) {
      expect(
        retiredSpecifiers.has(imp.specifier) ||
          retiredSpecifierPrefixes.some((prefix) => imp.specifier.startsWith(prefix)),
      ).toBe(false);
      const resolved = resolveLocalSpecifier(imp.specifier, imp.file, serverSourceRoot);
      expect(resolved === null || !retiredResolvedPaths.has(resolved)).toBe(true);
    }
  });


  test('S9 gate: configuration HTTP routes use the configuration application', () => {
    const routePath = resolve(routesDir, 'config.ts');
    const file = scanDirectory(serverSourceRoot).find((candidate) => candidate.path === routePath);
    expect(file).toBeDefined();
    expect(file!.sourceText).toContain('configuration.models');
    expect(file!.sourceText).toContain('configuration.prompts');
    expect(file!.sourceText).toContain('configuration.preconfigs');
    expect(parseImports(file!.sourceText, file!.path).some((imp) => imp.specifier.startsWith('@/config/'))).toBe(false);
  });

  test('S9 gate: the config route delegates provider routes to the providers application without importing provider implementations', () => {
    const routePath = resolve(routesDir, 'config.ts');
    const file = scanDirectory(serverSourceRoot).find((candidate) => candidate.path === routePath);
    expect(file).toBeDefined();

    const imports = parseImports(file!.sourceText, file!.path);
    expect(
      imports.some((imp) => imp.specifier === '@/application/providers'),
    ).toBe(true);
    for (const imp of imports) {
      expect(imp.specifier).not.toBe('@/config/provider-credentials');
      expect(imp.specifier).not.toBe('@/infrastructure/oauth/oauth-manager');
      expect(imp.specifier).not.toBe('@capekai/core/compat/jean2');
    }
    // The retired exception entries are pinned.
    expect(Object.keys(layerHttpRoutesLegacyExceptions)).not.toContain(
      'packages/server/src/transport/http/routes/config.ts',
    );
    expect(imports.map((imp) => imp.specifier).sort()).toEqual([
      '@/application/config',
      '@/application/providers',
      './schemas',
      './validate',
      'hono',
    ].sort());
    expect(Object.keys(compatBarrelExceptions)).not.toContain('packages/server/src/transport/http/routes/config.ts');
  });

  test('S4 gate: the provider wire handlers invoke the providers application and import no Capek compat entrypoints', () => {
    const handlerPath = resolve(transportDir, 'websocket/handlers/providers.ts');
    const file = scanDirectory(serverSourceRoot).find((candidate) => candidate.path === handlerPath);
    expect(file).toBeDefined();

    const imports = parseImports(file!.sourceText, file!.path);
    expect(imports.map((imp) => imp.specifier).sort()).toEqual([
      '@prokopai/sdk',
      '../application',
      '../connection-id',
      '../router-context',
    ].sort());

    expect(Object.keys(layerTransportLegacyExceptions)).not.toContain(
      'packages/server/src/transport/websocket/handlers/providers.ts',
    );
    expect(Object.keys(compatBarrelExceptions)).not.toContain(
      'packages/server/src/transport/websocket/handlers/providers.ts',
    );
  });

  test('S4 gate: the provider wire handler flags a direct compat registry import', () => {
    const files: ScannedFile[] = [
      {
        path: resolve(transportDir, 'websocket/handlers/providers.ts'),
        sourceText: "import { connectProvider } from '@capekai/core/compat/jean2';\n",
      },
    ];

    const result = evaluateRules(files, serverSourceRoot, repositoryRoot, layerRules);
    expect(result.violations).toEqual([
      'packages/server/src/transport/websocket/handlers/providers.ts imports @capekai/core/compat/jean2 (value) [rule: layer-transport]',
    ]);
  });

  test('S4 gate: the capek provider-accounts adapter imports only the compat registry entrypoints', () => {
    const adapterPath = resolve(adaptersCapekDir, 'provider-accounts.ts');
    const file = scanDirectory(serverSourceRoot).find((candidate) => candidate.path === adapterPath);
    expect(file).toBeDefined();

    const imports = parseImports(file!.sourceText, file!.path);
    expect(imports.map((imp) => imp.specifier).sort()).toEqual([
      '@capekai/core/providers',
      '@/application/ports/provider-accounts',
    ].sort());
  });

  test('S4 gate: the jean2 oauth and credential adapters import only the wrapped implementations', () => {
    const oauthPath = resolve(adaptersDir, 'jean2/oauth.ts');
    const oauthFile = scanDirectory(serverSourceRoot).find((candidate) => candidate.path === oauthPath);
    expect(oauthFile).toBeDefined();
    const oauthImports = parseImports(oauthFile!.sourceText, oauthFile!.path);
    expect(oauthImports.map((imp) => imp.specifier).sort()).toEqual([
      '@/application/ports/provider-accounts',
      '@/infrastructure/oauth/oauth-manager',
    ].sort());

    const credentialPath = resolve(adaptersDir, 'jean2/provider-credentials.ts');
    const credentialFile = scanDirectory(serverSourceRoot).find((candidate) => candidate.path === credentialPath);
    expect(credentialFile).toBeDefined();
    const credentialImports = parseImports(credentialFile!.sourceText, credentialFile!.path);
    expect(credentialImports.map((imp) => imp.specifier).sort()).toEqual([
      '@/application/ports/provider-accounts',
      '@/config/provider-credentials',
    ].sort());
  });

  test('S4 gate: the provider-accounts domain imports only SDK types and sibling modules', () => {
    const allowedSpecifiers = [
      '@prokopai/sdk',
      './oauth',
      './credentials',
      './index',
    ];
    const violations: string[] = [];
    for (const file of scanDirectory(serverSourceRoot)) {
      if (!file.path.includes('domains/provider-accounts')) continue;
      for (const imp of parseImports(file.sourceText, file.path)) {
        if (!allowedSpecifiers.includes(imp.specifier)) {
          violations.push(`${relative(repositoryRoot, file.path)} imports ${imp.specifier}`);
        }
      }
    }
    expect(violations).toEqual([]);

    const result = evaluateRules(
      scanDirectory(serverSourceRoot),
      serverSourceRoot,
      repositoryRoot,
      [layerRules[3]], // layer-domains
    );
    const domainViolations = result.violations.filter((v) =>
      v.includes('packages/server/src/domains/provider-accounts/'),
    );
    expect(domainViolations).toEqual([]);
  });

  test('S4 gate: the oauth manager and providers consume the provider-accounts domain policy', () => {
    const managerPath = resolve(serverSourceRoot, 'infrastructure/oauth/oauth-manager.ts');
    const managerFile = scanDirectory(serverSourceRoot).find((candidate) => candidate.path === managerPath);
    expect(managerFile).toBeDefined();
    const managerImports = parseImports(managerFile!.sourceText, managerFile!.path);
    expect(
      managerImports.some((imp) =>
        imp.specifier === '@/domains/provider-accounts'
        && imp.names.includes('buildAuthorizationUrl')
        && imp.names.includes('generatePkceCodes')
        && imp.names.includes('buildTokenExchangeParams')
        && imp.names.includes('buildTokenRefreshParams')
        && imp.names.includes('OAUTH_FLOW_TIMEOUT_MS')
      ),
    ).toBe(true);

    const codexPath = resolve(serverSourceRoot, 'infrastructure/providers/codex.ts');
    const codexFile = scanDirectory(serverSourceRoot).find((candidate) => candidate.path === codexPath);
    expect(codexFile).toBeDefined();
    const codexImports = parseImports(codexFile!.sourceText, codexFile!.path);
    expect(
      codexImports.some((imp) =>
        imp.specifier === '@/domains/provider-accounts'
        && imp.names.includes('buildCodexConfig')
        && imp.names.includes('codexStatusFromConfig')
        && imp.names.includes('applyCodexRefresh')
      ),
    ).toBe(true);

    const credentialsPath = resolve(serverSourceRoot, 'infrastructure/providers/provider-credential-files.ts');
    const credentialsFile = scanDirectory(serverSourceRoot).find((candidate) => candidate.path === credentialsPath);
    expect(credentialsFile).toBeDefined();
    const credentialsImports = parseImports(credentialsFile!.sourceText, credentialsFile!.path);
    expect(
      credentialsImports.some((imp) =>
        imp.specifier === '@/domains/provider-accounts'
        && imp.names.includes('mergeEnvLine')
        && imp.names.includes('removeEnvLine')
        && imp.names.includes('PROVIDER_CREDENTIALS')
      ),
    ).toBe(true);
  });

  test('S4 gate: the notifications route invokes only the notifications application and presentation helpers', () => {
    expect(Object.keys(layerHttpRoutesLegacyExceptions)).not.toContain(
      'packages/server/src/transport/http/routes/notifications.ts',
    );

    const routePath = resolve(routesDir, 'notifications.ts');
    const file = scanDirectory(serverSourceRoot).find((candidate) => candidate.path === routePath);
    expect(file).toBeDefined();
    const imports = parseImports(file!.sourceText, file!.path);

    const allowedSpecifiers = [
      'hono',
      '@/application/notifications',
      './validate',
      './schemas',
      '@/application/http-errors',
    ];
    expect(imports.map((imp) => imp.specifier).sort()).toEqual([...allowedSpecifiers].sort());

    const forbiddenPrefixes = ['@/store', '@/services/web-push', '@/env'];
    for (const imp of imports) {
      for (const prefix of forbiddenPrefixes) {
        expect(imp.specifier.startsWith(prefix)).toBe(false);
      }
    }
  });

  test('S4 gate: the notifications route flags store and web-push imports', () => {
    const files: ScannedFile[] = [
      {
        path: resolve(routesDir, 'notifications.ts'),
        sourceText: [
          "import { upsertPushSubscription } from '@/store';",
          "import { getVapidCredentials } from '@/infrastructure/web-push/credentials';",
        ].join('\n'),
      },
    ];

    const result = evaluateRules(files, serverSourceRoot, repositoryRoot, layerRules);
    expect(result.violations).toEqual([
      'packages/server/src/transport/http/routes/notifications.ts imports @/store (value) [rule: layer-http-routes]',
      'packages/server/src/transport/http/routes/notifications.ts imports @/infrastructure/web-push/credentials (value) [rule: layer-http-routes]',
    ]);
  });

  test('S4 gate: the notification acknowledge handler uses the wired notifications application', () => {
    const miscPath = resolve(transportDir, 'websocket/handlers/misc.ts');
    const file = scanDirectory(serverSourceRoot).find((candidate) => candidate.path === miscPath);
    expect(file).toBeDefined();

    const imports = parseImports(file!.sourceText, file!.path);
    expect(
      imports.some((imp) => imp.specifier === '../application'),
    ).toBe(true);
    expect(
      imports.some((imp) => imp.specifier === '@/services/web-push/dispatch'),
    ).toBe(false);
  });

  test('S4 gate: the jean2 notifications adapter imports only the store, web-push, and scheduling-domain implementations', () => {
    const adapterPath = resolve(adaptersDir, 'jean2/notifications.ts');
    const file = scanDirectory(serverSourceRoot).find((candidate) => candidate.path === adapterPath);
    expect(file).toBeDefined();

    const imports = parseImports(file!.sourceText, file!.path);
    expect(imports.map((imp) => imp.specifier).sort()).toEqual([
      '@/application/notifications',
      '@/domains/scheduling/notifications',
      '@/infrastructure/runtime/environment',
      '@/infrastructure/sqlite/notification-repository',
      '@/infrastructure/sqlite/pending-asks',
      '@/infrastructure/sqlite/scheduled-job-store',
      '@/infrastructure/sqlite/session-store',
      '@/infrastructure/web-push/sender',
    ].sort());
  });

  test('S4 gate: the notification domain imports only SDK types and sibling modules', () => {
    const allowedSpecifiers = [
      '@prokopai/sdk',
      './policy',
      './index',
    ];
    const violations: string[] = [];
    for (const file of scanDirectory(serverSourceRoot)) {
      if (!file.path.includes('domains/notifications')) continue;
      for (const imp of parseImports(file.sourceText, file.path)) {
        if (!allowedSpecifiers.includes(imp.specifier)) {
          violations.push(`${relative(repositoryRoot, file.path)} imports ${imp.specifier}`);
        }
      }
    }
    expect(violations).toEqual([]);

    const result = evaluateRules(
      scanDirectory(serverSourceRoot),
      serverSourceRoot,
      repositoryRoot,
      [layerRules[3]], // layer-domains
    );
    const domainViolations = result.violations.filter((v) =>
      v.includes('packages/server/src/domains/notifications/'),
    );
    expect(domainViolations).toEqual([]);
  });


  test('S4 gate: the web-push retry scheduler consumes the notification domain and the adapter', () => {
    const retryPath = resolve(serverSourceRoot, 'infrastructure/web-push/retry-scheduler.ts');
    const file = scanDirectory(serverSourceRoot).find((candidate) => candidate.path === retryPath);
    expect(file).toBeDefined();

    const imports = parseImports(file!.sourceText, file!.path);
    expect(imports.map((imp) => imp.specifier).sort()).toEqual([
      '@/adapters/jean2/notifications',
      '@/domains/notifications',
    ].sort());
  });
});
