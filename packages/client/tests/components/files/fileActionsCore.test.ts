import { describe, expect, it } from 'vitest';
import {
  docMatchesDeleteTarget,
  isUnderPath,
  joinCopyAbsolutePath,
  joinRootRelative,
  stripTrailingSlash,
  validateEntryName,
  validateRenameTarget,
} from '@/components/files/fileActionsCore';

describe('stripTrailingSlash', () => {
  it('removes one trailing slash', () => {
    expect(stripTrailingSlash('src/')).toBe('src');
  });
  it('removes repeated trailing slashes', () => {
    expect(stripTrailingSlash('src///')).toBe('src');
  });
  it('leaves bare paths untouched', () => {
    expect(stripTrailingSlash('src/a.ts')).toBe('src/a.ts');
  });
  it('maps root to empty string', () => {
    expect(stripTrailingSlash('/')).toBe('');
  });
});

describe('joinRootRelative', () => {
  it('joins parent and name', () => {
    expect(joinRootRelative('src', 'a.ts')).toBe('src/a.ts');
  });
  it('accepts trailing-slash parents', () => {
    expect(joinRootRelative('src/', 'a.ts')).toBe('src/a.ts');
  });
  it('treats empty parent as root', () => {
    expect(joinRootRelative('', 'a.ts')).toBe('a.ts');
  });
  it('strips a leading slash from the name', () => {
    expect(joinRootRelative('src', '/a.ts')).toBe('src/a.ts');
  });
});

describe('isUnderPath', () => {
  it('matches exact paths', () => {
    expect(isUnderPath('src', 'src')).toBe(true);
  });
  it('matches descendants', () => {
    expect(isUnderPath('src', 'src/lib/a.ts')).toBe(true);
  });
  it('rejects sibling prefixes', () => {
    expect(isUnderPath('src', 'srcx/a.ts')).toBe(false);
  });
  it('rejects partial segment matches', () => {
    expect(isUnderPath('src', 'src.old/a.ts')).toBe(false);
  });
  it('empty prefix matches everything (workspace root)', () => {
    expect(isUnderPath('', 'anything.ts')).toBe(true);
  });
  it('accepts trailing-slash prefix', () => {
    expect(isUnderPath('src/', 'src/a.ts')).toBe(true);
  });
});

describe('validateEntryName', () => {
  it('accepts simple names', () => {
    expect(validateEntryName('a.ts')).toBeNull();
  });
  it('accepts nested paths', () => {
    expect(validateEntryName('a/b/c.ts')).toBeNull();
  });
  it('rejects empty and whitespace-only names', () => {
    expect(validateEntryName('')).toMatch(/required/i);
    expect(validateEntryName('   ')).toMatch(/required/i);
  });
  it('rejects leading or trailing slashes', () => {
    expect(validateEntryName('/a.ts')).toMatch(/slash/i);
    expect(validateEntryName('a.ts/')).toMatch(/slash/i);
  });
  it('rejects empty segments', () => {
    expect(validateEntryName('a//b.ts')).toMatch(/empty/i);
  });
  it('rejects parent directory segments', () => {
    expect(validateEntryName('../a.ts')).toMatch(/\.\./);
  });
});

describe('validateRenameTarget', () => {
  it('rejects unchanged paths', () => {
    expect(validateRenameTarget('src/a.ts', 'src/a.ts')).toMatch(/differ/i);
  });
  it('accepts a real rename', () => {
    expect(validateRenameTarget('src/b.ts', 'src/a.ts')).toBeNull();
  });
  it('still applies name rules', () => {
    expect(validateRenameTarget('../b.ts', 'src/a.ts')).toMatch(/\.\./);
  });
});

describe('docMatchesDeleteTarget', () => {
  const identity = {
    serverId: 's1',
    workspaceId: 'w1',
    root: '',
    path: 'src/lib/a.ts',
  };

  it('matches a file delete exactly', () => {
    expect(docMatchesDeleteTarget(identity, { path: 'src/lib/a.ts', isDirectory: false })).toBe(true);
  });
  it('rejects other files', () => {
    expect(docMatchesDeleteTarget(identity, { path: 'src/lib/b.ts', isDirectory: false })).toBe(false);
  });
  it('matches a directory delete by prefix', () => {
    expect(docMatchesDeleteTarget(identity, { path: 'src/lib', isDirectory: true })).toBe(true);
  });
  it('rejects sibling directory prefixes', () => {
    expect(docMatchesDeleteTarget(identity, { path: 'src/libx', isDirectory: true })).toBe(false);
  });
  it('rejects on serverId mismatch', () => {
    expect(
      docMatchesDeleteTarget(identity, { serverId: 's2', path: 'src/lib/a.ts', isDirectory: false }),
    ).toBe(false);
  });
  it('rejects on workspaceId mismatch', () => {
    expect(
      docMatchesDeleteTarget(identity, { workspaceId: 'w2', path: 'src/lib/a.ts', isDirectory: false }),
    ).toBe(false);
  });
  it('rejects on root mismatch', () => {
    expect(
      docMatchesDeleteTarget(identity, { root: '/other', path: 'src/lib/a.ts', isDirectory: false }),
    ).toBe(false);
  });
});

describe('joinCopyAbsolutePath', () => {
  it('joins workspace and relative path', () => {
    expect(joinCopyAbsolutePath('/Users/x/work', 'src/a.ts')).toBe('/Users/x/work/src/a.ts');
  });
  it('returns the relative path without a workspace', () => {
    expect(joinCopyAbsolutePath(undefined, 'src/a.ts')).toBe('src/a.ts');
  });
  it('trims trailing slashes off the workspace', () => {
    expect(joinCopyAbsolutePath('/Users/x/work/', 'src/a.ts')).toBe('/Users/x/work/src/a.ts');
  });
  it('trims a leading slash off the relative path', () => {
    expect(joinCopyAbsolutePath('/Users/x/work', '/src/a.ts')).toBe('/Users/x/work/src/a.ts');
  });
});
