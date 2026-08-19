import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { homedir } from 'os';
import { join, resolve } from 'path';
import {
  createWorkspaceCapability,
  createWorkspaceService,
  expandPath,
  getWorkspaceService,
  isInsideUnselectedAdditionalRoot,
  isLexicallyContained,
  isPathInside,
  isPathWithinWorkspace,
  resetDefaultWorkspaceServiceForTests,
  resolveCandidatePath,
  resolvePath,
  resolveRootForQuery,
  selectEditableRoot,
  withWorkspaceService,
  type WorkspaceService,
  type WorkspaceServiceCreateOptions,
} from '../src/workspace/policy';
import type {
  WorkspaceCapabilityHost,
  WorkspacePolicyOptions,
} from '../src/workspace/contracts';
import { createAgentScope } from '../src/kernel/kernel';
import {
  enterAgentScope,
} from '../src/plugins/compose';
import { createCurrentAgentScope, createCurrentProcessScope } from './helpers/composition';
import { currentAgentPlugins } from './helpers/composition';
import { capekWorkspacePolicyKey } from '../src/plugins/service-keys';
import { configureRuntimeConfiguration } from '../src/configuration/runtime';
import { createDefaultRuntimeConfiguration } from '../src/configuration/defaults';
import { configureRuntimeHost, type RuntimeHost } from '../src/runtime/host';
import { configureStorage, createInMemoryStorageBundle } from '../src/storage';
import { configureSchedulerHost, type SchedulerHost } from '../src/scheduler/host';
import { configureSessionSearchHost, type SessionSearchHost } from '../src/session-search/host';

function minimalHost(): RuntimeHost {
  return {
    interaction: {
      createPendingAsk: async () => 'pending',
      removePendingAsk: async () => {},
      removePendingAsksByToolCallId: async () => {},
      getPermissionRequestByRequestId: async () => null,
      resolvePermissionRequestByRequestId: async () => false,
      expirePermissionRequest: async () => false,
      expireOldPermissionRequests: async () => 0,
      cancelPendingRequestsBySession: async () => 0,
      listPendingAsksBySession: async () => [],
      listPendingAsksByRootSession: async () => [],
      listPendingRequestsByRootSession: async () => [],
      matchGrant: async () => ({ matched: false, grant: null }),
      createGrantFromOptions: async () => null,
      getSessionAutoApproveSeverity: async () => undefined,
      getPermissionTimeoutMs: () => 30 * 60 * 1000,
      notifyPermissionRequired: async () => {},
    },
    delivery: { emit: () => {} },
    titles: {
      isDefaultSessionTitle: () => true,
      hasManualSessionTitle: () => false,
      generateSessionTitle: async () => null,
    },
    workspace: {
      createToolWorkspaceHost: () => ({
        root: '/tmp',
        additionalRoots: undefined,
        allowedRoots: [],
        tempDir: '/tmp/capek-c6-workspace-test',
        getEnvironmentValue: () => undefined,
      }),
    },
    sandbox: { isSandboxActive: () => false },
  };
}

function minimalSearchHost(): SessionSearchHost {
  return {
    getWorkspace: async () => null,
    getSession: async () => null,
    listWorkspaceSessions: async () => [],
    listAgentSessions: async () => [],
    countSessionMessages: async () => 0,
    searchMessages: async () => [],
    countMessagesBefore: async () => 0,
    countMessagesAfter: async () => 0,
    getLatestMessage: async () => null,
    getMessage: async () => null,
    listMessagesBefore: async () => [],
    listMessagesAfter: async () => [],
    getMessageSummary: async () => null,
  };
}

function minimalSchedulerHost(): SchedulerHost {
  return {
    create: () => {
      throw new Error('not configured');
    },
    get: () => null,
    list: () => [],
    update: () => null,
    delete: () => false,
    trigger: () => {},
  };
}

function makeOptions(overrides: Partial<WorkspacePolicyOptions> = {}): WorkspacePolicyOptions {
  return {
    blockedPaths: ['/etc/', '/usr/', '/bin/', '/sbin/', '/boot/', '/dev/', '/proc/', '/sys/', '/root/'],
    sensitivePatterns: ['.env', 'credentials', 'id_rsa', '.pem', 'secret'],
    homeDir: '/home/user',
    ...overrides,
  };
}

function makeService(createOptions: WorkspaceServiceCreateOptions = {}): WorkspaceService {
  return createWorkspaceService({ id: 'test-workspace', options: makeOptions(), ...createOptions });
}

