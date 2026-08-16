import { describe, expect, test } from 'bun:test';
import { relative, resolve } from 'node:path';
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
const routesDir = resolve(serverSourceRoot, 'routes');
const utilsDir = resolve(serverSourceRoot, 'utils');
const layerDirs = [bootstrapDir, transportDir, applicationDir, domainsDir, infrastructureDir, adaptersDir];
const infrastructureSqliteDir = resolve(infrastructureDir, 'sqlite');

const honoMatchers: SpecifierMatcher[] = [
  { exact: 'hono' },
  { prefix: 'hono/' },
  { prefix: '@hono/' },
];

const compatBarrelExceptions: Record<string, string[]> = {
  'packages/server/src/adapters/capek/ask-authority.ts': ['@capekai/core/compat/jean2'],
  'packages/server/src/adapters/capek/bindings.ts': ['@capekai/core/compat/jean2'],
  'packages/server/src/adapters/capek/context-sources.ts': ['@capekai/core/compat/jean2'],
  'packages/server/src/adapters/capek/events.ts': ['@capekai/core/compat/jean2'],
  'packages/server/src/adapters/capek/execution.ts': ['@capekai/core/compat/jean2'],
  'packages/server/src/adapters/capek/runtime-configuration.ts': ['@capekai/core/compat/jean2'],
  'packages/server/src/adapters/capek/scheduler.ts': ['@capekai/core/compat/jean2'],
  'packages/server/src/adapters/capek/session-search.ts': ['@capekai/core/compat/jean2'],
  'packages/server/src/adapters/capek/tool-source.ts': ['@capekai/core/compat/jean2'],
  'packages/server/src/adapters/capek/types.ts': ['@capekai/core/compat/jean2'],
  'packages/server/src/configuration/models.ts': ['@capekai/core/compat/jean2'],
  'packages/server/src/configuration/tool-env.ts': ['@capekai/core/compat/jean2'],
  'packages/server/src/core/session-title.ts': ['@capekai/core/compat/jean2'],
  'packages/server/src/index.ts': ['@capekai/core/compat/jean2'],
  'packages/server/src/mcp/converter.ts': ['@capekai/core/compat/jean2'],
  'packages/server/src/mcp/manager.ts': ['@capekai/core/compat/jean2'],
  'packages/server/src/providers/codex.ts': ['@capekai/core/compat/jean2'],
  'packages/server/src/providers/gmail.ts': ['@capekai/core/compat/jean2'],
  'packages/server/src/providers/oauth-manager.ts': ['@capekai/core/compat/jean2'],
  'packages/server/src/adapters/capek/provider-accounts.ts': ['@capekai/core/compat/jean2'],
  'packages/server/src/sandbox/index.ts': ['@capekai/core/compat/jean2'],
  'packages/server/src/sandbox/routes.ts': ['@capekai/core/compat/jean2'],
  'packages/server/src/scheduler/runner.ts': ['@capekai/core/compat/jean2'],
  'packages/server/src/adapters/capek/workspace-paths.ts': ['@capekai/core/compat/jean2'],
  'packages/server/src/store/compaction-recovery.ts': ['@capekai/core/compat/jean2'],
  'packages/server/src/tools/tool-installer.ts': ['@capekai/core/compat/jean2'],
  'packages/server/src/transport/websocket/handlers/misc.ts': ['@capekai/core/compat/jean2'],
};

// S2 exit gate: zero non-transport ServerWebSocket exceptions remain.
const serverWebSocketExceptions: Record<string, string[]> = {};

