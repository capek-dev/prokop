import { describe, expect, test } from 'vitest';
import type { FileEntry } from '@prokopai/sdk';
import { buildFilePathTree } from '@/components/files/filePathTree';

describe('buildFilePathTree', () => {
  test('groups search result files under their complete directory hierarchy', () => {
    const files: FileEntry[] = [
      { name: 'Button.tsx', type: 'file', path: 'src/components/Button.tsx', extension: '.tsx' },
      { name: 'dialog.tsx', type: 'file', path: 'src/components/ui/dialog.tsx', extension: '.tsx' },
      { name: 'README.md', type: 'file', path: 'README.md', extension: '.md' },
    ];

    const tree = buildFilePathTree(files);

    expect(tree.files.map((file) => file.path)).toEqual(['README.md']);
    expect(tree.directories.map((directory) => directory.path)).toEqual(['src']);

    const src = tree.directories[0]!;
    expect(src.fileCount).toBe(2);
    expect(src.directories.map((directory) => directory.path)).toEqual(['src/components']);

    const components = src.directories[0]!;
    expect(components.files.map((file) => file.path)).toEqual(['src/components/Button.tsx']);
    expect(components.directories[0]!.files.map((file) => file.path)).toEqual([
      'src/components/ui/dialog.tsx',
    ]);
  });

  test('keeps original file entries attached to leaves', () => {
    const file: FileEntry = {
      name: 'app.ts',
      type: 'file',
      path: 'src/app.ts',
      extension: '.ts',
    };

    const tree = buildFilePathTree([file]);

    expect(tree.directories[0]!.files[0]).toBe(file);
  });
});
