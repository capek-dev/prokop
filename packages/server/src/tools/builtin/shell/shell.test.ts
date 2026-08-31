import { describe, test, expect, mock, beforeEach, afterEach } from 'bun:test';
import { resolve } from 'node:path';
import type { ToolContext, PermissionAsk } from '@prokopai/sdk';
import { definition, execute } from './tool';

// ── Mock Bun.spawn so NO real processes ever execute ─────────

const FAKE_STDOUT = Buffer.from('mock-output');
const FAKE_STDERR = Buffer.from('');

const originalSpawn = Bun.spawn;
let spawnSyncCalls: { shell: string[]; cwd: string }[] = [];
let spawnSyncBehavior: 'success' | 'fail' = 'success';

function createMockProcess(stdout: Buffer, stderr: Buffer, exitCode: number): ReturnType<typeof Bun.spawn> {
  return {
    stdout,
    stderr,
    exited: Promise.resolve(exitCode),
    exitCode,
    signalCode: null,
    killed: false,
    pid: -1,
    ref: () => {},
    unref: () => {},
    kill: () => true,
  } as unknown as ReturnType<typeof Bun.spawn>;
}

function mockSpawn(
  cmd: string[],
  opts?: { cwd?: string },
): ReturnType<typeof Bun.spawn> {
  spawnSyncCalls.push({ shell: cmd, cwd: opts?.cwd ?? '' });
  return spawnSyncBehavior === 'success'
    ? createMockProcess(FAKE_STDOUT, FAKE_STDERR, 0)
    : createMockProcess(Buffer.from(''), Buffer.from('mock-error'), 1);
}

beforeEach(() => {
  spawnSyncCalls = [];
  spawnSyncBehavior = 'success';
  // @ts-expect-error -- overriding global for test isolation
  Bun.spawn = mockSpawn;
});

afterEach(() => {
  Bun.spawn = originalSpawn;
});

// ── Mock Tool Context ────────────────────────────────────────────

const WORKSPACE = '/workspace/project';

function createMockContext(overrides: Partial<ToolContext> = {}): ToolContext {
  return {
    sessionId: 'test-session-123',
    workspacePath: WORKSPACE,
    workspaceId: 'ws-1',
    abortSignal: new AbortController().signal,
    allowedPaths: [],

    fs: {
      resolve: (p: string) => {
        if (p.startsWith('/')) return p;
        return `${WORKSPACE}/${p}`;
      },
      readFile: mock(async (_path: string, _encoding?: string) => new Uint8Array()) as unknown as ToolContext['fs']['readFile'],
      writeFile: mock(async () => {}),
      appendFile: mock(async () => {}),
      readDir: mock(async () => []),
      exists: mock(async () => false),
      stat: mock(async () => ({
        size: 0,
        isDirectory: false,
        isFile: true,
        modifiedAt: new Date(),
        createdAt: new Date(),
      })),
      mkdir: mock(async () => {}),
      rm: mock(async () => {}),
      rename: mock(async () => {}),
      detectLanguage: () => 'text',
      tempDir: '/tmp/jean2/test-session-123',
    },

    llm: {
      generateText: mock(async () => ''),
      generateStructured: mock(async () => ({})) as unknown as ToolContext['llm']['generateStructured'],
    },

    ask: mock(async (_request: unknown) => true) as unknown as ToolContext['ask'],

    env: {
      get: (_key: string) => undefined,
      require: (_key: string) => { throw new Error('Not set'); },
    },

    logger: {
      debug: mock(() => {}),
      info: mock(() => {}),
      warn: mock(() => {}),
      error: mock(() => {}),
    },

    fetch: globalThis.fetch.bind(globalThis),

    resolvePath(path: string): string {
      if (path.startsWith('~/') || path === '~') {
        return `/home/user${path.slice(1)}`;
      }
      if (path.startsWith('/')) {
        return path;
      }
      return `${WORKSPACE}/${path}`;
    },

    isWithinWorkspace(path: string): boolean {
      return path.startsWith(WORKSPACE);
    },

    isSensitivePath(path: string): boolean {
      const lower = path.toLowerCase();
      return ['.env', '.pem', '.key', '.ssh/', 'id_rsa'].some(p => lower.includes(p));
    },

    isBlockedPath(path: string): boolean {
      return ['/etc/', '/usr/', '/bin/', '/sbin/'].some(p => path.startsWith(p));
    },

    addWorkspacePath: async () => true,
    removeWorkspacePath: async () => true,

    ...overrides,
  };
}

// ── Helpers ──────────────────────────────────────────────────────

