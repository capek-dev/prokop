import { describe, expect, test } from 'bun:test';
import { mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import {
  classifyShellCommand,
  effectivePath,
  isOutsideRoot,
  isSensitivePath,
  isWithinRoot,
  requiresHumanReview,
} from '@/domains/permissions';

const root = resolve('/workspace/project');

describe('shell classification (permissions v2)', () => {
  test('malformed input classifies to undefined', () => {
    expect(classifyShellCommand('   ', root, root)).toBeUndefined();
    expect(classifyShellCommand('x'.repeat(64 * 1024 + 1), root, root)).toBeUndefined();
  });

  test('every valid command returns a finding; the caller decides review', () => {
    const clean = classifyShellCommand('git status', root, root)!;
    expect(clean.finding.concerns).toEqual([]);
    expect(requiresHumanReview(clean.finding)).toBe(false);
    expect(clean.ask.risk).toBe('low');

    const wrapped = classifyShellCommand(`/bin/zsh -lc 'rm -rf ${root}/build'`, root, root)!;
    expect(wrapped.finding.concerns).toContain('destructive');
    expect(JSON.stringify(wrapped.ask)).toContain('rm -rf');
  });

  test('the ask carries the concern fields and the derived risk', () => {
    const escape = classifyShellCommand('cat /etc/passwd', root, root)!;
    expect(escape.ask.concerns).toContain('escape');
    expect(escape.ask.risk).toBe('medium');

    const sensitive = classifyShellCommand('cat .env', root, root)!;
    expect(sensitive.ask.concerns).toContain('sensitive');
    expect(sensitive.ask.risk).toBe('high');

    const destructive = classifyShellCommand('rm -rf build', root, root)!;
    expect(destructive.ask.risk).toBe('high');
    // Destructive findings are once-only.
    expect(destructive.ask.allowedScopes).toEqual(['once']);
  });

  test('escape-only asks may be remembered; workspace writes stay clean', () => {
    const escape = classifyShellCommand('cat /etc/passwd', root, root)!;
    expect(escape.ask.allowedScopes).toEqual(['once', 'session', 'workspace']);
    const plain = classifyShellCommand('mv a b', root, root)!;
    expect(plain.finding.concerns).toEqual([]);
  });

  test('cwdOutsideRoots unions escape in for bare commands', () => {
    const bare = classifyShellCommand('bun test', [root], '/elsewhere', { cwdOutsideRoots: true })!;
    expect(bare.finding.concerns).toContain('escape');
    expect(bare.ask.risk).toBe('medium');
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