function host(overrides: Partial<WorkspaceCapabilityHost> = {}): WorkspaceCapabilityHost {
  return {
    root: '/workspace/project',
    additionalRoots: ['/workspace/shared'],
    allowedRoots: ['/uploads'],
    tempDir: '/tmp/capek-c6-workspace',
    ...overrides,
  };
}

beforeEach(() => {
  resetDefaultWorkspaceServiceForTests();
  configureStorage(createInMemoryStorageBundle());
  configureRuntimeConfiguration(createDefaultRuntimeConfiguration());
  configureRuntimeHost(minimalHost());
  configureSessionSearchHost(minimalSearchHost());
  configureSchedulerHost(minimalSchedulerHost());
});

afterEach(() => {
  resetDefaultWorkspaceServiceForTests();
});

describe('C6 workspace policy contract', () => {
  test('pins the exact frozen options', () => {
    const service = makeService();
    expect(service.options).toEqual(makeOptions());
    expect(service.options.blockedPaths).not.toBe(makeOptions().blockedPaths);
  });

  test('expandPath expands home paths and resolves', () => {
    const service = makeService();
    expect(service.expandPath('~/notes')).toBe('/home/user/notes');
    expect(service.expandPath('/abs/path')).toBe('/abs/path');
    expect(service.expandPath('relative')).toBe(resolve('relative'));
  });

  test('resolvePathFor handles tilde, absolute, and workspace-relative inputs', () => {
    const service = makeService();
    expect(service.resolvePathFor('~/notes', '/main')).toBe(join('/home/user', 'notes'));
    expect(service.resolvePathFor('/abs/file', '/main')).toBe('/abs/file');
    expect(service.resolvePathFor('sub/file', '/main')).toBe('/main/sub/file');
    expect(resolvePath('sub/file', '/main')).toBe('/main/sub/file');
    expect(expandPath('~/x')).toBe(join(homedir(), 'x'));
  });

  test('isPathWithinWorkspace preserves the containment matrix', () => {
    expect(isPathWithinWorkspace('/main/sub', '/main')).toBe(true);
    expect(isPathWithinWorkspace('/main', '/main')).toBe(true);
    expect(isPathWithinWorkspace('/main-other/x', '/main')).toBe(false);
    expect(isPathWithinWorkspace('/outside', '/main')).toBe(false);
    expect(isPathWithinWorkspace('../escape', '/main')).toBe(false);
    expect(isPathWithinWorkspace('/extra/sub', '/main', ['/extra'])).toBe(true);
    expect(isPathWithinWorkspace('/other', '/main', ['/extra'])).toBe(false);
  });

  test('isPathInside is separator-aware and covers the root', () => {
    expect(isPathInside('/foo/bar', '/foo')).toBe(true);
    expect(isPathInside('/foo', '/foo')).toBe(true);
    expect(isPathInside('/foobar', '/foo')).toBe(false);
    expect(isPathInside('/anything', '/')).toBe(true);
  });

  test('unselected additional roots are detected exactly', () => {
    expect(isInsideUnselectedAdditionalRoot('/extra/x', '/main', ['/extra'])).toBe(true);
    expect(isInsideUnselectedAdditionalRoot('/extra/x', '/extra', ['/extra'])).toBe(false);
    expect(isInsideUnselectedAdditionalRoot('/main/x', '/main', ['/extra'])).toBe(false);
  });

  test('resolveCandidatePath anchors relative inputs, passes absolutes, and normalizes Windows separators', () => {
    expect(resolveCandidatePath('/root', 'sub/file.ts')).toBe('/root/sub/file.ts');
    expect(resolveCandidatePath('/root', '/abs/file.ts')).toBe('/abs/file.ts');
    expect(resolveCandidatePath('/root', 'sub\\win.ts')).toBe('/root/sub/win.ts');
  });

  test('resolveRootForQuery falls back to the main root for missing or invalid roots', () => {
    const workspace = { path: '/main', additionalPaths: ['/extra'] };
    expect(resolveRootForQuery(workspace)).toEqual({ root: '/main', isMain: true });
    expect(resolveRootForQuery(workspace, '/extra')).toEqual({ root: '/extra', isMain: false });
    expect(resolveRootForQuery(workspace, '/main')).toEqual({ root: '/main', isMain: true });
    expect(resolveRootForQuery(workspace, '/other')).toEqual({ root: '/main', isMain: true });
  });

  test('selectEditableRoot rejects roots outside the workspace and additional roots', () => {
    const workspace = { path: '/main', additionalPaths: ['/extra'] };
    expect(selectEditableRoot(workspace)).toEqual({ root: '/main', valid: true });
    expect(selectEditableRoot(workspace, '/extra')).toEqual({ root: '/extra', valid: true });
    expect(selectEditableRoot(workspace, '/other').valid).toBe(false);
  });

  test('tool-runtime lexical containment rejects sibling prefixes', () => {
    const service = makeService();
    expect(service.isLexicallyContained('/workspace/project/file.txt', '/workspace/project')).toBe(true);
    expect(service.isLexicallyContained('/workspace/project-other/file.txt', '/workspace/project')).toBe(false);
    expect(isLexicallyContained('/workspace/project-other/file.txt', '/workspace/project')).toBe(false);
  });

  test('sensitive and blocked classification preserves case rules', () => {
    const service = makeService();
    expect(service.isSensitivePath('/workspace/project/.ENV.local')).toBe(true);
    expect(service.isSensitivePath('/workspace/project/public.txt')).toBe(false);
    expect(service.isBlockedPath('/etc/passwd')).toBe(true);
    expect(service.isBlockedPath('/ETC/passwd')).toBe(false);
  });

  test('custom blocked and sensitive lists are frozen provider options', () => {
    const service = createWorkspaceService({
      id: 'custom',
      options: makeOptions({
        blockedPaths: ['/custom-block/'],
        sensitivePatterns: ['topsecret'],
      }),
    });
    expect(service.isBlockedPath('/custom-block/x')).toBe(true);
    expect(service.isBlockedPath('/etc/passwd')).toBe(false);
    expect(service.isSensitivePath('/a/TOPSECRET.txt')).toBe(true);
    expect(service.isSensitivePath('/a/.env')).toBe(false);
  });
});

