import { describe, expect, test } from 'bun:test';
import { mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import {
  analyzeRisk,
  classifyShellCommand,
  effectivePath,
  isOutsideRoot,
  isSensitivePath,
  isWithinRoot,
  type ShellRiskContext,
} from '@/domains/permissions';

const root = resolve('/workspace/project');

function context(overrides: Partial<ShellRiskContext> = {}): ShellRiskContext {
  return {
    workspacePath: root,
    fs: { tempDir: resolve('/workspace/project/.tmp') },
    resolvePath: path => resolve(root, path),
    isWithinWorkspace: path => isWithinRoot(path, root),
    isSensitivePath,
    ...overrides,
  };
}

describe('shell risk classification', () => {
  test('ordinary commands need no ask', () => {
    const result = analyzeRisk('git status', context());
    expect(result).toMatchObject({ requiresAsk: false, risk: 'low' });
  });

  test('dangerous commands are high risk with destructive or network categories', () => {
    expect(analyzeRisk('rm -rf build', context())).toMatchObject({ requiresAsk: true, risk: 'high', riskCategory: 'destructive' });
    expect(analyzeRisk('curl https://example.com', context())).toMatchObject({ requiresAsk: true, risk: 'high', riskCategory: 'network' });
  });

  test('filesystem commands are medium inside the workspace and high outside', () => {
    expect(analyzeRisk('mkdir docs', context())).toMatchObject({ requiresAsk: true, risk: 'medium', riskCategory: 'workspace-modification' });
    expect(analyzeRisk('mkdir /etc/thing', context())).toMatchObject({ requiresAsk: true, risk: 'high', workspaceBound: false });
  });

  test('operators and sensitive files raise their own categories', () => {
    expect(analyzeRisk('cat foo | grep bar', context())).toMatchObject({ requiresAsk: true, riskCategory: 'side-effect', hasOperators: true });
    expect(analyzeRisk('cat .env', context())).toMatchObject({ requiresAsk: true, risk: 'high', riskCategory: 'sensitive-files' });
  });

  test('the temp directory exception keeps temp paths workspace-bound', () => {
    const result = analyzeRisk(`cat ${resolve('/workspace/project/.tmp')}/out.txt`, context());
    expect(result.workspaceBound).toBe(true);
  });
});

describe('native-harness shell ask building', () => {
  test('ordinary commands classify to null and malformed input to undefined', () => {
    expect(classifyShellCommand('git status', root, root)).toBeNull();
    expect(classifyShellCommand('   ', root, root)).toBeUndefined();
    expect(classifyShellCommand('x'.repeat(64 * 1024 + 1), root, root)).toBeUndefined();
  });

  test('login-shell wrapping is unwrapped before classification', () => {
    const ask = classifyShellCommand(`/bin/zsh -lc 'touch ${root}/newfile'`, root, root);
    // touch is a workspace-bound filesystem command: medium-risk ask whose
    // command identity is the unwrapped inner command.
    expect(ask).toMatchObject({ type: 'permission', risk: 'medium' });
    expect(JSON.stringify(ask)).toContain('touch');
  });

  test('workspace modification builds the structured modification ask', () => {
    const ask = classifyShellCommand('mv a b', root, root);
    expect(ask).toMatchObject({ type: 'permission', risk: 'medium' });
    expect(ask?.allowedScopes).toContain('once');
  });

  test('dangerous commands stay high risk through the ask path', () => {
    const ask = classifyShellCommand('sudo rm /etc/hosts', root, root);
    expect(ask).toMatchObject({ risk: 'high' });
  });
});

describe('path policy helpers', () => {
  test('sensitive detection covers the SDK patterns', () => {
    expect(isSensitivePath('config/.env.local')).toBe(true);
    expect(isSensitivePath('src/index.ts')).toBe(false);
  });

  test('root containment handles equality, nesting, and escape', () => {
    expect(isWithinRoot(root, root)).toBe(true);
    expect(isWithinRoot(join(root, 'src'), root)).toBe(true);
    expect(isWithinRoot(resolve('/workspace/other'), root)).toBe(false);
    expect(isOutsideRoot(resolve('/etc/passwd'), root)).toBe(true);
    expect(isOutsideRoot(join(root, 'src'), root)).toBe(false);
  });

  test('effectivePath follows existing symlink ancestors only', () => {
    const dir = mkdtempSync(join(tmpdir(), 'permissions-domain-'));
    try {
      // tmpdir itself may be a symlink (macOS /var -> /private/var); anchor
      // expectations on the realized directory.
      const realDir = realpathSync(dir);
      writeFileSync(join(dir, 'real.txt'), 'x');
      symlinkSync(join(dir, 'real.txt'), join(dir, 'link.txt'));
      expect(effectivePath(join(dir, 'link.txt'))).toBe(join(realDir, 'real.txt'));
      // Missing tails keep their literal spelling after the last real ancestor.
      expect(effectivePath(join(dir, 'link.txt', 'nested'))).toBe(join(realDir, 'real.txt', 'nested'));
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
