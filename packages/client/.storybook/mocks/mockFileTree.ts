import type { FileEntry } from '@prokopai/sdk';
import { merge } from './mockHelpers';

// =============================================================================
// FileEntry Factory
// =============================================================================

export function createFileEntry(
  overrides: Partial<FileEntry> = {},
): FileEntry {
  return merge<FileEntry>(
    {
      name: 'index.ts',
      type: 'file',
      path: 'src/index.ts',
      extension: 'ts',
    },
    overrides,
  );
}

// =============================================================================
// File Tree — a hierarchical tree structure for the file browser
// =============================================================================

export interface FileTreeNode {
  name: string;
  type: 'file' | 'directory';
  path: string;
  extension?: string;
  children?: FileTreeNode[];
}

export function createFileTreeNode(
  overrides: Partial<FileTreeNode> = {},
): FileTreeNode {
  return merge<FileTreeNode>(
    {
      name: 'index.ts',
      type: 'file',
      path: 'src/index.ts',
      extension: 'ts',
    },
    overrides,
  );
}

// =============================================================================
// Presets — File tree scenarios
// =============================================================================

export const fileTreePresets = {
  /** A typical project file tree */
  typicalProject: [
    createFileTreeNode({
      name: 'src',
      type: 'directory',
      path: 'src',
      children: [
        createFileTreeNode({ name: 'index.ts', type: 'file', path: 'src/index.ts', extension: 'ts' }),
        createFileTreeNode({ name: 'app.ts', type: 'file', path: 'src/app.ts', extension: 'ts' }),
        createFileTreeNode({
          name: 'components',
          type: 'directory',
          path: 'src/components',
          children: [
            createFileTreeNode({ name: 'Header.tsx', type: 'file', path: 'src/components/Header.tsx', extension: 'tsx' }),
            createFileTreeNode({ name: 'Footer.tsx', type: 'file', path: 'src/components/Footer.tsx', extension: 'tsx' }),
            createFileTreeNode({ name: 'Button.tsx', type: 'file', path: 'src/components/Button.tsx', extension: 'tsx' }),
          ],
        }),
        createFileTreeNode({
          name: 'utils',
          type: 'directory',
          path: 'src/utils',
          children: [
            createFileTreeNode({ name: 'helpers.ts', type: 'file', path: 'src/utils/helpers.ts', extension: 'ts' }),
            createFileTreeNode({ name: 'format.ts', type: 'file', path: 'src/utils/format.ts', extension: 'ts' }),
          ],
        }),
      ],
    }),
    createFileTreeNode({ name: 'package.json', type: 'file', path: 'package.json', extension: 'json' }),
    createFileTreeNode({ name: 'tsconfig.json', type: 'file', path: 'tsconfig.json', extension: 'json' }),
    createFileTreeNode({ name: 'README.md', type: 'file', path: 'README.md', extension: 'md' }),
    createFileTreeNode({ name: '.gitignore', type: 'file', path: '.gitignore' }),
  ] as FileTreeNode[],

  /** A monorepo with packages */
  monorepo: [
    createFileTreeNode({
      name: 'packages',
      type: 'directory',
      path: 'packages',
      children: [
        createFileTreeNode({
          name: 'server',
          type: 'directory',
          path: 'packages/server',
          children: [
            createFileTreeNode({ name: 'index.ts', type: 'file', path: 'packages/server/index.ts', extension: 'ts' }),
            createFileTreeNode({ name: 'package.json', type: 'file', path: 'packages/server/package.json', extension: 'json' }),
          ],
        }),
        createFileTreeNode({
          name: 'client',
          type: 'directory',
          path: 'packages/client',
          children: [
            createFileTreeNode({ name: 'main.tsx', type: 'file', path: 'packages/client/main.tsx', extension: 'tsx' }),
            createFileTreeNode({ name: 'package.json', type: 'file', path: 'packages/client/package.json', extension: 'json' }),
          ],
        }),
        createFileTreeNode({
          name: 'sdk',
          type: 'directory',
          path: 'packages/sdk',
          children: [
            createFileTreeNode({ name: 'index.ts', type: 'file', path: 'packages/sdk/index.ts', extension: 'ts' }),
            createFileTreeNode({ name: 'package.json', type: 'file', path: 'packages/sdk/package.json', extension: 'json' }),
          ],
        }),
      ],
    }),
    createFileTreeNode({ name: 'package.json', type: 'file', path: 'package.json', extension: 'json' }),
    createFileTreeNode({ name: 'bun.lockb', type: 'file', path: 'bun.lockb', extension: 'lockb' }),
  ] as FileTreeNode[],

  /** A flat directory with just files */
  flat: [
    createFileTreeNode({ name: 'index.html', type: 'file', path: 'index.html', extension: 'html' }),
    createFileTreeNode({ name: 'styles.css', type: 'file', path: 'styles.css', extension: 'css' }),
    createFileTreeNode({ name: 'script.js', type: 'file', path: 'script.js', extension: 'js' }),
    createFileTreeNode({ name: 'README.md', type: 'file', path: 'README.md', extension: 'md' }),
  ] as FileTreeNode[],

  /** An empty directory */
  empty: [] as FileTreeNode[],
} as const;

/** Flat file entry list (as returned by API) */
export function createFileEntryList(): FileEntry[] {
  return [
    createFileEntry({ name: 'src', type: 'directory', path: 'src' }),
    createFileEntry({ name: 'index.ts', type: 'file', path: 'src/index.ts', extension: 'ts' }),
    createFileEntry({ name: 'app.ts', type: 'file', path: 'src/app.ts', extension: 'ts' }),
    createFileEntry({ name: 'package.json', type: 'file', path: 'package.json', extension: 'json' }),
    createFileEntry({ name: 'README.md', type: 'file', path: 'README.md', extension: 'md' }),
    createFileEntry({ name: '.gitignore', type: 'file', path: '.gitignore' }),
  ];
}