describe('C6 workspace capability over the scoped service', () => {
  test('resolves the effective root and additional roots lexically', () => {
    const workspace = createWorkspaceCapability(host());
    expect(workspace.effectiveRoot).toBe(resolve('/workspace/project'));
    expect(workspace.additionalRoots).toEqual([resolve('/workspace/shared')]);
    expect(workspace.resolvePath('src/index.ts')).toBe(resolve('/workspace/project/src/index.ts'));
    expect(workspace.isWithinWorkspace('/workspace/project/src/index.ts')).toBe(true);
    expect(workspace.isWithinWorkspace('/workspace/shared/file.txt')).toBe(true);
    expect(workspace.isWithinWorkspace('/uploads/file.txt')).toBe(false);
  });

  test('falls back to process.cwd when no root is supplied', () => {
    const workspace = createWorkspaceCapability(host({ root: undefined }));
    expect(workspace.effectiveRoot).toBe(resolve(process.cwd()));
    expect(workspace.resolvePath('file.txt')).toBe(resolve(process.cwd(), 'file.txt'));
  });

  test('the capability tilde resolution uses the active service home directory', () => {
    const service = makeService();
    const capability = service.createCapability(host());
    expect(capability.resolvePath('~/file.txt')).toBe(join('/home/user', 'file.txt'));
    expect(capability.resolvePath('~user/file.txt')).toBe(resolve('/workspace/project/~user/file.txt'));
    // The unscoped service uses the real process home.
    const defaultCapability = createWorkspaceCapability(host());
    expect(defaultCapability.resolvePath('~/file.txt')).toBe(join(homedir(), 'file.txt'));
  });

  test('rejects sibling-prefix paths with separator-aware containment', () => {
    const workspace = createWorkspaceCapability(host());
    expect(workspace.isWithinWorkspace('/workspace/project-other/file.txt')).toBe(false);
    expect(workspace.isWithinWorkspace('/workspace/shared-other/file.txt')).toBe(false);
  });

  test('preserves sensitive and case-sensitive blocked classification', () => {
    const workspace = createWorkspaceCapability(host());
    expect(workspace.isSensitivePath('/workspace/project/.ENV.local')).toBe(true);
    expect(workspace.isSensitivePath('/workspace/project/public.txt')).toBe(false);
    expect(workspace.isBlockedPath('/etc/passwd')).toBe(true);
    expect(workspace.isBlockedPath('/ETC/passwd')).toBe(false);
  });

  test('preserves environment overlay precedence and process fallback', () => {
    const key = 'CAPEK_C6_WORKSPACE_ENV_TEST';
    const previous = process.env[key];
    process.env[key] = 'process';

    try {
      const overlay = createWorkspaceCapability(host({
        getEnvironmentValue: (candidate) => candidate === key ? 'overlay' : undefined,
      }));
      const fallback = createWorkspaceCapability(host());
      expect(overlay.getEnvironmentValue(key)).toBe('overlay');
      expect(fallback.getEnvironmentValue(key)).toBe('process');
    } finally {
      if (previous === undefined) delete process.env[key];
      else process.env[key] = previous;
    }
  });

  test('normalizes add and remove callback paths and denies absent mutation rights', async () => {
    const calls: string[] = [];
    const workspace = createWorkspaceCapability(host({
      addAdditionalRoot: (path) => {
        calls.push(`add:${path}`);
        return true;
      },
      removeAdditionalRoot: (path) => {
        calls.push(`remove:${path}`);
        return true;
      },
    }));

    expect(await workspace.addWorkspacePath('./additional')).toBe(true);
    expect(await workspace.removeWorkspacePath('./additional')).toBe(true);
    expect(calls).toEqual([
      `add:${resolve('./additional')}`,
      `remove:${resolve('./additional')}`,
    ]);

    const immutable = createWorkspaceCapability(host());
    expect(await immutable.addWorkspacePath('/other')).toBe(false);
    expect(await immutable.removeWorkspacePath('/other')).toBe(false);
  });
});