function getAskCall(ctx: ToolContext): PermissionAsk {
  const calls = (ctx.ask as ReturnType<typeof mock>).mock.calls;
  expect(calls.length).toBeGreaterThan(0);
  return calls[0][0] as PermissionAsk;
}

// ══════════════════════════════════════════════════════════════════
// Tool Definition
// ══════════════════════════════════════════════════════════════════

describe('shell tool definition', () => {
  test('has correct name', () => {
    expect(definition.name).toBe('shell');
  });

  test('has description mentioning shell commands', () => {
    expect(definition.description).toBeTruthy();
    expect(definition.description).toContain('shell command');
  });

  test('has required command input', () => {
    const schema = definition.inputSchema as {
      type: string;
      properties: Record<string, unknown>;
      required: string[];
    };
    expect(schema.type).toBe('object');
    expect(schema.properties.command).toBeDefined();
    expect(schema.required).toContain('command');
  });

  test('has optional cwd input', () => {
    const schema = definition.inputSchema as {
      properties: Record<string, { type: string; description: string }>;
    };
    expect(schema.properties.cwd).toBeDefined();
    expect(schema.properties.cwd.type).toBe('string');
  });

  test('has 60 second timeout', () => {
    expect(definition.timeout).toBe(60000);
  });
});

describe('windows shell selection', () => {
  test('uses cmd.exe directly on windows (no PowerShell wrapper)', async () => {
    const originalPlatform = process.platform;
    // Simulate Windows so the cmd.exe branch is exercised regardless of
    // the OS the test suite actually runs on.
    Object.defineProperty(process, 'platform', { value: 'win32', configurable: true });

    try {
      const ctx = createMockContext({ ask: mock(async () => true) as unknown as ToolContext['ask'] });
      await execute({ command: 'echo hello' }, ctx);
      expect(spawnSyncCalls.length).toBe(1);
      // cmd.exe inherits the server's environment directly; PATH/PATHEXT
      // resolution happens natively without a PowerShell intermediary.
      // resolveCmdExe() returns an absolute path when available, falling back
      // to the bare 'cmd.exe' name otherwise.
      const shellBin = spawnSyncCalls[0].shell[0];
      expect(shellBin).toMatch(/cmd\.exe$/);
      expect(spawnSyncCalls[0].shell.slice(1)).toEqual(['/d', '/s', '/c', 'echo hello']);
    } finally {
      Object.defineProperty(process, 'platform', { value: originalPlatform, configurable: true });
    }
  });
});

// ══════════════════════════════════════════════════════════════════
// Risk Analysis: Dangerous Commands
// ══════════════════════════════════════════════════════════════════

describe('risk analysis: dangerous commands', () => {
  const dangerousCommands = [
    'rm -rf /tmp/test',
    'rmdir /tmp/empty',
    'del file.txt',
    'erase file.txt',
    'sudo apt install something',
    'su - root',
    'doas cat /etc/shadow',
    'chmod 777 /tmp/file',
    'chown root /tmp/file',
    'dd if=/dev/zero of=/dev/sda',
    'mkfs.ext4 /dev/sda1',
    'format C:',
    'shutdown -h now',
    'reboot',
    'halt',
    'iptables -A INPUT -j DROP',
    'ufw deny 80',
    'firewall-cmd --add-port=80/tcp',
    'curl http://example.com',
    'wget http://example.com/file.zip',
    'nc -l 8080',
    'netcat 10.0.0.1 4444',
    'eval "echo hello"',
    'exec bash',
  ];

  for (const cmd of dangerousCommands) {
    test(`"${cmd}" requires permission`, async () => {
      const ctx = createMockContext();
      await execute({ command: cmd }, ctx);
      expect(ctx.ask).toHaveBeenCalled();
      // Confirm no real process spawned (permission approved → mock spawn)
      expect(spawnSyncCalls.length).toBeLessThanOrEqual(1);
    });
  }

  test('dangerous commands produce USER_REJECTION when denied', async () => {
    const ctx = createMockContext({
      ask: mock(async () => false) as unknown as ToolContext['ask'],
    });
    const result = await execute({ command: 'rm -rf /tmp/test' }, ctx);
    expect(result.success).toBe(false);
    expect(result.error).toBe('USER_REJECTION');
    // No process spawned at all
    expect(spawnSyncCalls.length).toBe(0);
  });

  test('destructive category: rm', async () => {
    const ctx = createMockContext();
    await execute({ command: 'rm /tmp/test' }, ctx);
    const permAsk = getAskCall(ctx);
    expect(permAsk.metadata?.riskCategory).toBe('destructive');
    expect(permAsk.risk).toBe('high');
  });

  test('destructive category: sudo', async () => {
    const ctx = createMockContext();
    await execute({ command: 'sudo rm /tmp/test' }, ctx);
    const permAsk = getAskCall(ctx);
    expect(permAsk.metadata?.riskCategory).toBe('destructive');
  });

  test('destructive category: shutdown/reboot/halt', async () => {
    for (const cmd of ['shutdown -h now', 'reboot', 'halt']) {
      const ctx = createMockContext();
      await execute({ command: cmd }, ctx);
      const permAsk = getAskCall(ctx);
      expect(permAsk.metadata?.riskCategory).toBe('destructive');
    }
  });

  test('network category: curl', async () => {
    const ctx = createMockContext();
    await execute({ command: 'curl http://example.com' }, ctx);
    const permAsk = getAskCall(ctx);
    expect(permAsk.metadata?.riskCategory).toBe('network');
    expect(permAsk.risk).toBe('high');
  });

  test('network category: wget', async () => {
    const ctx = createMockContext();
    await execute({ command: 'wget http://example.com/file.zip' }, ctx);
    const permAsk = getAskCall(ctx);
    expect(permAsk.metadata?.riskCategory).toBe('network');
  });

  test('network category: nc / netcat', async () => {
    for (const cmd of ['nc -l 8080', 'netcat 10.0.0.1 4444']) {
      const ctx = createMockContext();
      await execute({ command: cmd }, ctx);
      const permAsk = getAskCall(ctx);
      expect(permAsk.metadata?.riskCategory).toBe('network');
    }
  });
});

