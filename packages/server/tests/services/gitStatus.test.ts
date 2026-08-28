import { describe, test, expect } from 'bun:test';
import { _internal, attachGitStatusToEntries } from '@/infrastructure/filesystem/git-status';
import type { FileEntry, GitDiffSummary, GitAvailability } from '@prokopai/sdk';

const {
  parsePorcelainStatus,
  parseNumstat,
  aggregateDirectoryStatus,
  mapStatus,
  parseUnifiedDiff,
  stripTerminalLineEnding,
} = _internal;

describe('gitStatus', () => {
  describe('mapStatus', () => {
    test('maps untracked files', () => {
      expect(mapStatus('?', '?')).toBe('untracked');
    });

    test('maps ignored files', () => {
      expect(mapStatus('!', '!')).toBe('ignored');
    });

    test('maps staged modified', () => {
      expect(mapStatus('M', ' ')).toBe('modified');
    });

    test('maps unstaged modified', () => {
      expect(mapStatus(' ', 'M')).toBe('modified');
    });

    test('maps staged added', () => {
      expect(mapStatus('A', ' ')).toBe('added');
    });

    test('maps deleted', () => {
      expect(mapStatus(' ', 'D')).toBe('deleted');
      expect(mapStatus('D', ' ')).toBe('deleted');
    });

    test('maps renamed', () => {
      expect(mapStatus('R', ' ')).toBe('renamed');
      expect(mapStatus(' ', 'R')).toBe('renamed');
    });

    test('maps copied', () => {
      expect(mapStatus('C', ' ')).toBe('copied');
    });

    test('maps conflicted - both modified (UU)', () => {
      expect(mapStatus('U', 'U')).toBe('conflicted');
    });

    test('maps conflicted - added by both (AA)', () => {
      expect(mapStatus('A', 'A')).toBe('conflicted');
    });

    test('maps conflicted - deleted by both (DD)', () => {
      expect(mapStatus('D', 'D')).toBe('conflicted');
    });

    test('maps conflicted - ours (U)', () => {
      expect(mapStatus('U', ' ')).toBe('conflicted');
    });
  });

  describe('parsePorcelainStatus', () => {
    test('parses empty output', () => {
      const result = parsePorcelainStatus('');
      expect(result.size).toBe(0);
    });

    test('parses modified file', () => {
      const result = parsePorcelainStatus(' M packages/client/src/components/files/FileTree.tsx');
      const entry = result.get('packages/client/src/components/files/FileTree.tsx');
      expect(entry).toBeDefined();
      expect(entry!.status).toBe('modified');
      expect(entry!.staged).toBe(false);
      expect(entry!.unstaged).toBe(true);
    });

    test('parses staged added file', () => {
      const result = parsePorcelainStatus('A  packages/server/src/services/gitStatus.ts');
      const entry = result.get('packages/server/src/services/gitStatus.ts');
      expect(entry).toBeDefined();
      expect(entry!.status).toBe('added');
      expect(entry!.staged).toBe(true);
      expect(entry!.unstaged).toBe(false);
    });

    test('parses untracked file', () => {
      const result = parsePorcelainStatus('?? packages/client/src/components/files/GitStatusBadge.tsx');
      const entry = result.get('packages/client/src/components/files/GitStatusBadge.tsx');
      expect(entry).toBeDefined();
      expect(entry!.status).toBe('untracked');
      expect(entry!.staged).toBe(false);
      expect(entry!.unstaged).toBe(false);
    });

    test('parses deleted file', () => {
      const result = parsePorcelainStatus(' D README.md');
      const entry = result.get('README.md');
      expect(entry).toBeDefined();
      expect(entry!.status).toBe('deleted');
    });

    test('parses renamed file with arrow', () => {
      const result = parsePorcelainStatus('R  old/path.ts -> new/path.ts');
      const entry = result.get('new/path.ts');
      expect(entry).toBeDefined();
      expect(entry!.status).toBe('renamed');
      expect(entry!.oldPath).toBe('old/path.ts');
    });

    test('parses conflicted file', () => {
      const result = parsePorcelainStatus('UU conflicted.ts');
      const entry = result.get('conflicted.ts');
      expect(entry).toBeDefined();
      expect(entry!.status).toBe('conflicted');
    });

    test('parses multiple lines', () => {
      const output = [
        ' M file1.ts',
        'A  file2.ts',
        '?? file3.ts',
      ].join('\n');
      const result = parsePorcelainStatus(output);
      expect(result.size).toBe(3);
    });
  });

  describe('parseNumstat', () => {
    test('parses empty output', () => {
      const result = parseNumstat('');
      expect(result.size).toBe(0);
    });

    test('parses normal numstat line', () => {
      const result = parseNumstat('12\t3\tpackages/client/src/components/files/FileTree.tsx');
      const entry = result.get('packages/client/src/components/files/FileTree.tsx');
      expect(entry).toBeDefined();
      expect(entry!.additions).toBe(12);
      expect(entry!.deletions).toBe(3);
    });

    test('parses binary file numstat', () => {
      const result = parseNumstat('-\t-\tbinary-file.png');
      const entry = result.get('binary-file.png');
      expect(entry).toBeDefined();
      expect(entry!.additions).toBeUndefined();
      expect(entry!.deletions).toBeUndefined();
    });

    test('parses multiple lines', () => {
      const output = [
        '12\t3\tfile1.ts',
        '5\t0\tfile2.ts',
      ].join('\n');
      const result = parseNumstat(output);
      expect(result.size).toBe(2);
    });
  });

  describe('aggregateDirectoryStatus', () => {
    test('returns undefined for empty map', () => {
      const result = aggregateDirectoryStatus('src', new Map());
      expect(result).toBeUndefined();
    });

    test('returns undefined when no descendants match', () => {
      const files = new Map<string, GitDiffSummary>([
        ['other/file.ts', { status: 'modified', staged: false, unstaged: true }],
      ]);
      const result = aggregateDirectoryStatus('src', files);
      expect(result).toBeUndefined();
    });

    test('aggregates descendant files', () => {
      const files = new Map<string, GitDiffSummary>([
        ['src/file1.ts', { status: 'modified', staged: false, unstaged: true, additions: 5, deletions: 2 }],
        ['src/file2.ts', { status: 'added', staged: true, unstaged: false, additions: 10, deletions: 0 }],
      ]);
      const result = aggregateDirectoryStatus('src', files);
      expect(result).toBeDefined();
      expect(result!.status).toBe('added');
      expect(result!.staged).toBe(true);
      expect(result!.unstaged).toBe(true);
      expect(result!.additions).toBe(15);
      expect(result!.deletions).toBe(2);
    });

    test('picks highest priority status', () => {
      const files = new Map<string, GitDiffSummary>([
        ['src/a.ts', { status: 'modified', staged: false, unstaged: true }],
        ['src/b.ts', { status: 'deleted', staged: true, unstaged: false }],
        ['src/c.ts', { status: 'untracked', staged: false, unstaged: false }],
      ]);
      const result = aggregateDirectoryStatus('src', files);
      expect(result!.status).toBe('deleted');
    });

    test('handles deep descendants', () => {
      const files = new Map<string, GitDiffSummary>([
        ['src/components/files/FileTree.tsx', { status: 'modified', staged: false, unstaged: true }],
      ]);
      const result = aggregateDirectoryStatus('src', files);
      expect(result).toBeDefined();
      expect(result!.status).toBe('modified');
    });

    test('leaves additions/deletions undefined when all binary', () => {
      const files = new Map<string, GitDiffSummary>([
        ['assets/logo.png', { status: 'added', staged: true, unstaged: false }],
      ]);
      const result = aggregateDirectoryStatus('assets', files);
      expect(result!.additions).toBeUndefined();
      expect(result!.deletions).toBeUndefined();
    });
  });

  describe('attachGitStatusToEntries', () => {
    test('returns entries unchanged when git not available', () => {
      const entries: FileEntry[] = [
        { name: 'file.ts', type: 'file', path: 'file.ts' },
      ];
      const gitStatus = {
        availability: { available: false, reason: 'git_not_installed' as const },
        files: new Map<string, GitDiffSummary>(),
      };
      const result = attachGitStatusToEntries(entries, '/workspace', gitStatus);
      expect(result[0].git).toBeUndefined();
    });

    test('attaches git status to files', () => {
      const entries: FileEntry[] = [
        { name: 'FileTree.tsx', type: 'file', path: 'FileTree.tsx', extension: '.tsx' },
        { name: 'files', type: 'directory', path: 'files' },
      ];
      const gitStatus = {
        availability: { available: true, root: '/workspace' } as GitAvailability,
        files: new Map<string, GitDiffSummary>([
          ['src/FileTree.tsx', { status: 'modified', staged: false, unstaged: true, additions: 12, deletions: 3 }],
        ]),
      };
      const result = attachGitStatusToEntries(entries, '/workspace/src', gitStatus);
      expect(result[0].git).toBeDefined();
      expect(result[0].git!.status).toBe('modified');
      expect(result[0].git!.additions).toBe(12);
    });

    test('attaches aggregated status to directories', () => {
      const entries: FileEntry[] = [
        { name: 'components', type: 'directory', path: 'components' },
      ];
      const gitStatus = {
        availability: { available: true, root: '/workspace' } as GitAvailability,
        files: new Map<string, GitDiffSummary>([
          ['src/components/a.ts', { status: 'modified', staged: false, unstaged: true, additions: 5, deletions: 1 }],
          ['src/components/b.ts', { status: 'added', staged: true, unstaged: false, additions: 3, deletions: 0 }],
        ]),
      };
      const result = attachGitStatusToEntries(entries, '/workspace/src', gitStatus);
      expect(result[0].git).toBeDefined();
      expect(result[0].git!.status).toBe('added');
      expect(result[0].git!.additions).toBe(8);
      expect(result[0].git!.deletions).toBe(1);
    });

    test('returns entries unchanged when path is outside repo', () => {
      const entries: FileEntry[] = [
        { name: 'file.ts', type: 'file', path: 'file.ts' },
      ];
      const gitStatus = {
        availability: { available: true, root: '/other/repo' } as GitAvailability,
        files: new Map<string, GitDiffSummary>(),
      };
      const result = attachGitStatusToEntries(entries, '/workspace', gitStatus);
      expect(result[0].git).toBeUndefined();
    });
  });

  describe('parseUnifiedDiff', () => {
    test('parses empty diff', () => {
      const result = parseUnifiedDiff('');
      expect(result.hunks).toHaveLength(0);
      expect(result.additions).toBe(0);
      expect(result.deletions).toBe(0);
    });

    test('parses single hunk with added and removed lines', () => {
      const patch = [
        'diff --git a/file.ts b/file.ts',
        'index abc1234..def5678 100644',
        '--- a/file.ts',
        '+++ b/file.ts',
        '@@ -10,7 +10,8 @@',
        ' context line 1',
        '-removed line',
        ' context line 2',
        '+added line 1',
        '+added line 2',
        ' context line 3',
      ].join('\n');

      const result = parseUnifiedDiff(patch);
      expect(result.hunks).toHaveLength(1);

      const hunk = result.hunks[0];
      expect(hunk.oldStart).toBe(10);
      expect(hunk.oldLines).toBe(7);
      expect(hunk.newStart).toBe(10);
      expect(hunk.newLines).toBe(8);
      expect(hunk.changes).toHaveLength(6);

      expect(hunk.changes[0]).toEqual({ type: 'context', content: 'context line 1', lineNumber: 10, newLineNumber: 10 });
      expect(hunk.changes[1]).toEqual({ type: 'removed', content: 'removed line', lineNumber: 11 });
      expect(hunk.changes[2]).toEqual({ type: 'context', content: 'context line 2', lineNumber: 12, newLineNumber: 11 });
      expect(hunk.changes[3]).toEqual({ type: 'added', content: 'added line 1', newLineNumber: 12 });
      expect(hunk.changes[4]).toEqual({ type: 'added', content: 'added line 2', newLineNumber: 13 });
      expect(hunk.changes[5]).toEqual({ type: 'context', content: 'context line 3', lineNumber: 13, newLineNumber: 14 });

      expect(result.additions).toBe(2);
      expect(result.deletions).toBe(1);
    });

    test('parses multiple hunks', () => {
      const patch = [
        'diff --git a/file.ts b/file.ts',
        '--- a/file.ts',
        '+++ b/file.ts',
        '@@ -1,3 +1,3 @@',
        ' line 1',
        '-old line',
        '+new line',
        '@@ -20,3 +20,3 @@',
        ' line 20',
        '-old 21',
        '+new 21',
      ].join('\n');

      const result = parseUnifiedDiff(patch);
      expect(result.hunks).toHaveLength(2);
      expect(result.additions).toBe(2);
      expect(result.deletions).toBe(2);

      expect(result.hunks[0].oldStart).toBe(1);
      expect(result.hunks[1].oldStart).toBe(20);
    });

    test('handles single-line hunk header without count', () => {
      const patch = [
        '@@ -12 +12 @@',
        '-old',
        '+new',
      ].join('\n');

      const result = parseUnifiedDiff(patch);
      expect(result.hunks).toHaveLength(1);
      expect(result.hunks[0].oldStart).toBe(12);
      expect(result.hunks[0].oldLines).toBe(1);
      expect(result.hunks[0].newStart).toBe(12);
      expect(result.hunks[0].newLines).toBe(1);
    });

    test('handles @@ -0,0 +1,N @@ for new files', () => {
      const patch = [
        '@@ -0,0 +1,3 @@',
        '+line 1',
        '+line 2',
        '+line 3',
      ].join('\n');

      const result = parseUnifiedDiff(patch);
      expect(result.hunks).toHaveLength(1);
      expect(result.hunks[0].oldStart).toBe(0);
      expect(result.hunks[0].oldLines).toBe(0);
      expect(result.hunks[0].newStart).toBe(1);
      expect(result.hunks[0].newLines).toBe(3);
      expect(result.additions).toBe(3);
      expect(result.deletions).toBe(0);
    });

    test('ignores file headers', () => {
      const patch = [
        'diff --git a/foo.ts b/foo.ts',
        'index abc..def 100644',
        '--- a/foo.ts',
        '+++ b/foo.ts',
        '@@ -1 +1 @@',
        '-old',
        '+new',
      ].join('\n');

      const result = parseUnifiedDiff(patch);
      expect(result.hunks).toHaveLength(1);
      expect(result.hunks[0].changes).toHaveLength(2);
    });

    test('ignores no-newline-at-end-of-file markers', () => {
      const patch = [
        '@@ -1,2 +1,2 @@',
        ' line 1',
        '-line 2',
        '\\ No newline at end of file',
        '+line 2 new',
      ].join('\n');

      const result = parseUnifiedDiff(patch);
      expect(result.hunks).toHaveLength(1);
      expect(result.hunks[0].changes).toHaveLength(3);
      expect(result.additions).toBe(1);
      expect(result.deletions).toBe(1);
    });

    test('retains a final empty context line after Git output normalization', () => {
      const stdout = [
        'diff --git a/file.ts b/file.ts',
        '--- a/file.ts',
        '+++ b/file.ts',
        '@@ -145,7 +145,10 @@',
        ' ',
        '  useEffect(() => {',
        '    if (toolsData?.tools) {',
        '-      setAvailableTools(toolsData.tools);',
        '+      // Domain tools (memory, skills, search, workflow, scheduler, task)',
        '+      // are gated by workspace capability toggles, not preconfig tool',
        '+      // selection; selecting them here would do nothing.',
        "+      setAvailableTools(toolsData.tools.filter(tool => tool.source !== 'domain'));",
        '    }',
        '  }, [toolsData]);',
        ' ',
      ].join('\n') + '\n';

      const normalized = stripTerminalLineEnding(stdout);
      expect(normalized.endsWith(' ')).toBe(true);

      const result = parseUnifiedDiff(normalized);
      expect(result.hunks).toHaveLength(1);
      expect(result.additions).toBe(4);
      expect(result.deletions).toBe(1);

      const hunk = result.hunks[0];
      const oldConsumed = hunk.changes.filter((change) => change.type !== 'added').length;
      const newConsumed = hunk.changes.filter((change) => change.type !== 'removed').length;
      expect(oldConsumed).toBe(hunk.oldLines);
      expect(newConsumed).toBe(hunk.newLines);
      expect(hunk.changes.at(-1)).toEqual({
        type: 'context',
        content: '',
        lineNumber: 151,
        newLineNumber: 154,
      });
    });

    test('returns empty for whitespace-only input', () => {
      const result = parseUnifiedDiff('   \n  \n');
      expect(result.hunks).toHaveLength(0);
    });
  });
});