describe('C6 scoped workspace policy composition', () => {
  test('the current composition provides an agent-scoped policy with the exact defaults', async () => {
    const processScope = await createCurrentProcessScope();
    const agentScope = await createCurrentAgentScope(processScope);
    try {
      const service: WorkspaceService = agentScope.require(capekWorkspacePolicyKey);
      expect(service.id).toBe('current.workspace-policy');
      expect(service.options.homeDir).toBe(homedir());
      expect(service.isBlockedPath('/etc/passwd')).toBe(true);
      expect(service.isSensitivePath('/x/.env')).toBe(true);
    } finally {
      await agentScope.dispose();
      await processScope.dispose();
    }
  });

  test('the workspace policy is an explicit required agent-scoped provider', async () => {
    const processScope = await createCurrentProcessScope();
    const plugins = currentAgentPlugins()
      .filter((plugin) => plugin.id !== 'current.workspace-policy');
    const agentScope = await createAgentScope(processScope, [...plugins]);
    try {
      expect(() => enterAgentScope(agentScope, () => undefined))
        .toThrow(/service 'capek\.workspace-policy' is not available/);
    } finally {
      await agentScope.dispose();
      await processScope.dispose();
    }
  });

  test('enterAgentScope seeds the scope-owned service and two agents stay isolated', async () => {
    const processScope = await createCurrentProcessScope();
    const scopeA = await createCurrentAgentScope(processScope);
    const scopeB = await createCurrentAgentScope(processScope);
    try {
      const serviceA: WorkspaceService = scopeA.require(capekWorkspacePolicyKey);
      const serviceB: WorkspaceService = scopeB.require(capekWorkspacePolicyKey);
      expect(serviceA).not.toBe(serviceB);

      let observed: WorkspaceService | null = null;
      enterAgentScope(scopeA, () => {
        observed = getWorkspaceService();
      });
      expect(observed === serviceA).toBe(true);
      expect(getWorkspaceService() === serviceA).toBe(false);

      // Custom frozen options never leak across scopes.
      withWorkspaceService(createWorkspaceService({
        id: 'isolated',
        options: makeOptions({ blockedPaths: ['/scoped-block/'] }),
      }), () => {
        expect(getWorkspaceService().isBlockedPath('/scoped-block/x')).toBe(true);
        expect(getWorkspaceService().isBlockedPath('/etc/passwd')).toBe(false);
      });
      expect(getWorkspaceService().isBlockedPath('/scoped-block/x')).toBe(false);
    } finally {
      await scopeA.dispose();
      await scopeB.dispose();
      await processScope.dispose();
    }
  });

  test('the unscoped process default carries the exact pre-C6 defaults', () => {
    const service = getWorkspaceService();
    expect(service.id).toBe('workspace.process-default');
    expect(service.options.homeDir).toBe(homedir());
    expect(service.isBlockedPath('/usr/lib/x')).toBe(true);
    expect(service.isSensitivePath('/a/.pem')).toBe(true);
  });
});