// ══════════════════════════════════════════════════════════════════
// Risk Analysis: Filesystem Commands
// ══════════════════════════════════════════════════════════════════

describe('risk analysis: filesystem commands', () => {
  const filesystemCommands = [
    { cmd: 'mv src/file.txt dest/file.txt', name: 'mv' },
    { cmd: 'cp src/file.txt dest/file.txt', name: 'cp' },
    { cmd: 'mkdir new-directory', name: 'mkdir' },
    { cmd: 'touch new-file.txt', name: 'touch' },
    { cmd: 'ln -s /target link', name: 'ln' },
    { cmd: 'git push origin main', name: 'git push' },
  ];

  for (const { cmd, name } of filesystemCommands) {
    test(`"${cmd}" requires permission`, async () => {
      const ctx = createMockContext();
      await execute({ command: cmd }, ctx);
      expect(ctx.ask).toHaveBeenCalled();
    });

    test(`"${cmd}" categorized as workspace-modification`, async () => {
      const ctx = createMockContext();
      await execute({ command: cmd }, ctx);
      const permAsk = getAskCall(ctx);
      expect(permAsk.metadata?.riskCategory).toBe('workspace-modification');
    });

    test(`"${name}" has medium risk when workspace-bound`, async () => {
      const ctx = createMockContext();
      await execute({ command: cmd }, ctx);
      const permAsk = getAskCall(ctx);
      // createWorkspaceModificationAsk always returns medium
      expect(permAsk.risk).toBe('medium');
    });
  }

  test('filesystem with outside-workspace paths has medium risk (helper hardcodes medium)', async () => {
    const ctx = createMockContext();
    await execute({ command: 'mv /etc/config /tmp/config' }, ctx);
    const permAsk = getAskCall(ctx);
    // createWorkspaceModificationAsk always returns risk: 'medium'
    expect(permAsk.risk).toBe('medium');
  });

  test('git reset --hard is NOT matched (normalizes to "git reset", not "git reset --hard")', async () => {
    const ctx = createMockContext();
    await execute({ command: 'git reset --hard HEAD~1' }, ctx);
    // Known detection gap: effective identity is "git reset", not "git reset --hard"
    expect(ctx.ask).not.toHaveBeenCalled();
  });
});

// ══════════════════════════════════════════════════════════════════
// Risk Analysis: Shell Operators
// ══════════════════════════════════════════════════════════════════

describe('risk analysis: shell operators', () => {
  const operatorCommands = [
    { cmd: 'echo hello && echo world', op: '&&' },
    { cmd: 'echo hello || echo fallback', op: '||' },
    { cmd: 'echo hello | grep h', op: '|' },
    { cmd: 'echo hello > output.txt', op: '>' },
    { cmd: 'echo hello >> output.txt', op: '>>' },
    { cmd: 'echo `date`', op: '`' },
    { cmd: 'echo $(date)', op: '$(' },
    { cmd: 'echo hello; echo world', op: ';' },
  ];

  for (const { cmd, op } of operatorCommands) {
    test(`operator "${op}" in "${cmd}" requires permission`, async () => {
      const ctx = createMockContext();
      await execute({ command: cmd }, ctx);
      expect(ctx.ask).toHaveBeenCalled();
    });

    test(`operator "${op}" produces side-effect category`, async () => {
      const ctx = createMockContext();
      await execute({ command: cmd }, ctx);
      const permAsk = getAskCall(ctx);
      expect(permAsk.metadata?.riskCategory).toBe('side-effect');
      expect(permAsk.metadata?.hasOperators).toBe(true);
    });
  }

  test('operators have medium risk', async () => {
    const ctx = createMockContext();
    await execute({ command: 'echo hello | grep hello' }, ctx);
    const permAsk = getAskCall(ctx);
    expect(permAsk.risk).toBe('medium');
  });
});

