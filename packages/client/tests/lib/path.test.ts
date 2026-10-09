import { describe, test, expect } from 'vitest';
import { dirname, basename, join, toWorkspaceFileTarget } from '@/lib/path';

describe('dirname', () => {
  test('returns parent directory of a file path', () => {
    expect(dirname('/home/user/file.txt')).toBe('/home/user');
  });

  test('returns parent of nested path', () => {
    expect(dirname('/a/b/c/d')).toBe('/a/b/c');
  });

  test('returns / for root-level file', () => {
    expect(dirname('/file.txt')).toBe('/');
  });

  test('returns / for root path', () => {
    expect(dirname('/')).toBe('/');
  });

  test('handles backslashes', () => {
    expect(dirname('C:\\Users\\test\\file.txt')).toBe('C:/Users/test');
  });

  test('handles relative path', () => {
    expect(dirname('src/components/Button.tsx')).toBe('src/components');
  });

  test('handles single segment', () => {
    expect(dirname('file.txt')).toBe('/');
  });
});

describe('basename', () => {
  test('returns filename from path', () => {
    expect(basename('/home/user/file.txt')).toBe('file.txt');
  });

  test('returns last directory from path', () => {
    expect(basename('/home/user/dir')).toBe('dir');
  });

  test('returns filename for root-level file', () => {
    expect(basename('/file.txt')).toBe('file.txt');
  });

  test('handles backslashes', () => {
    expect(basename('C:\\Users\\test\\file.txt')).toBe('file.txt');
  });

  test('handles relative path', () => {
    expect(basename('src/components/Button.tsx')).toBe('Button.tsx');
  });

  test('returns empty string for root', () => {
    expect(basename('/')).toBe('');
  });
});

describe('join', () => {
  test('joins two path segments', () => {
    expect(join('src', 'components')).toBe('src/components');
  });

  test('joins multiple segments', () => {
    expect(join('a', 'b', 'c')).toBe('a/b/c');
  });

  test('handles leading slashes on non-first segments', () => {
    expect(join('src', '/components')).toBe('src/components');
  });

  test('handles trailing slashes on non-first segments', () => {
    expect(join('src', 'components/')).toBe('src/components');
  });

  test('handles trailing slash on first segment', () => {
    expect(join('src/', 'components')).toBe('src/components');
  });

  test('preserves leading slash on first segment', () => {
    expect(join('/home', 'user')).toBe('/home/user');
  });

  test('filters empty segments', () => {
    expect(join('a', '', 'b')).toBe('a/b');
  });

  test('returns single segment', () => {
    expect(join('src')).toBe('src');
  });

  test('handles no segments', () => {
    expect(join()).toBe('');
  });

  test('preserves double slashes in middle of segment', () => {
    expect(join('a//b', 'c')).toBe('a//b/c');
  });
});

describe('toWorkspaceFileTarget', () => {
  const workspace = { path: '/Users/dev/jean2', additionalPaths: ['/Users/dev/shared/', '/Users/dev/jean2/vendor/lib'] };

  test('an absolute path in the main root becomes relative, like the file tree uses', () => {
    expect(toWorkspaceFileTarget('/Users/dev/jean2/packages/client/src/main.tsx', workspace))
      .toEqual({ path: 'packages/client/src/main.tsx' });
  });

  test('an absolute path in an additional root keeps that root', () => {
    expect(toWorkspaceFileTarget('/Users/dev/shared/notes.md', workspace))
      .toEqual({ path: 'notes.md', root: '/Users/dev/shared/' });
  });

  test('the most specific root wins when roots are nested', () => {
    expect(toWorkspaceFileTarget('/Users/dev/jean2/vendor/lib/index.ts', workspace))
      .toEqual({ path: 'index.ts', root: '/Users/dev/jean2/vendor/lib' });
  });

  test('relative paths, sibling prefixes and outside paths are left alone', () => {
    expect(toWorkspaceFileTarget('src/app.ts', workspace)).toEqual({ path: 'src/app.ts' });
    expect(toWorkspaceFileTarget('/Users/dev/jean2-other/a.ts', workspace)).toEqual({ path: '/Users/dev/jean2-other/a.ts' });
    expect(toWorkspaceFileTarget('/etc/hosts', workspace)).toEqual({ path: '/etc/hosts' });
  });
});
