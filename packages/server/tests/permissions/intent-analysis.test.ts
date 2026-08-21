import { describe, test, expect } from 'bun:test';

import {
  analyzeShellCommandEffects,
  getAllowedScopesForIntent,
  createShellPermissionAskStructured,
  createOutsideWorkspaceAsk,
  createWorkspaceModificationAsk,
  type PermissionIntent,
} from '@prokopai/sdk';

// =============================================================================
// Test Suite A — Permission Intent Analysis
//
// Tests the core analyzeShellCommandEffects() function that converts shell
// commands into structured PermissionIntent objects.
// =============================================================================

describe('permission intent analysis', () => {
  // ===========================================================================
  // File Read Commands
  // ===========================================================================

  describe('file read commands', () => {
    test('cat .env → file read exact .env', () => {
      const intents = analyzeShellCommandEffects({
        command: 'cat .env',
        baseCommand: 'cat',
        resolvedPaths: ['/workspace/.env'],
        hasOperators: false,
        workspaceBound: true,
        riskCategory: 'sensitive-files',
      });

      expect(intents).toHaveLength(1);
      const intent = intents[0];
      expect(intent.resource).toBe('file');
      expect(intent.action).toBe('read');
      expect(intent.persistable).toBe(true);
      expect(intent.targets).toHaveLength(1);
      expect(intent.targets[0].target).toBe('/workspace/.env');
      expect(intent.targets[0].matcher).toBe('exact');
    });

    test('cat src/index.ts → file read exact path', () => {
      const intents = analyzeShellCommandEffects({
        command: 'cat src/index.ts',
        baseCommand: 'cat',
        resolvedPaths: ['/workspace/src/index.ts'],
        hasOperators: false,
        workspaceBound: true,
        riskCategory: 'side-effect',
      });

      expect(intents).toHaveLength(1);
      expect(intents[0].resource).toBe('file');
      expect(intents[0].action).toBe('read');
      expect(intents[0].targets[0].target).toBe('/workspace/src/index.ts');
      expect(intents[0].targets[0].matcher).toBe('exact');
    });

    test('head -n 5 config.yml → file read exact', () => {
      const intents = analyzeShellCommandEffects({
        command: 'head -n 5 config.yml',
        baseCommand: 'head',
        resolvedPaths: ['/workspace/config.yml'],
        hasOperators: false,
        workspaceBound: true,
        riskCategory: 'side-effect',
      });

      expect(intents).toHaveLength(1);
      expect(intents[0].resource).toBe('file');
      expect(intents[0].action).toBe('read');
      expect(intents[0].targets[0].target).toBe('/workspace/config.yml');
    });

    test('grep "pattern" file.txt → file read', () => {
      const intents = analyzeShellCommandEffects({
        command: 'grep "TODO" src/main.ts',
        baseCommand: 'grep',
        resolvedPaths: ['/workspace/src/main.ts'],
        hasOperators: false,
        workspaceBound: true,
        riskCategory: 'side-effect',
      });

      expect(intents).toHaveLength(1);
      expect(intents[0].resource).toBe('file');
      expect(intents[0].action).toBe('read');
    });

    test('cat with no resolved paths → shell-execute fallback', () => {
      const intents = analyzeShellCommandEffects({
        command: 'cat',
        baseCommand: 'cat',
        resolvedPaths: [],
        hasOperators: false,
        workspaceBound: true,
        riskCategory: 'side-effect',
      });

      expect(intents).toHaveLength(1);
      expect(intents[0].resource).toBe('shell-command');
      expect(intents[0].action).toBe('execute');
      expect(intents[0].persistable).toBe(false);
    });

    test('cat with dynamic variable → shell-execute fallback, non-persistable', () => {
      const intents = analyzeShellCommandEffects({
        command: 'cat $FILE',
        baseCommand: 'cat',
        resolvedPaths: ['/workspace/$FILE'],
        hasOperators: false,
        workspaceBound: true,
        riskCategory: 'side-effect',
      });

      expect(intents).toHaveLength(1);
      expect(intents[0].resource).toBe('shell-command');
      expect(intents[0].action).toBe('execute');
      expect(intents[0].persistable).toBe(false);
      expect(intents[0].nonPersistableReason).toContain('dynamic');
    });

    test('cat with multiple files → multiple exact targets', () => {
      const intents = analyzeShellCommandEffects({
        command: 'cat file1.ts file2.ts',
        baseCommand: 'cat',
        resolvedPaths: ['/workspace/file1.ts', '/workspace/file2.ts'],
        hasOperators: false,
        workspaceBound: true,
        riskCategory: 'side-effect',
      });

      expect(intents).toHaveLength(1);
      expect(intents[0].targets).toHaveLength(2);
      expect(intents[0].targets[0].target).toBe('/workspace/file1.ts');
      expect(intents[0].targets[1].target).toBe('/workspace/file2.ts');
      expect(intents[0].targets[0].matcher).toBe('exact');
      expect(intents[0].targets[1].matcher).toBe('exact');
    });
  });

  // ===========================================================================
  // File Delete Commands
  // ===========================================================================

  describe('file delete commands', () => {
    test('rm -rf build → file delete prefix build/', () => {
      const intents = analyzeShellCommandEffects({
        command: 'rm -rf build',
        baseCommand: 'rm',
        resolvedPaths: ['/workspace/build'],
        hasOperators: false,
        workspaceBound: true,
        riskCategory: 'destructive',
      });

      expect(intents).toHaveLength(1);
      const intent = intents[0];
      expect(intent.resource).toBe('file');
      expect(intent.action).toBe('delete');
      expect(intent.persistable).toBe(true);
      expect(intent.targets).toHaveLength(1);
      expect(intent.targets[0].target).toBe('/workspace/build/');
      expect(intent.targets[0].matcher).toBe('prefix');
    });

    test('rm file.txt → file delete exact', () => {
      const intents = analyzeShellCommandEffects({
        command: 'rm file.txt',
        baseCommand: 'rm',
        resolvedPaths: ['/workspace/file.txt'],
        hasOperators: false,
        workspaceBound: true,
        riskCategory: 'destructive',
      });

      expect(intents).toHaveLength(1);
      expect(intents[0].resource).toBe('file');
      expect(intents[0].action).toBe('delete');
      expect(intents[0].targets[0].matcher).toBe('exact');
      expect(intents[0].targets[0].target).toBe('/workspace/file.txt');
    });

    test('rm -rf $TARGET → non-persistable dynamic deletion', () => {
      const intents = analyzeShellCommandEffects({
        command: 'rm -rf $TARGET',
        baseCommand: 'rm',
        resolvedPaths: ['/workspace/$TARGET'],
        hasOperators: false,
        workspaceBound: true,
        riskCategory: 'destructive',
      });

      expect(intents).toHaveLength(1);
      expect(intents[0].resource).toBe('shell-command');
      expect(intents[0].action).toBe('execute');
      expect(intents[0].persistable).toBe(false);
      expect(intents[0].nonPersistableReason).toContain('dynamic');
    });

    test('rmdir empty-dir → file delete exact', () => {
      const intents = analyzeShellCommandEffects({
        command: 'rmdir empty-dir',
        baseCommand: 'rmdir',
        resolvedPaths: ['/workspace/empty-dir'],
        hasOperators: false,
        workspaceBound: true,
        riskCategory: 'destructive',
      });

      expect(intents).toHaveLength(1);
      expect(intents[0].resource).toBe('file');
      expect(intents[0].action).toBe('delete');
    });
  });

  // ===========================================================================
  // Network Commands
  // ===========================================================================

  describe('network commands', () => {
    test('curl https://api.example.com → network request exact host', () => {
      const intents = analyzeShellCommandEffects({
        command: 'curl https://api.example.com',
        baseCommand: 'curl',
        resolvedPaths: [],
        hasOperators: false,
        workspaceBound: true,
        riskCategory: 'network',
      });

      expect(intents).toHaveLength(1);
      const intent = intents[0];
      expect(intent.resource).toBe('network');
      expect(intent.action).toBe('request');
      expect(intent.persistable).toBe(true);
      // Should have at least the host as a target
      expect(intent.targets.length).toBeGreaterThanOrEqual(1);
      expect(intent.targets.some(t => t.target === 'api.example.com')).toBe(true);
    });

    test('curl https://api.example.com/x/path → network request with path prefix', () => {
      const intents = analyzeShellCommandEffects({
        command: 'curl https://api.example.com/x/path',
        baseCommand: 'curl',
        resolvedPaths: [],
        hasOperators: false,
        workspaceBound: true,
        riskCategory: 'network',
      });

      expect(intents).toHaveLength(1);
      expect(intents[0].resource).toBe('network');
      expect(intents[0].action).toBe('request');
      // Should have host target + possibly path prefix target
      const hostTarget = intents[0].targets.find(t => t.target === 'api.example.com');
      expect(hostTarget).toBeDefined();
      expect(hostTarget!.matcher).toBe('exact');
    });

    test('curl with dynamic URL → non-persistable', () => {
      const intents = analyzeShellCommandEffects({
        command: 'curl $API_URL',
        baseCommand: 'curl',
        resolvedPaths: [],
        hasOperators: false,
        workspaceBound: true,
        riskCategory: 'network',
      });

      expect(intents).toHaveLength(1);
      expect(intents[0].resource).toBe('shell-command');
      expect(intents[0].action).toBe('execute');
      expect(intents[0].persistable).toBe(false);
      expect(intents[0].nonPersistableReason).toBeDefined();
    });

    test('wget https://example.com → network request', () => {
      const intents = analyzeShellCommandEffects({
        command: 'wget https://example.com/file.tar.gz',
        baseCommand: 'wget',
        resolvedPaths: [],
        hasOperators: false,
        workspaceBound: true,
        riskCategory: 'network',
      });

      expect(intents).toHaveLength(1);
      expect(intents[0].resource).toBe('network');
      expect(intents[0].action).toBe('request');
    });

    test('curl with no extractable URL → shell-execute fallback', () => {
      const intents = analyzeShellCommandEffects({
        command: 'curl',
        baseCommand: 'curl',
        resolvedPaths: [],
        hasOperators: false,
        workspaceBound: true,
        riskCategory: 'network',
      });

      expect(intents).toHaveLength(1);
      expect(intents[0].resource).toBe('shell-command');
      expect(intents[0].action).toBe('execute');
      expect(intents[0].persistable).toBe(false);
    });
  });

  // ===========================================================================
  // File Write / Modification Commands
  // ===========================================================================

  describe('file write commands', () => {
    test('touch newfile.txt → file write exact', () => {
      const intents = analyzeShellCommandEffects({
        command: 'touch newfile.txt',
        baseCommand: 'touch',
        resolvedPaths: ['/workspace/newfile.txt'],
        hasOperators: false,
        workspaceBound: true,
        riskCategory: 'workspace-modification',
      });

      expect(intents).toHaveLength(1);
      expect(intents[0].resource).toBe('file');
      expect(intents[0].action).toBe('write');
      expect(intents[0].persistable).toBe(true);
      expect(intents[0].targets[0].matcher).toBe('exact');
    });

    test('mkdir newdir → file write exact', () => {
      const intents = analyzeShellCommandEffects({
        command: 'mkdir newdir',
        baseCommand: 'mkdir',
        resolvedPaths: ['/workspace/newdir'],
        hasOperators: false,
        workspaceBound: true,
        riskCategory: 'workspace-modification',
      });

      expect(intents).toHaveLength(1);
      expect(intents[0].resource).toBe('file');
      expect(intents[0].action).toBe('write');
    });

    test('mv src dest → file write', () => {
      const intents = analyzeShellCommandEffects({
        command: 'mv old.ts new.ts',
        baseCommand: 'mv',
        resolvedPaths: ['/workspace/old.ts', '/workspace/new.ts'],
        hasOperators: false,
        workspaceBound: true,
        riskCategory: 'workspace-modification',
      });

      expect(intents).toHaveLength(1);
      expect(intents[0].resource).toBe('file');
      expect(intents[0].action).toBe('write');
    });

    test('cp src dest → file write', () => {
      const intents = analyzeShellCommandEffects({
        command: 'cp original.ts copy.ts',
        baseCommand: 'cp',
        resolvedPaths: ['/workspace/original.ts', '/workspace/copy.ts'],
        hasOperators: false,
        workspaceBound: true,
        riskCategory: 'workspace-modification',
      });

      expect(intents).toHaveLength(1);
      expect(intents[0].resource).toBe('file');
      expect(intents[0].action).toBe('write');
    });
  });

  // ===========================================================================
  // Shell Operators / Complex Commands
  // ===========================================================================

  describe('shell operators and complex commands', () => {
    test('command with && → shell-execute fallback, non-persistable', () => {
      const intents = analyzeShellCommandEffects({
        command: 'cat .env && echo done',
        baseCommand: 'cat',
        resolvedPaths: ['/workspace/.env'],
        hasOperators: true,
        workspaceBound: true,
        riskCategory: 'side-effect',
      });

      expect(intents).toHaveLength(1);
      expect(intents[0].resource).toBe('shell-command');
      expect(intents[0].action).toBe('execute');
      expect(intents[0].persistable).toBe(false);
      expect(intents[0].nonPersistableReason).toContain('operator');
    });

    test('command with | → shell-execute fallback', () => {
      const intents = analyzeShellCommandEffects({
        command: 'cat .env | grep KEY',
        baseCommand: 'cat',
        resolvedPaths: ['/workspace/.env'],
        hasOperators: true,
        workspaceBound: true,
        riskCategory: 'side-effect',
      });

      expect(intents).toHaveLength(1);
      expect(intents[0].resource).toBe('shell-command');
      expect(intents[0].persistable).toBe(false);
    });

    test('command with > → shell-execute fallback', () => {
      const intents = analyzeShellCommandEffects({
        command: 'echo hello > output.txt',
        baseCommand: 'echo',
        resolvedPaths: ['/workspace/output.txt'],
        hasOperators: true,
        workspaceBound: true,
        riskCategory: 'workspace-modification',
      });

      expect(intents).toHaveLength(1);
      expect(intents[0].resource).toBe('shell-command');
      expect(intents[0].persistable).toBe(false);
    });

    test('bash -c "cat .env" → shell-execute fallback', () => {
      const intents = analyzeShellCommandEffects({
        command: 'bash -c "cat .env"',
        baseCommand: 'bash',
        resolvedPaths: [],
        hasOperators: false,
        workspaceBound: true,
        riskCategory: 'side-effect',
      });

      expect(intents).toHaveLength(1);
      expect(intents[0].resource).toBe('shell-command');
      expect(intents[0].action).toBe('execute');
    });
  });

  // ===========================================================================
  // Unclassifiable / System Commands
  // ===========================================================================

  describe('unclassifiable system commands', () => {
    test('sudo rm -rf / → shell-execute fallback', () => {
      const intents = analyzeShellCommandEffects({
        command: 'sudo rm -rf /',
        baseCommand: 'sudo',
        resolvedPaths: ['/'],
        hasOperators: false,
        workspaceBound: false,
        riskCategory: 'destructive',
      });

      expect(intents).toHaveLength(1);
      expect(intents[0].resource).toBe('shell-command');
      expect(intents[0].action).toBe('execute');
      expect(intents[0].persistable).toBe(false);
    });

    test('chmod 755 script.sh → shell-execute fallback', () => {
      const intents = analyzeShellCommandEffects({
        command: 'chmod 755 script.sh',
        baseCommand: 'chmod',
        resolvedPaths: ['/workspace/script.sh'],
        hasOperators: false,
        workspaceBound: true,
        riskCategory: 'side-effect',
      });

      expect(intents).toHaveLength(1);
      expect(intents[0].resource).toBe('shell-command');
      expect(intents[0].persistable).toBe(false);
    });

    test('eval "command" → shell-execute fallback', () => {
      const intents = analyzeShellCommandEffects({
        command: 'eval "echo hello"',
        baseCommand: 'eval',
        resolvedPaths: [],
        hasOperators: false,
        workspaceBound: true,
        riskCategory: 'side-effect',
      });

      expect(intents).toHaveLength(1);
      expect(intents[0].resource).toBe('shell-command');
      expect(intents[0].action).toBe('execute');
      expect(intents[0].persistable).toBe(false);
    });
  });

  // ===========================================================================
  // Sensitive Files Risk Category
  // ===========================================================================

  describe('sensitive-files risk category', () => {
    test('unknown command with sensitive file paths → file read intent', () => {
      const intents = analyzeShellCommandEffects({
        command: 'unknown-tool .env',
        baseCommand: 'unknown-tool',
        resolvedPaths: ['/workspace/.env'],
        hasOperators: false,
        workspaceBound: true,
        riskCategory: 'sensitive-files',
      });

      expect(intents).toHaveLength(1);
      expect(intents[0].resource).toBe('file');
      expect(intents[0].action).toBe('read');
      expect(intents[0].persistable).toBe(true);
    });
  });
});