// ══════════════════════════════════════════════════════════════════
// Risk Analysis: Outside Workspace
// ══════════════════════════════════════════════════════════════════

describe('risk analysis: outside workspace paths', () => {
  test('command with path outside workspace requires permission', async () => {
    const ctx = createMockContext();
    await execute({ command: 'cat /etc/hosts' }, ctx);
    expect(ctx.ask).toHaveBeenCalled();
  });

  test('command with tilde path requires permission', async () => {
    const ctx = createMockContext();
    await execute({ command: 'ls ~/Documents' }, ctx);
    expect(ctx.ask).toHaveBeenCalled();
  });

  test('command with absolute outside path categorized as outside-workspace', async () => {
    const ctx = createMockContext();
    await execute({ command: 'cat /etc/hosts' }, ctx);
    const permAsk = getAskCall(ctx);
    expect(permAsk.metadata?.riskCategory).toBe('outside-workspace');
  });

  test('safe command with outside cwd does NOT ask (cwd check gated behind requiresAsk)', async () => {
    const ctx = createMockContext();
    // "ls" alone is safe; the cwd-outside-workspace check is inside `if (risk.requiresAsk)`
    await execute({ command: 'ls', cwd: '/tmp/external' }, ctx);
    expect(ctx.ask).not.toHaveBeenCalled();
  });

  test('dangerous command with outside cwd triggers outside-workspace ask branch', async () => {
    const ctx = createMockContext();
    await execute({ command: 'curl http://example.com', cwd: '/tmp/external' }, ctx);
    const permAsk = getAskCall(ctx);
    // The outsideWorkspaceCwd branch takes priority over the risk category
    expect(permAsk.question).toContain('/tmp/external');
  });
});

// ══════════════════════════════════════════════════════════════════
// Risk Analysis: Low Risk Commands (no permission needed)
// ══════════════════════════════════════════════════════════════════

describe('risk analysis: low risk commands', () => {
  const safeCommands = [
    'ls',
    'ls -la',
    'pwd',
    'echo hello',
    'node --version',
    'git status',
    'git log --oneline -10',
    'bun --version',
    'npm list',
    'cat README.md',
    'head -20 package.json',
    'tail -20 package.json',
    'grep "TODO" src/index.ts',
    'find . -name "*.ts"',
    'wc -l src/index.ts',
    'which node',
    'env',
    'date',
    'whoami',
    'uname -a',
    'df -h',
    'ps aux',
  ];

  for (const cmd of safeCommands) {
    test(`"${cmd}" does NOT require permission`, async () => {
      const ctx = createMockContext();
      await execute({ command: cmd }, ctx);
      expect(ctx.ask).not.toHaveBeenCalled();
    });
  }
});

// ══════════════════════════════════════════════════════════════════
// Permission Ask Structure
// ══════════════════════════════════════════════════════════════════