const layerAdaptersLegacyExceptions: Record<string, string[]> = {
  'packages/server/src/adapters/capek/context-sources.ts': [
    '@/agents/storage', '@/agents/memory', '@/core/preconfig', '@/paths',
  ],
  'packages/server/src/adapters/capek/events.ts': [
    '@/core/broadcast', '@/services/web-push/dispatch',
  ],
  'packages/server/src/adapters/capek/interaction.ts': [
    '@/store/pending-asks', '@/store/permissions', '@/store', '@/env',
    '@/services/web-push/dispatch',
  ],
  'packages/server/src/adapters/capek/runtime-configuration.ts': [
    '@/config', '@/env',
  ],
  'packages/server/src/adapters/capek/sandbox.ts': ['@/sandbox'],
  'packages/server/src/adapters/capek/storage.ts': [
    '@/store', '@/store/workspaces',
  ],
  'packages/server/src/adapters/capek/titles.ts': ['@/core/session-title'],
  'packages/server/src/adapters/capek/tool-source.ts': [
    '@/config', '@/mcp', '@/paths',
  ],
  'packages/server/src/adapters/capek/workspace.ts': [
    '@/paths', '@/env', '@/store/workspaces',
  ],
  'packages/server/src/adapters/jean2/session-repository.ts': [
    '@/store', '@/store/pending-asks', '@/store/workspaces', '@/agents/storage',
    '@/core/session-title',
  ],
  'packages/server/src/adapters/jean2/scheduled-job-repository.ts': [
    '@/store/scheduled-jobs',
  ],
  'packages/server/src/adapters/jean2/scheduled-job-execution.ts': [
    '@/scheduler/runner',
  ],
  'packages/server/src/adapters/jean2/terminal.ts': [
    '@/store', '@/infrastructure/sqlite/terminal-session-repository',
  ],
  'packages/server/src/adapters/jean2/agent-workspace.ts': [
    '@/core/preconfig', '@/store/workspaces',
  ],
  'packages/server/src/adapters/jean2/workspace.ts': [
    '@/store/workspaces', '@/store/sessions', '@/store/pinned-messages',
    '@/store/scheduled-jobs', '@/services/terminal', '@/mcp', '@/paths',
  ],

  'packages/server/src/adapters/jean2/tools.ts': [
    '@/configuration/tool-env', '@/configuration/errors',
  ],
  'packages/server/src/adapters/jean2/oauth.ts': [
    '@/providers/oauth-manager',
  ],
  'packages/server/src/adapters/jean2/provider-credentials.ts': [
    '@/configuration/provider-credentials',
  ],
  'packages/server/src/adapters/jean2/mcp.ts': [
    '@/infrastructure/mcp/lifecycle', '@/store/workspaces',
  ],
  'packages/server/src/adapters/jean2/files.ts': [
    '@/store', '@/infrastructure/filesystem/workspace-files',
    '@/infrastructure/filesystem/file-preview',
    '@/infrastructure/filesystem/file-mutations',
    '@/infrastructure/filesystem/git-status',
  ],
  'packages/server/src/adapters/jean2/notifications.ts': [
    '@/infrastructure/sqlite/notification-repository', '@/infrastructure/web-push/sender',
    '@/store/sessions', '@/store/scheduled-jobs', '@/store/pending-asks', '@/env',
  ],
  'packages/server/src/adapters/jean2/tool-distribution.ts': [
    '@/infrastructure/tools/distribution',
  ],
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

// S2 exact per-file exceptions for transport wire handlers that still
// import legacy implementations. S3 retired the session lifecycle, queue,
// control, chat, and session handler entries; S4 retired the misc handler's
// capability-router import (the ask eligibility policy now lives in the
// controller domain via the application port layer). The permission and
// provider entries stay deferred until their owning slices; the terminal
// manager entry was retired by the S5 PTY/terminal persistence slice.
const layerTransportLegacyExceptions: Record<string, string[]> = {
  'packages/server/src/transport/websocket/handlers/misc.ts': [
    '@capekai/core/compat/jean2',
  ],
  'packages/server/src/transport/websocket/handlers/permissions.ts': ['@/store/permissions'],
};

// S3 exact per-file exceptions for HTTP route files that S3 does not own.
// routes/sessions.ts must not appear here: the session routes are migrated
// to the session HTTP application. The remaining entries stay until their
// owning phase (S4/S5 and the deferred route slices).
const layerHttpRoutesLegacyExceptions: Record<string, string[]> = {
  'packages/server/src/routes/config.ts': [
    '@/configuration/models',
    '@/configuration/models-sync', '@/configuration/prompts', '@/configuration/preconfigs',
    '@/prompts/registry',
  ],
  'packages/server/src/routes/maintenance.ts': ['@/store/cleanup'],
  'packages/server/src/routes/response-formats.ts': ['@/store'],
};

// S3 per-file exceptions for transport presentation helpers still living at
// legacy paths. The session route file uses the shared zod validation,
// session schemas, and HTTP error presenters; none of these import store or
// Capek implementations.
const layerTransportHttpPresentationExceptions: Record<string, string[]> = {
  'packages/server/src/transport/http/routes/sessions.ts': [
    '@/routes/validate', '@/routes/schemas', '@/utils/http-errors',
  ],
};

// S3 per-file exception: the bootstrap composition root reads the takeover
// configuration until configuration moves to infrastructure in S5. S5 added
// the concrete store database accessor injection for the session-search query
// repository: bootstrap is the composition root and owns that wiring.
const layerBootstrapExceptions: Record<string, string[]> = {
  'packages/server/src/bootstrap/application.ts': ['@/env', '@/paths'],
  'packages/server/src/bootstrap/create-runtime.ts': ['@/store'],
};

// S5 filesystem isolation: the filesystem infrastructure moves the exact
// pre-slice implementation. It owns no adapter imports; the two utility
// imports (binary detection and the HTTP error hierarchy used by editable
// file mutations) are the only exceptions, pinned by the S5 gate below.
const layerInfrastructureExceptions: Record<string, string[]> = {
  'packages/server/src/infrastructure/filesystem/file-preview.ts': ['@/utils/binaryDetection'],
  'packages/server/src/infrastructure/filesystem/file-mutations.ts': [
    '@/utils/binaryDetection', '@/utils/http-errors',
  ],
  'packages/server/src/infrastructure/filesystem/git-status.ts': ['@/utils/binaryDetection'],
  'packages/server/src/infrastructure/mcp/lifecycle.ts': ['@/mcp'],
  'packages/server/src/infrastructure/providers/provider-config-files.ts': ['@/paths'],
  'packages/server/src/infrastructure/providers/provider-credential-files.ts': [
    '@/configuration/errors', '@/configuration/files', '@/env', '@/paths',
  ],
  'packages/server/src/infrastructure/session-search/fts-projector.ts': ['@/session-search/fts'],
  'packages/server/src/infrastructure/sqlite/notification-repository.ts': ['@/store/web-push'],
  'packages/server/src/infrastructure/tools/distribution.ts': [
    '@/config', '@/tools/tool-installer', '@/tools/tool-repository',
  ],
  'packages/server/src/infrastructure/web-push/sender.ts': ['@/services/web-push/credentials'],
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
    rationale: 'Transport may invoke application services. No SQLite, AI SDK, or Capek implementation imports. S3 retired the session wire handler exceptions; permission, provider, misc, and terminal entries stay deferred, and the session route file keeps presentation-helper exceptions only.',
    appliesTo: [transportDir],
    forbiddenSpecifiers: [
      { exact: 'bun:sqlite' },
      { exact: 'ai' },
      { prefix: '@ai-sdk/' },
      { prefix: '@capekai/core' },
    ],
    allowedResolvedDirs: [transportDir, applicationDir],
    exceptions: {
      ...layerTransportLegacyExceptions,
      ...layerTransportHttpPresentationExceptions,
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
    rationale: 'Infrastructure implements ports. It may import domains and application ports but not transport route handlers.',
    appliesTo: [infrastructureDir],
    allowedResolvedDirs: [infrastructureDir, domainsDir, applicationDir],
    exceptions: layerInfrastructureExceptions,
  },
  {
    name: 'layer-adapters',
    rationale: 'Adapters translate Capek contracts and Jean2 ports. No transport imports. S1 focused adapters keep exact temporary exceptions for their legacy implementation paths.',
    appliesTo: [adaptersDir],
    allowedResolvedDirs: [adaptersDir, applicationDir, domainsDir],
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
    rationale: 'HTTP routes invoke application use cases. No SQLite, AI SDK, or Capek implementation imports. S3 migrated the session routes; the other route files keep exact per-file legacy exceptions until their owning phase.',
    appliesTo: [routesDir],
    forbiddenSpecifiers: [
      { exact: 'bun:sqlite' },
      { exact: 'ai' },
      { prefix: '@ai-sdk/' },
      { prefix: '@capekai/core' },
    ],
    allowedResolvedDirs: [routesDir, transportDir, applicationDir, utilsDir],
    exceptions: layerHttpRoutesLegacyExceptions,
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
        path: resolve(serverSourceRoot, 'providers/codex.ts'),
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

    expect(layerTransportHttpPresentationExceptions['packages/server/src/transport/http/routes/sessions.ts']).toEqual([
      '@/routes/validate', '@/routes/schemas', '@/utils/http-errors',
    ]);

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

    expect(Object.keys(layerHttpRoutesLegacyExceptions)).not.toContain('packages/server/src/routes/sessions.ts');
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
      '@capekai/core/compat/jean2',
      '@jean2/sdk',
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

  test('S5 gate: the session-search fts compatibility module wraps only the store and the infrastructure query implementation', () => {
    // Temporary S5 compatibility path: store -> fts compat -> infrastructure
    // query. Retired when S6 moves the projection behind committed events.
    const ftsPath = resolve(serverSourceRoot, 'session-search/fts.ts');
    const file = scanDirectory(serverSourceRoot).find((candidate) => candidate.path === ftsPath);
    expect(file).toBeDefined();

    const imports = parseImports(file!.sourceText, file!.path);
    expect(imports.map((imp) => imp.specifier).sort()).toEqual([
      '@/application/ports/session-search',
      '@/infrastructure/sqlite/session-search-query-repository',
      '@/store',
    ].sort());
  });

  test('S4 gate: the scheduler route invokes only the scheduling application and presentation helpers', () => {
    expect(Object.keys(layerHttpRoutesLegacyExceptions)).not.toContain(
      'packages/server/src/routes/scheduler.ts',
    );

    const routePath = resolve(routesDir, 'scheduler.ts');
    const file = scanDirectory(serverSourceRoot).find((candidate) => candidate.path === routePath);
    expect(file).toBeDefined();
    const imports = parseImports(file!.sourceText, file!.path);

    const allowedSpecifiers = [
      'hono',
      '@jean2/sdk',
      '@/application/scheduling',
      './validate',
      './schemas',
      '@/utils/http-errors',
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
      'packages/server/src/routes/scheduler.ts imports @/store/scheduled-jobs (value) [rule: layer-http-routes]',
      'packages/server/src/routes/scheduler.ts imports @/scheduler/runner (value) [rule: layer-http-routes]',
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
      '@capekai/core/compat/jean2',
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

  test('S5 gate: the scheduled-jobs store compatibility module wraps only the store and the infrastructure repository', () => {
    // Temporary S5 compatibility path: store -> compat -> infrastructure
    // repository. Retired when consumers migrate to the adapter.
    const compatPath = resolve(serverSourceRoot, 'store/scheduled-jobs.ts');
    const file = scanDirectory(serverSourceRoot).find((candidate) => candidate.path === compatPath);
    expect(file).toBeDefined();

    const imports = parseImports(file!.sourceText, file!.path);
    expect(imports.map((imp) => imp.specifier).sort()).toEqual([
      '@jean2/sdk',
      '@/application/ports/scheduling',
      '@/infrastructure/sqlite/scheduled-job-repository',
      './index',
    ].sort());
  });

  test('S5 gate: the infrastructure scheduled-job repository imports only ports and the scheduling domain', () => {
    const repoPath = resolve(infrastructureSqliteDir, 'scheduled-job-repository.ts');
    const file = scanDirectory(serverSourceRoot).find((candidate) => candidate.path === repoPath);
    expect(file).toBeDefined();

    const imports = parseImports(file!.sourceText, file!.path);
    expect(imports.map((imp) => imp.specifier).sort()).toEqual([
      '@jean2/sdk',
      '@/application/ports/scheduling',
      '@/domains/scheduling/job-lifecycle',
      '@/domains/scheduling/schedule',
      'bun:sqlite',
      'crypto',
    ].sort());
  });

  test('S5 gate: the compaction-recovery store compatibility module wires only the capek domain, ports, broadcasts, and store queries', () => {
    // Temporary S5 compatibility path: store -> compat wiring -> Capek
    // compaction recovery domain. The reconciliation decisions left the
    // store in C6 step 2; this module keeps export identities and wires the
    // inward-facing port over the store queries plus the transport
    // broadcast adapters.
    const compatPath = resolve(serverSourceRoot, 'store/compaction-recovery.ts');
    const file = scanDirectory(serverSourceRoot).find((candidate) => candidate.path === compatPath);
    expect(file).toBeDefined();

    const imports = parseImports(file!.sourceText, file!.path);
    expect([...new Set(imports.map((imp) => imp.specifier))].sort()).toEqual([
      '@capekai/core/compat/jean2',
      '@/application/ports/session',
      '@/capek-event-adapter',
      '@/core/broadcast',
      './messages',
      './sessions',
    ].sort());

    // The module must delegate to the Capek domain functions; the decision
    // logic no longer lives in the store.
    const sourceText = file!.sourceText;
    expect(sourceText).toContain('reconcileSessionCompactionWithDeps');
    expect(sourceText).toContain('reconcileAllSessionsCompactionWithDeps');
    expect(sourceText).toContain('reconcileSessionWithDeps');
    expect(sourceText).toContain('reconcileAllSessionsWithDeps');
    // The pre-slice ReconcileOptions identity stays local to the store
    // module instead of re-exporting a new compat-barrel type.
    expect(sourceText).toContain('export interface ReconcileOptions');
  });

  test('S5 gate: the compaction recovery port is fulfilled without SQL crossing into the capek domain', () => {
    // The inward-facing port lives with the other session ports; the Capek
    // domain depends on deps only. The server store remains the current
    // query provider until S6.
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
      'packages/server/src/routes/agents.ts',
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
      '@/utils/http-errors',
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
      'packages/server/src/routes/agents.ts imports @/agents/storage (value) [rule: layer-http-routes]',
      'packages/server/src/routes/agents.ts imports @/agents/memory (value) [rule: layer-http-routes]',
    ]);
  });

  test('S4 gate: the jean2 agent adapter imports only the preconfig and workspace store implementations', () => {
    const adapterPath = resolve(adaptersDir, 'jean2/agent-workspace.ts');
    const file = scanDirectory(serverSourceRoot).find((candidate) => candidate.path === adapterPath);
    expect(file).toBeDefined();

    const imports = parseImports(file!.sourceText, file!.path);
    expect(imports.map((imp) => imp.specifier).sort()).toEqual([
      '@/application/ports/agents',
      '@/core/preconfig',
      '@/store/workspaces',
    ].sort());
  });

  test('S4 gate: the agents storage compatibility module forwards through the application and jean2 adapters', () => {
    const compatPath = resolve(serverSourceRoot, 'agents/storage.ts');
    const file = scanDirectory(serverSourceRoot).find((candidate) => candidate.path === compatPath);
    expect(file).toBeDefined();

    const imports = parseImports(file!.sourceText, file!.path);
    expect(imports.map((imp) => imp.specifier).sort()).toEqual([
      '@jean2/sdk',
      '@/adapters/jean2',
      '@/application/agents',
      '@/infrastructure/agents/agent-directory-filesystem',
      '@/paths',
      'path',
    ].sort());
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
      '@jean2/sdk',
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
      '@jean2/sdk',
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
    // The exact legacy exception entry is retired; the misc handler keeps
    // only the Capek compat entry (the web-push dispatch import moved to the
    // wired notifications application in the S4 notification slice).
    expect(
      layerTransportLegacyExceptions['packages/server/src/transport/websocket/handlers/misc.ts'],
    ).toEqual(['@capekai/core/compat/jean2']);
  });

  test('S4 gate: the capability router is a registry-bound compatibility wrapper over the controller domain', () => {
    const routerPath = resolve(serverSourceRoot, 'core/capability-router.ts');
    const file = scanDirectory(serverSourceRoot).find((candidate) => candidate.path === routerPath);
    expect(file).toBeDefined();

    const imports = parseImports(file!.sourceText, file!.path);
    expect(
      imports.some((imp) =>
        imp.specifier === '@/domains/controllers'
        && imp.names.includes('checkAskResponseEligibility')
        && imp.names.includes('resolveAskDeliveryTargets')
        && imp.names.includes('getEligibleResponderClientIds')
      ),
    ).toBe(true);
    expect(
      imports.some((imp) => imp.specifier === './client-registry'),
    ).toBe(true);
    expect(
      imports.some((imp) => imp.specifier === './session-control-registry'),
    ).toBe(true);
  });

  test('S5 gate: the tool-output artifact store module wraps only the capek storage contract and the database accessor', () => {
    // The artifact SQLite store holds no product policy: ID validation and
    // page assembly come from @capekai/core/storage (the mandatory
    // invariants), and the module only maps rows and issues SQL.
    const storePath = resolve(serverSourceRoot, 'store/tool-output-artifacts.ts');
    const file = scanDirectory(serverSourceRoot).find((candidate) => candidate.path === storePath);
    expect(file).toBeDefined();

    const imports = parseImports(file!.sourceText, file!.path);
    expect(imports.map((imp) => imp.specifier).sort()).toEqual([
      '@capekai/core/storage',
      './index',
      'node:crypto',
    ].sort());
    expect(file!.sourceText).not.toContain('Math.min(limit');
    expect(file!.sourceText).not.toContain('slice(');
  });

  test('S5 gate: the sessions and messages store compat modules forward to the infrastructure repositories', () => {
    // Session/message SQL moved to infrastructure/sqlite in this category.
    // The compat modules keep every pre-slice export identity and only wire
    // the temporary side-effect hooks around the repositories. No SQL may
    // remain in the compat layer.
    const sessionsPath = resolve(serverSourceRoot, 'store/sessions.ts');
    const messagesPath = resolve(serverSourceRoot, 'store/messages.ts');
    for (const [label, path, expectedSpecifiers, forbiddenFragments] of [
      [
        'sessions',
        sessionsPath,
        [
          '@/application/ports/session-message',
          '@/infrastructure/sqlite/session-repository',
          '@/session-search/fts',
          './attachments',
          './index',
          './workspaces',
          '@jean2/sdk',
          'fs',
          'node:os',
          'node:path',
        ],
        ['INSERT INTO', 'SELECT * FROM', 'CREATE TABLE'],
      ],
      [
        'messages',
        messagesPath,
        [
          '@/application/ports/session-message',
          '@/infrastructure/session-search/fts-projector',
          '@/infrastructure/sqlite/message-repository',
          './index',
          './sessions',
          '@jean2/sdk',
        ],
        ['INSERT INTO', 'SELECT * FROM', 'CREATE TABLE'],
      ],
    ] as const) {
      const file = scanDirectory(serverSourceRoot).find((candidate) => candidate.path === path);
      expect(file, label).toBeDefined();

      const imports = parseImports(file!.sourceText, file!.path);
      expect(
        [...new Set(imports.map((imp) => imp.specifier))].sort(),
        label,
      ).toEqual([...expectedSpecifiers].sort());
      for (const fragment of forbiddenFragments) {
        expect(file!.sourceText, `${label} must not contain ${fragment}`).not.toContain(fragment);
      }
      // The compat layer delegates through the repository factory.
      if (label === 'sessions') {
        expect(file!.sourceText).toContain('createSessionRepository');
      } else {
        expect(file!.sourceText).toContain('createMessageRepository');
      }
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
          '@jean2/sdk',
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
      'packages/server/src/routes/workspaces.ts',
    );

    const routePath = resolve(routesDir, 'workspaces.ts');
    const file = scanDirectory(serverSourceRoot).find((candidate) => candidate.path === routePath);
    expect(file).toBeDefined();
    const imports = parseImports(file!.sourceText, file!.path);

    const allowedSpecifiers = [
      'hono',
      '@jean2/sdk',
      '@/application/workspaces',
      './validate',
      './schemas',
      '@/utils/http-errors',
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
      'packages/server/src/routes/workspaces.ts imports @/store (value) [rule: layer-http-routes]',
      'packages/server/src/routes/workspaces.ts imports @/services/terminal (value) [rule: layer-http-routes]',
      'packages/server/src/routes/workspaces.ts imports @/mcp (value) [rule: layer-http-routes]',
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
      '@/mcp',
      '@/paths',
      '@/services/terminal',
      '@/store/pinned-messages',
      '@/store/scheduled-jobs',
      '@/store/sessions',
      '@/store/workspaces',
      'fs',
    ].sort());
  });

  test('S4 gate: the workspace domain imports only SDK types and sibling modules', () => {
    const allowedSpecifiers = [
      '@jean2/sdk',
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

  test('S5 gate: the path utils module re-exports the Capek workspace policy through the adapter port', () => {
    const utilsPath = resolve(serverSourceRoot, 'utils/paths.ts');
    const file = scanDirectory(serverSourceRoot).find((candidate) => candidate.path === utilsPath);
    expect(file).toBeDefined();

    const imports = parseImports(file!.sourceText, file!.path);
    expect(imports).toHaveLength(1);
    expect(imports[0].specifier).toBe('@/adapters/capek/workspace-paths');
    expect(imports[0].kind).toBe('value');
    const sourceText = file!.sourceText;
    expect(sourceText).toContain('expandPath = workspacePathPolicyPort.expandPath');
    expect(sourceText).toContain('isPathWithinWorkspace = workspacePathPolicyPort.isPathWithinWorkspace');
    expect(sourceText).toContain('resolvePath = workspacePathPolicyPort.resolvePath');
    expect(sourceText).toContain('resolveRoot = workspacePathPolicyPort.resolveRootForQuery');
  });

  test('S5 gate: file mutations consume the Capek workspace policy through the adapter port', () => {
    const mutationsPath = resolve(serverSourceRoot, 'services/fileMutations.ts');
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
    const previewPath = resolve(serverSourceRoot, 'services/filePreview.ts');
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
      'packages/server/src/routes/files.ts',
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
      '@jean2/sdk',
      '@/application/files',
      '@/utils/http-errors',
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
      'packages/server/src/routes/files.ts imports @/store (value) [rule: layer-http-routes]',
      'packages/server/src/routes/files.ts imports @/services/files (value) [rule: layer-http-routes]',
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
      '@/store',
    ].sort());
  });

  test('S5 gate: the files application imports only its port, SDK types, and path helpers', () => {
    const filesPath = resolve(applicationDir, 'files/index.ts');
    const file = scanDirectory(serverSourceRoot).find((candidate) => candidate.path === filesPath);
    expect(file).toBeDefined();

    const imports = parseImports(file!.sourceText, file!.path);
    expect(imports.map((imp) => imp.specifier).sort()).toEqual([
      '@jean2/sdk',
      '../ports/files',
      'path',
    ].sort());
    expect(file!.sourceText).not.toContain("@/store");
    expect(file!.sourceText).not.toContain("@/services");
  });

  test('S5 gate: the filesystem infrastructure modules import only utilities, binaries, and their siblings', () => {
    const expectedImports: Record<string, string[]> = {
      'packages/server/src/infrastructure/filesystem/workspace-files.ts': [
        '@jean2/sdk', 'fast-glob', 'fs', 'fs/promises', 'ignore', 'path',
      ],
      'packages/server/src/infrastructure/filesystem/file-preview.ts': [
        '@jean2/sdk', '@/utils/binaryDetection', 'fs/promises', 'path',
      ],
      'packages/server/src/infrastructure/filesystem/file-mutations.ts': [
        '@jean2/sdk', '@/utils/binaryDetection', '@/utils/http-errors',
        './file-preview', 'crypto', 'fs/promises', 'path',
      ],
      'packages/server/src/infrastructure/filesystem/git-status.ts': [
        '@jean2/sdk', '@/utils/binaryDetection', './file-preview', 'fs/promises', 'path',
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

    // The narrow infrastructure exceptions must match the observed imports
    // exactly; no broader exception may be recorded.
    expect(Object.keys(layerInfrastructureExceptions)
      .filter((path) => path.startsWith('packages/server/src/infrastructure/filesystem/'))
      .sort()).toEqual([
      'packages/server/src/infrastructure/filesystem/file-mutations.ts',
      'packages/server/src/infrastructure/filesystem/file-preview.ts',
      'packages/server/src/infrastructure/filesystem/git-status.ts',
    ]);
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

  test('S5 gate: the terminal sessions store compat module forwards to the infrastructure repository with no SQL', () => {
    const storePath = resolve(serverSourceRoot, 'store/terminal-sessions.ts');
    const file = scanDirectory(serverSourceRoot).find((candidate) => candidate.path === storePath);
    expect(file).toBeDefined();

    const imports = parseImports(file!.sourceText, file!.path);
    expect(
      imports.some((imp) =>
        imp.specifier === '@/infrastructure/sqlite/terminal-session-repository'
      ),
    ).toBe(true);
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
      'packages/server/src/routes/tools.ts',
    );
    expect(Object.keys(compatBarrelExceptions)).not.toContain(
      'packages/server/src/routes/tools.ts',
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

    const forbiddenPrefixes = ['@/store', '@/configuration', '@capekai/core', '@/tools'];
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
          "import * as toolEnv from '@/configuration/tool-env';",
        ].join('\n'),
      },
    ];

    const result = evaluateRules(files, serverSourceRoot, repositoryRoot, layerRules);
    expect(result.violations).toEqual([
      'packages/server/src/routes/tools.ts imports @capekai/core/compat/jean2 (value) [rule: layer-http-routes]',
      'packages/server/src/routes/tools.ts imports @/configuration/tool-env (value) [rule: layer-http-routes]',
    ]);
  });

  test('S5 gate: the mcp route invokes only the mcp application and presentation helpers', () => {
    expect(Object.keys(layerHttpRoutesLegacyExceptions)).not.toContain(
      'packages/server/src/routes/mcp.ts',
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
      '@/utils/http-errors',
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
      'packages/server/src/routes/mcp.ts imports @/store (value) [rule: layer-http-routes]',
      'packages/server/src/routes/mcp.ts imports @/mcp (value) [rule: layer-http-routes]',
    ]);
  });

  test('S4/S5 gate: the tool-installation domain imports only SDK types, path, and sibling modules', () => {
    const allowedSpecifiers = [
      '@jean2/sdk',
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
    const installerPath = resolve(serverSourceRoot, 'tools/tool-installer.ts');
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

    const repositoryPath = resolve(serverSourceRoot, 'tools/tool-repository.ts');
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
      '@/store/workspaces',
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
      '@/configuration/errors',
      '@/configuration/tool-env',
    ].sort());
  });

  test('S4 gate: the config route delegates provider routes to the providers application without importing provider implementations', () => {
    const routePath = resolve(routesDir, 'config.ts');
    const file = scanDirectory(serverSourceRoot).find((candidate) => candidate.path === routePath);
    expect(file).toBeDefined();

    const imports = parseImports(file!.sourceText, file!.path);
    expect(
      imports.some((imp) => imp.specifier === '@/application/providers'),
    ).toBe(true);
    for (const imp of imports) {
      expect(imp.specifier).not.toBe('@/configuration/provider-credentials');
      expect(imp.specifier).not.toBe('@/providers/oauth-manager');
      expect(imp.specifier).not.toBe('@capekai/core/compat/jean2');
    }
    // The retired exception entries are pinned.
    expect(layerHttpRoutesLegacyExceptions['packages/server/src/routes/config.ts']).toEqual([
      '@/configuration/models',
      '@/configuration/models-sync', '@/configuration/prompts', '@/configuration/preconfigs',
      '@/prompts/registry',
    ]);
    expect(Object.keys(compatBarrelExceptions)).not.toContain('packages/server/src/routes/config.ts');
  });

  test('S4 gate: the provider wire handlers invoke the providers application and import no Capek compat entrypoints', () => {
    const handlerPath = resolve(transportDir, 'websocket/handlers/providers.ts');
    const file = scanDirectory(serverSourceRoot).find((candidate) => candidate.path === handlerPath);
    expect(file).toBeDefined();

    const imports = parseImports(file!.sourceText, file!.path);
    expect(imports.map((imp) => imp.specifier).sort()).toEqual([
      '@jean2/sdk',
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
      '@capekai/core/compat/jean2',
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
      '@/providers/oauth-manager',
    ].sort());

    const credentialPath = resolve(adaptersDir, 'jean2/provider-credentials.ts');
    const credentialFile = scanDirectory(serverSourceRoot).find((candidate) => candidate.path === credentialPath);
    expect(credentialFile).toBeDefined();
    const credentialImports = parseImports(credentialFile!.sourceText, credentialFile!.path);
    expect(credentialImports.map((imp) => imp.specifier).sort()).toEqual([
      '@/application/ports/provider-accounts',
      '@/configuration/provider-credentials',
    ].sort());
  });

  test('S4 gate: the provider-accounts domain imports only SDK types and sibling modules', () => {
    const allowedSpecifiers = [
      '@jean2/sdk',
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
    const managerPath = resolve(serverSourceRoot, 'providers/oauth-manager.ts');
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

    const codexPath = resolve(serverSourceRoot, 'providers/codex.ts');
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
      'packages/server/src/routes/notifications.ts',
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
      '@/utils/http-errors',
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
          "import { getVapidCredentials } from '@/services/web-push/credentials';",
        ].join('\n'),
      },
    ];

    const result = evaluateRules(files, serverSourceRoot, repositoryRoot, layerRules);
    expect(result.violations).toEqual([
      'packages/server/src/routes/notifications.ts imports @/store (value) [rule: layer-http-routes]',
      'packages/server/src/routes/notifications.ts imports @/services/web-push/credentials (value) [rule: layer-http-routes]',
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
      '@/env',
      '@/infrastructure/sqlite/notification-repository',
      '@/infrastructure/web-push/sender',
      '@/store/pending-asks',
      '@/store/scheduled-jobs',
      '@/store/sessions',
    ].sort());
  });

  test('S4 gate: the notification domain imports only SDK types and sibling modules', () => {
    const allowedSpecifiers = [
      '@jean2/sdk',
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

  test('S4 gate: the web-push dispatch compat module forwards through the jean2 notifications adapter', () => {
    const dispatchPath = resolve(serverSourceRoot, 'services/web-push/dispatch.ts');
    const file = scanDirectory(serverSourceRoot).find((candidate) => candidate.path === dispatchPath);
    expect(file).toBeDefined();

    const imports = parseImports(file!.sourceText, file!.path);
    expect(imports.map((imp) => imp.specifier).sort()).toEqual([
      '@jean2/sdk',
      '@/adapters/jean2/notifications',
    ].sort());
  });

  test('S4 gate: the web-push retry scheduler consumes the notification domain and the adapter', () => {
    const retryPath = resolve(serverSourceRoot, 'services/web-push/retry-scheduler.ts');
    const file = scanDirectory(serverSourceRoot).find((candidate) => candidate.path === retryPath);
    expect(file).toBeDefined();

    const imports = parseImports(file!.sourceText, file!.path);
    expect(imports.map((imp) => imp.specifier).sort()).toEqual([
      '@/adapters/jean2/notifications',
      '@/domains/notifications',
    ].sort());
  });
});