// =============================================================================
// Test Suite C — Scope Policy Tests
//
// Tests the getAllowedScopesForIntent() function to verify that scope policy
// is enforced correctly per intent type.
// =============================================================================

describe('scope policy', () => {
  test('file read allows workspace scope', () => {
    const intent: PermissionIntent = {
      resource: 'file',
      action: 'read',
      targets: [{ target: '/workspace/.env', matcher: 'exact' }],
      persistable: true,
      allowedScopes: [],
    };
    const scopes = getAllowedScopesForIntent(intent);
    expect(scopes).toContain('once');
    expect(scopes).toContain('session');
    expect(scopes).toContain('workspace');
  });

  test('file write allows workspace scope', () => {
    const intent: PermissionIntent = {
      resource: 'file',
      action: 'write',
      targets: [{ target: '/workspace/newfile.ts', matcher: 'exact' }],
      persistable: true,
      allowedScopes: [],
    };
    const scopes = getAllowedScopesForIntent(intent);
    expect(scopes).toContain('workspace');
  });

  test('file delete does NOT allow workspace scope', () => {
    const intent: PermissionIntent = {
      resource: 'file',
      action: 'delete',
      targets: [{ target: '/workspace/build/', matcher: 'prefix' }],
      persistable: true,
      allowedScopes: [],
    };
    const scopes = getAllowedScopesForIntent(intent);
    expect(scopes).toContain('once');
    expect(scopes).toContain('session');
    expect(scopes).not.toContain('workspace');
  });

  test('network request allows workspace scope', () => {
    const intent: PermissionIntent = {
      resource: 'network',
      action: 'request',
      targets: [{ target: 'api.example.com', matcher: 'exact' }],
      persistable: true,
      allowedScopes: [],
    };
    const scopes = getAllowedScopesForIntent(intent);
    expect(scopes).toContain('once');
    expect(scopes).toContain('session');
    expect(scopes).toContain('workspace');
  });

  test('shell execute (persistable) does NOT allow workspace scope', () => {
    const intent: PermissionIntent = {
      resource: 'shell-command',
      action: 'execute',
      targets: [{ target: 'sudo', matcher: 'exact' }],
      persistable: true,
      allowedScopes: [],
    };
    const scopes = getAllowedScopesForIntent(intent);
    expect(scopes).toContain('once');
    expect(scopes).toContain('session');
    expect(scopes).not.toContain('workspace');
  });

  test('non-persistable intent only allows once', () => {
    const intent: PermissionIntent = {
      resource: 'shell-command',
      action: 'execute',
      targets: [{ target: 'rm', matcher: 'exact' }],
      persistable: false,
      nonPersistableReason: 'command contains shell operators',
      allowedScopes: [],
    };
    const scopes = getAllowedScopesForIntent(intent);
    expect(scopes).toEqual(['once']);
  });

  test('dynamic shell execute does NOT allow workspace scope', () => {
    const intent: PermissionIntent = {
      resource: 'shell-command',
      action: 'execute',
      targets: [{ target: 'rm', matcher: 'exact' }],
      persistable: false,
      nonPersistableReason: 'dynamic variable expansion',
      allowedScopes: [],
    };
    const scopes = getAllowedScopesForIntent(intent);
    expect(scopes).not.toContain('workspace');
  });

  test('file delete with dynamic variables only allows once', () => {
    const intent: PermissionIntent = {
      resource: 'shell-command',
      action: 'execute',
      targets: [{ target: 'rm', matcher: 'exact' }],
      persistable: false,
      nonPersistableReason: 'dynamic variable expansion',
      allowedScopes: [],
    };
    const scopes = getAllowedScopesForIntent(intent);
    expect(scopes).toEqual(['once']);
  });
});