describe('permission ask structure', () => {
  test('dangerous command ask has permission type and file resource (target-based)', async () => {
    const ctx = createMockContext();
    await execute({ command: 'rm -rf /tmp/test' }, ctx);
    const permAsk = getAskCall(ctx);
    expect(permAsk.type).toBe('permission');
    // Phase 3: rm -rf now produces resource='file', action='delete' instead of 'shell-command'
    expect(permAsk.resource).toBe('file');
    expect(permAsk.action).toBe('delete');
  });

  test('dangerous command ask has target-based patterns', async () => {
    const ctx = createMockContext();
    await execute({ command: 'rm -rf /tmp/test' }, ctx);
    const permAsk = getAskCall(ctx);
    expect(permAsk.patterns).toBeDefined();
    expect(permAsk.patterns!.length).toBeGreaterThan(0);
    // Phase 3: patterns now contain the file target path, not the command name
    expect(permAsk.patterns).toContain('/tmp/test/');
  });

  test('rm -rf produces prefix-matched delete target with trailing slash', async () => {
    const ctx = createMockContext();
    await execute({ command: 'rm -rf /tmp/test' }, ctx);
    const permAsk = getAskCall(ctx);
    // Phase 3: recursive delete produces prefix match with trailing slash
    expect(permAsk.intents).toBeDefined();
    expect(permAsk.intents![0].resource).toBe('file');
    expect(permAsk.intents![0].action).toBe('delete');
    expect(permAsk.intents![0].targets[0].matcher).toBe('prefix');
    expect(permAsk.intents![0].targets[0].target).toBe('/tmp/test/');
  });

  test('ask includes command metadata', async () => {
    const ctx = createMockContext();
    await execute({ command: 'curl http://example.com' }, ctx);
    const permAsk = getAskCall(ctx);
    expect(permAsk.metadata?.command).toBe('curl http://example.com');
    expect(permAsk.metadata?.baseCommand).toBe('curl');
    expect(permAsk.metadata?.riskCategory).toBe('network');
  });

  test('dangerous command with outside cwd produces outside-workspace ask', async () => {
    const ctx = createMockContext();
    await execute({ command: 'rm /tmp/test', cwd: '/tmp/external' }, ctx);
    const permAsk = getAskCall(ctx);
    expect(permAsk.question).toContain('/tmp/external');
  });

  test('relative targets resolve against an additional-workspace cwd', async () => {
    const additionalWorkspace = '/workspace/project-b';
    const ctx = createMockContext({
      isWithinWorkspace: (path: string) =>
        path.startsWith(WORKSPACE) || path.startsWith(additionalWorkspace),
    });

    await execute({ command: 'rm -rf dist', cwd: additionalWorkspace }, ctx);

    const expectedPath = resolve(additionalWorkspace, 'dist');
    const permAsk = getAskCall(ctx);
    expect(permAsk.paths).toEqual([expectedPath]);
    expect(permAsk.intents?.[0]?.targets[0]?.target).toBe(`${expectedPath}/`);
    expect(spawnSyncCalls[0]?.cwd).toBe(additionalWorkspace);
  });

  test('workspace-modification ask has correct question format', async () => {
    const ctx = createMockContext();
    await execute({ command: 'mkdir new-dir' }, ctx);
    const permAsk = getAskCall(ctx);
    // mkdir targets a file resource, so the question describes the file operation
    expect(permAsk.question).toContain('mkdir');
    expect(permAsk.question).toContain('Requires approval');
    expect(permAsk.metadata?.riskCategory).toBe('workspace-modification');
  });

  test('operator-only command has correct reason in metadata', async () => {
    const ctx = createMockContext();
    await execute({ command: 'echo hello | grep h' }, ctx);
    const permAsk = getAskCall(ctx);
    expect(permAsk.metadata?.reason).toContain('shell operators');
  });
});

// ══════════════════════════════════════════════════════════════════
// Permission Flow: Approval → executes (mocked spawn)
// ══════════════════════════════════════════════════════════════════

describe('permission flow: approval', () => {
  test('approved dangerous command calls spawnSync', async () => {
    const ctx = createMockContext({
      ask: mock(async () => true) as unknown as ToolContext['ask'],
    });
    const result = await execute({ command: 'rm -rf /tmp/test' }, ctx);
    expect(ctx.ask).toHaveBeenCalled();
    expect(spawnSyncCalls.length).toBe(1);
    expect(spawnSyncCalls[0].shell).toEqual(['sh', '-c', 'rm -rf /tmp/test']);
    expect(result.success).toBe(true);
  });

  test('approved filesystem command calls spawnSync', async () => {
    const ctx = createMockContext({
      ask: mock(async () => true) as unknown as ToolContext['ask'],
    });
    const result = await execute({ command: 'mkdir new-dir' }, ctx);
    expect(ctx.ask).toHaveBeenCalled();
    expect(spawnSyncCalls.length).toBe(1);
    expect(result).toBeDefined();
  });

  test('low-risk command executes without ask', async () => {
    const ctx = createMockContext();
    const result = await execute({ command: 'echo hello' }, ctx);
    expect(ctx.ask).not.toHaveBeenCalled();
    expect(spawnSyncCalls.length).toBe(1);
    expect(result.success).toBe(true);
  });
});

// ══════════════════════════════════════════════════════════════════
// Permission Flow: Rejection → no spawn at all
// ══════════════════════════════════════════════════════════════════

