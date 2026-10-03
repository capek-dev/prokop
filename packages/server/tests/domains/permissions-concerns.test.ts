import { describe, expect, test } from 'bun:test';
import {
  CATASTROPHIC_BASES,
  DESTRUCTIVE_RULES,
  containsScreenedToken,
  decide,
  isProtectedTarget,
  isSensitiveFilename,
  matchDestructiveRule,
  type Finding,
  type InvocationShape,
} from '@/domains/permissions';

function finding(partial: Partial<Finding> = {}): Finding {
  return { concerns: [], catastrophic: false, evidence: [], resolvedPaths: [], ...partial };
}

function invocation(base: string, args: readonly string[], sub?: string): InvocationShape {
  return { base, args, sub };
}

describe('permissions v2 policy table', () => {
  const cases: Array<[Finding, Record<string, 'auto' | 'ask'>]> = [
    [finding(), { standard: 'auto', extended: 'auto', full: 'auto' }],
    [finding({ concerns: ['opaque'] }), { standard: 'auto', extended: 'auto', full: 'auto' }],
    [finding({ concerns: ['escape'] }), { standard: 'ask', extended: 'auto', full: 'auto' }],
    [finding({ concerns: ['sensitive'] }), { standard: 'ask', extended: 'ask', full: 'auto' }],
    [finding({ concerns: ['destructive'] }), { standard: 'ask', extended: 'ask', full: 'auto' }],
    [finding({ concerns: ['opaque', 'escape'] }), { standard: 'ask', extended: 'auto', full: 'auto' }],
    [finding({ concerns: ['escape', 'sensitive'] }), { standard: 'ask', extended: 'ask', full: 'auto' }],
    [finding({ catastrophic: true, concerns: ['destructive', 'escape'] }), {
      standard: 'ask', extended: 'ask', full: 'ask',
    }],
  ];

  for (const [f, expected] of cases) {
    test(`concerns=[${f.concerns.join(',')}] catastrophic=${f.catastrophic}`, () => {
      expect(decide('standard', f)).toBe(expected.standard);
      expect(decide('extended', f)).toBe(expected.extended);
      expect(decide('full', f)).toBe(expected.full);
    });
  }
});

describe('destructive flag matching', () => {
  test('rm is destructive only with recursive or force flags', () => {
    expect(matchDestructiveRule(invocation('rm', ['notes.txt']))).toBeNull();
    expect(matchDestructiveRule(invocation('rm', ['-i', 'notes.txt']))).toBeNull();
    expect(matchDestructiveRule(invocation('rm', ['-r', 'build']))).not.toBeNull();
    expect(matchDestructiveRule(invocation('rm', ['-f', 'notes.txt']))).not.toBeNull();
    expect(matchDestructiveRule(invocation('rm', ['-rf', 'build']))).not.toBeNull();
    expect(matchDestructiveRule(invocation('rm', ['-fr', 'build']))).not.toBeNull();
    expect(matchDestructiveRule(invocation('rm', ['--force', 'notes.txt']))).not.toBeNull();
    expect(matchDestructiveRule(invocation('rm', ['--recursive', 'build']))).not.toBeNull();
  });

  test('git subcommands route by subcommand', () => {
    expect(matchDestructiveRule(invocation('git', ['--hard'], 'reset'))).not.toBeNull();
    expect(matchDestructiveRule(invocation('git', ['--soft'], 'reset'))).toBeNull();
    expect(matchDestructiveRule(invocation('git', ['-f'], 'clean'))).not.toBeNull();
    expect(matchDestructiveRule(invocation('git', ['-n'], 'clean'))).toBeNull();
    expect(matchDestructiveRule(invocation('git', ['--force'], 'push'))).not.toBeNull();
    expect(matchDestructiveRule(invocation('git', ['-u', 'origin', 'main'], 'push'))).toBeNull();
    expect(matchDestructiveRule(invocation('git', ['status']))).toBeNull();
    // force-with-lease is deliberately not destructive
    expect(matchDestructiveRule(invocation('git', ['--force-with-lease'], 'push'))).toBeNull();
  });

  test('selector rules match so analyze applies operand logic', () => {
    const checkout = matchDestructiveRule(invocation('git', ['--', '.'], 'checkout'));
    expect(checkout?.rule.kind).toBe('selector');
    const restore = matchDestructiveRule(invocation('git', ['.'], 'restore'));
    expect(restore?.rule.kind).toBe('selector');
  });

  test('always-destructive commands match regardless of flags', () => {
    for (const base of ['dd', 'shred', 'sudo', 'su', 'doas']) {
      expect(matchDestructiveRule(invocation(base, []))).not.toBeNull();
    }
    expect(matchDestructiveRule(invocation('dd', ['if=x of=y']))).not.toBeNull();
  });

  test('table sanity: rule keys are unique and lowercase', () => {
    const keys = DESTRUCTIVE_RULES.map(rule => `${rule.base} ${rule.sub ?? ''}`);
    expect(new Set(keys).size).toBe(keys.length);
    for (const rule of DESTRUCTIVE_RULES) {
      expect(rule.base).toBe(rule.base.toLowerCase());
    }
  });
});

