import { describe, expect, test } from 'vitest';
import { FileTree } from '@pierre/trees';

/**
 * Contract tests for the path list consumed by FileTreePierre.
 *
 * The phase 1 `/files/tree` endpoint emits find-style directory markers
 * (`dir/`) so the renderer can distinguish directories from extension-less
 * files. Regression: a bare `.agents` entry followed by `.agents/skills/...`
 * made the path-store builder register the name as a file first and then
 * threw "Path collides with an existing file while creating directory".
 *
 * Runs in happy-dom so the real custom element + shadow DOM pipeline runs.
 */
function build(paths: string[]): number {
  const container = document.createElement('div');
  document.body.appendChild(container);
  try {
    const tree = new FileTree({
      paths,
      icons: { set: 'standard', colored: true },
    });
    tree.render({ fileTreeContainer: container });
    return tree.getVisibleCount();
  } finally {
    treeCleanup(container);
  }
}

/** Builds in an inner function so the throwing construction rejects cleanly. */
function buildExpectingThrow(paths: string[]): unknown {
  try {
    build(paths);
    return null;
  } catch (err) {
    return err;
  }
}

function treeCleanup(container: HTMLElement): void {
  container.remove();
}

describe('FileTree path list contract (regression: .agents collision loop)', () => {
  test('trailing-slash directory markers build cleanly', () => {
    const count = build([
      '.agents/',
      '.agents/skills/shadcn/SKILL.md',
      '.cursor/mcp.json',
      '.gitignore',
      'README.md',
      'package.json',
      'packages/',
      'packages/client/package.json',
    ]);
    expect(count).toBeGreaterThan(0);
  });

  test('localeCompare-sorted slash-marked list builds cleanly', () => {
    const paths = [
      '.agents/',
      '.agents/skills/shadcn-dialog-scrolling/SKILL.md',
      '.agents/skills/shadcn/SKILL.md',
      '.cursor/mcp.json',
      '.gitignore',
      'README.md',
      'packages/client/package.json',
      'packages/client/src/App.tsx',
    ].sort((a, b) => a.localeCompare(b));
    expect(() => build(paths)).not.toThrow();
  });

  test('a bare parent followed by its child reproduces the collision', () => {
    const err = buildExpectingThrow(['.agents', '.agents/skills/shadcn/SKILL.md']);
    expect(err).toBeInstanceOf(Error);
    expect((err as Error).message).toMatch(/collides/i);
  });

  test('duplicates throw "Duplicate path" instead', () => {
    const err = buildExpectingThrow(['a.txt', 'a.txt']);
    expect(err).toBeInstanceOf(Error);
    expect((err as Error).message).toContain('Duplicate path');
  });

  test('file/dir same-name reuse throws only when dir marker missing', () => {
    // src.txt vs src/x: distinct segments, no collision.
    expect(() => build(['src.txt', 'src/x'])).not.toThrow();

    // Bare dir + child file collides.
    expect(buildExpectingThrow(['src', 'src/x'])).toBeInstanceOf(Error);

    // Slash-marked dir + child file is fine.
    expect(() => build(['src/', 'src/x'])).not.toThrow();
  });
});

describe('FileTree expansion persistence', () => {
  test('resetPaths restores expansion passed via initialExpandedPaths', () => {
    const container = document.createElement('div');
    document.body.appendChild(container);
    try {
      const paths = ['a.txt', 'dir/', 'dir/b.txt'];
      const tree = new FileTree({ paths, icons: { set: 'standard' } });
      tree.render({ fileTreeContainer: container });

      // Expand dir/ through the model API (same path as clicking the chevron).
      (tree.getItem('dir/') as unknown as { toggle(): void }).toggle();
      expect(tree.getVisibleCount()).toBe(3);

      // A query refresh rebuilds the store; without restore it collapses.
      tree.resetPaths(paths);
      expect(tree.getVisibleCount()).toBe(2);

      // With persisted dirs re-passed, the branch reopens exactly.
      tree.resetPaths(paths, { initialExpandedPaths: ['dir/'] });
      expect(tree.getVisibleCount()).toBe(3);
      const rows = tree.getVisibleRows(0, 3);
      expect(rows.find((row) => row.path === 'dir/')?.isExpanded).toBe(true);
      tree.cleanUp();
    } finally {
      container.remove();
    }
  });

  test('visible-row scan yields every expanded directory path', () => {
    const container = document.createElement('div');
    document.body.appendChild(container);
    try {
      const paths = ['src/', 'src/a.ts', 'src/nested/', 'src/nested/b.ts', 'docs/x.md'];
      const tree = new FileTree({ paths, icons: { set: 'standard' } });
      tree.render({ fileTreeContainer: container });
      (tree.getItem('src/') as unknown as { toggle(): void }).toggle();
      (tree.getItem('src/nested/') as unknown as { toggle(): void }).toggle();

      const count = tree.getVisibleCount();
      const openDirs = tree
        .getVisibleRows(0, count)
        .filter((row) => row.kind === 'directory' && row.isExpanded)
        .map((row) => row.path);
      expect(openDirs.sort()).toEqual(['src/', 'src/nested/']);
      tree.cleanUp();
    } finally {
      container.remove();
    }
  });
});

describe('FileTree item identity', () => {
  test('directory ids keep the trailing slash and report isDirectory', () => {
    const container = document.createElement('div');
    document.body.appendChild(container);
    try {
      const tree = new FileTree({
        paths: ['src/', 'src/a.ts'],
        icons: { set: 'standard', colored: true },
      });
      tree.render({ fileTreeContainer: container });

      // The slash-marked registration keeps directory ids suffixed, and the
      // model can classify rows independently of the marker.
      expect(tree.getItem('src/')?.isDirectory()).toBe(true);
      expect(tree.getItem('src/a.ts')?.isDirectory()).toBe(false);

      tree.cleanUp();
    } finally {
      container.remove();
    }
  });
});

describe('FileTree resetPaths keeps accepting the same wire format', () => {
  test('repeated identical resetPaths calls stay stable', () => {
    const container = document.createElement('div');
    document.body.appendChild(container);
    try {
      const paths = ['a.txt', 'dir/', 'dir/b.txt'];
      const tree = new FileTree({
        paths,
        icons: { set: 'standard', colored: true },
      });
      tree.render({ fileTreeContainer: container });
      // Collapsed view: a.txt + dir/ = 2 rows. Repeated resets must neither
      // duplicate nor lose rows.
      tree.resetPaths(paths);
      tree.resetPaths(paths);
      expect(tree.getVisibleCount()).toBe(2);
      tree.cleanUp();
    } finally {
      container.remove();
    }
  });
});