describe('permission flow: rejection', () => {
  test('rejected dangerous command returns USER_REJECTION without spawning', async () => {
    const ctx = createMockContext({
      ask: mock(async () => false) as unknown as ToolContext['ask'],
    });
    const result = await execute({ command: 'rm -rf /tmp' }, ctx);
    expect(result.success).toBe(false);
    expect(result.error).toBe('USER_REJECTION');
    expect(spawnSyncCalls.length).toBe(0);
  });

  test('rejected filesystem command returns USER_REJECTION without spawning', async () => {
    const ctx = createMockContext({
      ask: mock(async () => false) as unknown as ToolContext['ask'],
    });
    const result = await execute({ command: 'mv a.txt b.txt' }, ctx);
    expect(result.success).toBe(false);
    expect(result.error).toBe('USER_REJECTION');
    expect(spawnSyncCalls.length).toBe(0);
  });

  test('rejected operator command returns USER_REJECTION without spawning', async () => {
    const ctx = createMockContext({
      ask: mock(async () => false) as unknown as ToolContext['ask'],
    });
    const result = await execute({ command: 'echo a && echo b' }, ctx);
    expect(result.success).toBe(false);
    expect(result.error).toBe('USER_REJECTION');
    expect(spawnSyncCalls.length).toBe(0);
  });

  test('rejected outside-workspace command returns USER_REJECTION without spawning', async () => {
    const ctx = createMockContext({
      ask: mock(async () => false) as unknown as ToolContext['ask'],
    });
    const result = await execute({ command: 'ls /tmp' }, ctx);
    expect(result.success).toBe(false);
    expect(result.error).toBe('USER_REJECTION');
    expect(spawnSyncCalls.length).toBe(0);
  });
});

// ══════════════════════════════════════════════════════════════════
// Command Execution (mocked spawn)
// ══════════════════════════════════════════════════════════════════

describe('command execution: mocked spawn', () => {
  test('successful spawn returns success true without error field', async () => {
    spawnSyncBehavior = 'success';
    const ctx = createMockContext();
    const result = await execute({ command: 'echo hello' }, ctx);
    expect(result.success).toBe(true);
    expect(result.error).toBeUndefined();
    const output = result.result as { stdout: string; stderr: string; exitCode: number };
    expect(output.exitCode).toBe(0);
    expect(output.stdout).toBe('mock-output');
  });

  test('failed spawn returns success false with error output', async () => {
    spawnSyncBehavior = 'fail';
    const ctx = createMockContext();
    const result = await execute({ command: 'ls missing' }, ctx);
    expect(result.success).toBe(false);
    expect(result.error).toBeDefined();
    expect(result.error).toContain('exited with code 1');
    const output = result.result as { stdout: string; stderr: string; exitCode: number };
    expect(output.exitCode).toBe(1);
    expect(output.stderr).toBe('mock-error');
  });

  test('result includes shell-output visualization', async () => {
    const ctx = createMockContext();
    const result = await execute({ command: 'echo hello' }, ctx);
    expect(result.visualization).toBeDefined();
    expect(result.visualization?.type).toBe('shell-output');
  });

  test('visualization includes truncated command', async () => {
    const ctx = createMockContext();
    const result = await execute({ command: 'echo hello' }, ctx);
    const viz = result.visualization as {
      type: string;
      command: string;
      stdout?: string;
      stderr?: string;
      exitCode: number;
    };
    expect(viz.command).toBe('echo hello');
    expect(viz.exitCode).toBe(0);
  });

  test('very long command is truncated to 100 chars in visualization', async () => {
    const ctx = createMockContext();
    const longCommand = 'echo ' + 'a'.repeat(200);
    const result = await execute({ command: longCommand }, ctx);
    const viz = result.visualization as { command: string };
    expect(viz.command.length).toBeLessThanOrEqual(100);
  });

  test('spawn uses workspacePath as cwd when no cwd provided', async () => {
    const ctx = createMockContext();
    await execute({ command: 'echo hello' }, ctx);
    expect(spawnSyncCalls[0].cwd).toBe(WORKSPACE);
  });

  test('spawn uses resolved cwd when cwd is provided', async () => {
    const ctx = createMockContext();
    await execute({ command: 'echo hello', cwd: WORKSPACE }, ctx);
    expect(spawnSyncCalls[0].cwd).toBe(WORKSPACE);
  });

  test('empty command returns EMPTY_COMMAND error', async () => {
    const ctx = createMockContext();
    const result = await execute({ command: '' }, ctx);
    expect(spawnSyncCalls.length).toBe(0);
    expect(result.success).toBe(false);
    expect(result.error).toContain('EMPTY_COMMAND');
  });
});

// ══════════════════════════════════════════════════════════════════
// Edge Cases
// ══════════════════════════════════════════════════════════════════