// =============================================================================
// Test Suite A.2 — Shell Permission Ask Creators
//
// Tests that createShellPermissionAskStructured, createOutsideWorkspaceAsk,
// and createWorkspaceModificationAsk correctly embed intent analysis results.
// =============================================================================

describe('shell permission ask creators', () => {
  describe('createShellPermissionAskStructured', () => {
    test('cat .env produces file-read ask with correct intents', () => {
      const ask = createShellPermissionAskStructured({
        command: 'cat .env',
        baseCommand: 'cat',
        flags: [],
        risk: 'high',
        riskCategory: 'sensitive-files',
        reason: 'Sensitive file access',
        resolvedPaths: ['/workspace/.env'],
        workspaceBound: true,
        hasOperators: false,
      });

      expect(ask.type).toBe('permission');
      expect(ask.resource).toBe('file');
      expect(ask.action).toBe('read');
      expect(ask.intents).toBeDefined();
      expect(ask.intents).toHaveLength(1);
      expect(ask.intents![0].resource).toBe('file');
      expect(ask.intents![0].action).toBe('read');
      expect(ask.intents![0].targets[0].target).toBe('/workspace/.env');
      expect(ask.intents![0].targets[0].matcher).toBe('exact');
      expect(ask.allowedScopes).toBeDefined();
      expect(ask.allowedScopes).toContain('workspace');
      expect(ask.patterns).toContain('/workspace/.env');
    });

    test('rm -rf build produces file-delete ask with prefix targets', () => {
      const ask = createShellPermissionAskStructured({
        command: 'rm -rf build',
        baseCommand: 'rm',
        flags: ['-r', '-f'],
        risk: 'high',
        riskCategory: 'destructive',
        reason: 'Destructive operation',
        resolvedPaths: ['/workspace/build'],
        workspaceBound: true,
        hasOperators: false,
      });

      expect(ask.type).toBe('permission');
      expect(ask.resource).toBe('file');
      expect(ask.action).toBe('delete');
      expect(ask.intents).toHaveLength(1);
      expect(ask.intents![0].targets[0].target).toBe('/workspace/build/');
      expect(ask.intents![0].targets[0].matcher).toBe('prefix');
      // File delete should NOT allow workspace
      expect(ask.intents![0].allowedScopes).not.toContain('workspace');
    });

    test('curl with operators → non-persistable shell-execute', () => {
      const ask = createShellPermissionAskStructured({
        command: 'curl https://api.example.com && echo done',
        baseCommand: 'curl',
        flags: [],
        risk: 'medium',
        riskCategory: 'network',
        reason: 'Network access',
        resolvedPaths: [],
        workspaceBound: true,
        hasOperators: true,
      });

      expect(ask.intents).toHaveLength(1);
      expect(ask.intents![0].resource).toBe('shell-command');
      expect(ask.intents![0].persistable).toBe(false);
    });

    test('dynamic rm command → once-only scope', () => {
      const ask = createShellPermissionAskStructured({
        command: 'rm -rf $TARGET',
        baseCommand: 'rm',
        flags: ['-r', '-f'],
        risk: 'high',
        riskCategory: 'destructive',
        reason: 'Dynamic destructive operation',
        resolvedPaths: ['/workspace/$TARGET'],
        workspaceBound: true,
        hasOperators: false,
      });

      expect(ask.intents).toHaveLength(1);
      expect(ask.intents![0].persistable).toBe(false);
      expect(ask.intents![0].allowedScopes).toEqual(['once']);
    });
  });

  describe('createOutsideWorkspaceAsk', () => {
    test('produces ask with intent analysis', () => {
      const ask = createOutsideWorkspaceAsk({
        command: 'cat /etc/hosts',
        cwd: '/etc',
        resolvedPaths: ['/etc/hosts'],
      });

      expect(ask.type).toBe('permission');
      expect(ask.intents).toBeDefined();
      expect(ask.intents!.length).toBeGreaterThan(0);
      expect(ask.metadata?.riskCategory).toBe('outside-workspace');
    });
  });

  describe('createWorkspaceModificationAsk', () => {
    test('produces ask with file-write intent for mkdir', () => {
      const ask = createWorkspaceModificationAsk({
        command: 'mkdir newdir',
        baseCommand: 'mkdir',
        resolvedPaths: ['/workspace/newdir'],
      });

      expect(ask.type).toBe('permission');
      expect(ask.intents).toBeDefined();
      expect(ask.intents!.length).toBeGreaterThan(0);
      expect(ask.intents![0].resource).toBe('file');
      expect(ask.intents![0].action).toBe('write');
    });
  });
});