describe('catastrophic targets', () => {
  test('protected roots include the filesystem, exact user trees, and home', () => {
    const home = '/Users/cherry';
    expect(isProtectedTarget('/', home)).toBe(true);
    expect(isProtectedTarget('/etc/hosts', home)).toBe(true);
    expect(isProtectedTarget('/opt/tool/bin', home)).toBe(true);
    // /Users and the home itself are catastrophic only as exact targets.
    expect(isProtectedTarget('/Users', home)).toBe(true);
    expect(isProtectedTarget('/Users/cherry', home)).toBe(true);
    // Anything beneath the user tree is ordinary user data: destructive, not
    // catastrophic. This is what keeps `rm -rf build` from asking in full mode.
    expect(isProtectedTarget('/Users/cherry/docs', home)).toBe(false);
    expect(isProtectedTarget('/Users/cherry/jean2', home)).toBe(false);
    expect(isProtectedTarget('/Users/someone-else/project', home)).toBe(false);
    expect(isProtectedTarget('/workspace/project', home)).toBe(false);
    expect(isProtectedTarget('', home)).toBe(false);
  });

  test('catastrophic bases are prefix matched command names', () => {
    expect(CATASTROPHIC_BASES).toContain('mkfs');
    expect(CATASTROPHIC_BASES).toContain('shutdown');
  });
});

describe('raw-text token screen', () => {
  test('flags dangerous tokens as standalone words', () => {
    expect(containsScreenedToken('rm -rf build')).toBe(true);
    expect(containsScreenedToken('/bin/rm -rf build')).toBe(true);
    expect(containsScreenedToken('sudo apt install curl')).toBe(true);
    expect(containsScreenedToken('eval "$x"')).toBe(true);
    expect(containsScreenedToken('cat a | grep b')).toBe(false);
    expect(containsScreenedToken('ls | head')).toBe(false);
    expect(containsScreenedToken('echo confirm result')).toBe(false);
    expect(containsScreenedToken('cat environment.ts')).toBe(false);
  });

  test('git is screened so multiplexers reach full analysis', () => {
    expect(containsScreenedToken('git status')).toBe(true);
  });
});

describe('sensitive filename matching', () => {
  test('matches secret basenames and extensions', () => {
    expect(isSensitiveFilename('/workspace/.env')).toBe(true);
    expect(isSensitiveFilename('/workspace/.env.local')).toBe(true);
    expect(isSensitiveFilename('/workspace/certs/server.pem')).toBe(true);
    expect(isSensitiveFilename('/workspace/keys/deploy.key')).toBe(true);
    expect(isSensitiveFilename('/workspace/.git-credentials')).toBe(true);
    expect(isSensitiveFilename('/workspace/src/secrets.json')).toBe(true);
  });

  test('matches sensitive directory segments', () => {
    expect(isSensitiveFilename('/Users/cherry/.ssh/config')).toBe(true);
    expect(isSensitiveFilename('/Users/cherry/.aws/credentials')).toBe(true);
    expect(isSensitiveFilename('/workspace/.gnupg/random_seed')).toBe(true);
    // the .ssh directory itself is sensitive, including public keys
    expect(isSensitiveFilename('/Users/cherry/.ssh/id_rsa.pub')).toBe(true);
  });

  test('does not match legacy substring false positives', () => {
    expect(isSensitiveFilename('/workspace/credentials.json')).toBe(false);
    expect(isSensitiveFilename('/workspace/src/credentials.ts')).toBe(false);
    expect(isSensitiveFilename('/workspace/src/password-reset.ts')).toBe(false);
    expect(isSensitiveFilename('/workspace/src/environment.ts')).toBe(false);
    expect(isSensitiveFilename('/workspace/mysecrets.ts')).toBe(false);
    expect(isSensitiveFilename('/workspace/.env.example')).toBe(false);
    expect(isSensitiveFilename('/workspace/.env.sample')).toBe(false);
    expect(isSensitiveFilename('/workspace/id_rsa.pub')).toBe(false);
  });
});