describe('edge cases', () => {
  test('path-based base command strips directory prefix (/bin/echo → echo) is low-risk', async () => {
    const ctx = createMockContext();
    // /bin/echo → baseCommand 'echo' (path prefix stripped by parseCommand)
    // echo is not dangerous/filesystem, so no permission ask is needed
    const result = await execute({ command: '/bin/echo hello' }, ctx);
    expect(ctx.ask).not.toHaveBeenCalled();
    // The command executes directly (spawn calls happen in the test env)
    expect(result).toBeDefined();
  });

  test('git commands with subcommands are identified (git push)', async () => {
    const ctx = createMockContext();
    await execute({ command: 'git push origin main' }, ctx);
    const permAsk = getAskCall(ctx);
    expect(permAsk.metadata?.baseCommand).toBe('git push');
  });

  test('compound command prioritizes most dangerous segment (echo && rm)', async () => {
    const ctx = createMockContext();
    await execute({ command: 'echo hello && rm -rf /tmp' }, ctx);
    const permAsk = getAskCall(ctx);
    // rm has higher danger priority than echo
    expect(permAsk.metadata?.baseCommand).toBe('rm');
  });

  test('command with flags extracts flags correctly', async () => {
    const ctx = createMockContext();
    await execute({ command: 'rm -rf -v /tmp/test' }, ctx);
    const permAsk = getAskCall(ctx);
    expect(permAsk.metadata?.flags).toContain('-rf');
    expect(permAsk.metadata?.flags).toContain('-v');
  });

  test('simultaneous dangerous + outside-workspace: high risk and not workspace-bound', async () => {
    const ctx = createMockContext();
    await execute({ command: 'rm /etc/config' }, ctx);
    const permAsk = getAskCall(ctx);
    expect(permAsk.risk).toBe('high');
    expect(permAsk.metadata?.workspaceBound).toBe(false);
  });

  test('npm/pnpm/yarn/bun subcommands identified but safe', async () => {
    const ctx = createMockContext();
    const result = await execute({ command: 'npm install' }, ctx);
    expect(ctx.ask).not.toHaveBeenCalled();
    expect(result).toBeDefined();
  });

  test('multi-line-style command with semicolons triggers operator detection', async () => {
    const ctx = createMockContext();
    await execute({ command: 'echo first; echo second; echo third' }, ctx);
    const permAsk = getAskCall(ctx);
    expect(permAsk.metadata?.hasOperators).toBe(true);
  });

  test('command with only flags still works', async () => {
    const ctx = createMockContext();
    const result = await execute({ command: 'ls --help' }, ctx);
    expect(ctx.ask).not.toHaveBeenCalled();
    expect(result).toBeDefined();
  });

  test('relative path argument stays inside workspace', async () => {
    const ctx = createMockContext();
    // Both paths normalize inside the workspace root.
    await execute({ command: 'ls ./src ../project/lib' }, ctx);
    expect(ctx.ask).not.toHaveBeenCalled();
  });

  test('windows-style path is detected but resolved inside workspace by mock', async () => {
    const ctx = createMockContext();
    // Windows paths like C:\ are detected by extractPathArguments,
    // but the mock resolvePath treats non-Unix-absolute paths as relative
    // to workspace, so they resolve inside workspace and no ask is triggered.
    // On a real Windows system with proper resolvePath, this would trigger outside-workspace.
    const result = await execute({ command: 'cat C:\\Windows\\System32\\file.txt' }, ctx);
    expect(ctx.ask).not.toHaveBeenCalled();
    expect(result).toBeDefined();
  });

  test('no spawn happens when ask rejects for outside-workspace', async () => {
    const ctx = createMockContext({
      ask: mock(async () => false) as unknown as ToolContext['ask'],
    });
    const result = await execute({ command: 'cat /etc/passwd' }, ctx);
    expect(result.success).toBe(false);
    expect(result.error).toBe('USER_REJECTION');
    expect(spawnSyncCalls.length).toBe(0);
  });

  // ── Redundant cd stripping tests ────────────────────────────────────

  test('cd <workspace> && <cmd> strips redundant cd and avoids operator ask', async () => {
    const ctx = createMockContext();
    // Without stripping, the && would trigger operator detection
    const result = await execute({ command: `cd ${WORKSPACE} && npm install` }, ctx);
    expect(ctx.ask).not.toHaveBeenCalled();
    expect(result).toBeDefined();
    // The spawned command should be just "npm install", not the cd prefix
    expect(spawnSyncCalls[0].shell).toEqual(['sh', '-c', 'npm install']);
  });

  test('cd <workspace> && <dangerous> still catches dangerous command', async () => {
    const ctx = createMockContext();
    await execute({ command: `cd ${WORKSPACE} && rm -rf /tmp/test` }, ctx);
    const permAsk = getAskCall(ctx);
    expect(permAsk.metadata?.riskCategory).toBe('destructive');
  });

  test('cd <workspace> && cat .env still catches sensitive file', async () => {
    const ctx = createMockContext();
    await execute({ command: `cd ${WORKSPACE} && cat .env` }, ctx);
    const permAsk = getAskCall(ctx);
    expect(permAsk.metadata?.riskCategory).toBe('sensitive-files');
  });

  test('cd <other_path> && <cmd> does NOT strip when target differs from cwd', async () => {
    const ctx = createMockContext();
    await execute({ command: 'cd /some/other/path && npm install' }, ctx);
    // Different cd target → not stripped → && triggers operator detection
    const permAsk = getAskCall(ctx);
    expect(permAsk.metadata?.hasOperators).toBe(true);
  });

  test('cd <workspace> && <cmd> with explicit cwd param also strips', async () => {
    const ctx = createMockContext();
    const _result = await execute({
      command: `cd ${WORKSPACE} && bun test`,
      cwd: WORKSPACE,
    }, ctx);
    expect(ctx.ask).not.toHaveBeenCalled();
    expect(spawnSyncCalls[0].shell).toEqual(['sh', '-c', 'bun test']);
  });

  test('cd with relative path matching workspace also strips', async () => {
    const ctx = createMockContext();
    // resolvePath('./project') = '/workspace/project/./project' ≠ '/workspace/project'
    // so this should NOT strip — it's a different path
    await execute({ command: 'cd ./project && ls' }, ctx);
    // The relative path won't match workspace, so && is kept → operator ask
    const permAsk = getAskCall(ctx);
    expect(permAsk.metadata?.hasOperators).toBe(true);
  });

  test('cd <workspace> && <cmd> uses stripped command in visualization', async () => {
    const ctx = createMockContext();
    const result = await execute({ command: `cd ${WORKSPACE} && echo hello` }, ctx);
    const viz = result.visualization as { type: string; command: string } | undefined;
    expect(viz?.command).toBe('echo hello');
  });

  test('bare cd without && is not stripped', async () => {
    const ctx = createMockContext();
    const _result = await execute({ command: `cd ${WORKSPACE}` }, ctx);
    // No && → no stripping, just runs the cd command
    expect(ctx.ask).not.toHaveBeenCalled();
    expect(spawnSyncCalls[0].shell).toEqual(['sh', '-c', `cd ${WORKSPACE}`]);
  });

  // ── Sensitive file tests ──────────────────────────────────────────

  test('cat .env always requires permission', async () => {
    const ctx = createMockContext();
    await execute({ command: 'cat .env' }, ctx);
    const permAsk = getAskCall(ctx);
    expect(permAsk.risk).toBe('high');
    expect(permAsk.metadata?.riskCategory).toBe('sensitive-files');
    expect(permAsk.metadata?.reason).toContain('sensitive files');
  });

  test('cat .env is blocked even when user rejects', async () => {
    const ctx = createMockContext({
      ask: mock(async () => false) as unknown as ToolContext['ask'],
    });
    const result = await execute({ command: 'cat .env' }, ctx);
    expect(result.success).toBe(false);
    expect(result.error).toBe('USER_REJECTION');
    expect(spawnSyncCalls.length).toBe(0);
  });

  test('cat .env.production also requires permission', async () => {
    const ctx = createMockContext();
    await execute({ command: 'cat .env.production' }, ctx);
    const permAsk = getAskCall(ctx);
    expect(permAsk.risk).toBe('high');
    expect(permAsk.metadata?.riskCategory).toBe('sensitive-files');
  });

  test('cat .pem file requires permission', async () => {
    const ctx = createMockContext();
    await execute({ command: 'cat server.pem' }, ctx);
    const permAsk = getAskCall(ctx);
    expect(permAsk.risk).toBe('high');
    expect(permAsk.metadata?.riskCategory).toBe('sensitive-files');
  });

  test('cat .key file requires permission', async () => {
    const ctx = createMockContext();
    await execute({ command: 'cat id_rsa.key' }, ctx);
    const permAsk = getAskCall(ctx);
    expect(permAsk.risk).toBe('high');
    expect(permAsk.metadata?.riskCategory).toBe('sensitive-files');
  });

  test('grep across .env still requires permission', async () => {
    const ctx = createMockContext();
    await execute({ command: 'grep DATABASE .env' }, ctx);
    const permAsk = getAskCall(ctx);
    expect(permAsk.metadata?.riskCategory).toBe('sensitive-files');
  });

  test('cat normal.txt does not trigger sensitive-files', async () => {
    const ctx = createMockContext();
    const result = await execute({ command: 'cat normal.txt' }, ctx);
    expect(ctx.ask).not.toHaveBeenCalled();
    expect(result).toBeDefined();
  });
});
