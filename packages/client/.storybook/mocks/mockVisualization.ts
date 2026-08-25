import type {
  DiffVisualization,
  DiffsVisualization,
  CodeVisualization,
  FileListVisualization,
  TableVisualization,
  MarkdownVisualization,
  ShellOutputVisualization,
  NoneVisualization,
  TodoListVisualization,
} from '@prokopai/sdk';
import { merge } from './mockHelpers';

// =============================================================================
// Visualization Factories
// =============================================================================

export function createDiffVisualization(
  overrides: Partial<DiffVisualization> = {},
): DiffVisualization {
  return merge<DiffVisualization>(
    {
      type: 'diff',
      path: 'src/index.ts',
      language: 'typescript',
      additions: 3,
      deletions: 1,
      hunks: [
        {
          oldStart: 1,
          oldLines: 3,
          newStart: 1,
          newLines: 5,
          changes: [
            { type: 'context', content: "import { createApp } from './app';", oldLineNumber: 1, newLineNumber: 1 },
            { type: 'removed', content: "const port = 3000;", oldLineNumber: 2 },
            { type: 'added', content: "import { config } from './config';", newLineNumber: 2 },
            { type: 'added', content: '', newLineNumber: 3 },
            { type: 'added', content: "const port = config.port || 3000;", newLineNumber: 4 },
            { type: 'context', content: '', oldLineNumber: 3, newLineNumber: 5 },
          ],
        },
      ],
    },
    overrides,
  );
}

export function createDiffsVisualization(
  overrides: Partial<DiffsVisualization> = {},
): DiffsVisualization {
  return merge<DiffsVisualization>(
    {
      type: 'diffs',
      items: [
        createDiffVisualization({ path: 'src/index.ts' }),
        createDiffVisualization({
          path: 'src/utils.ts',
          additions: 1,
          deletions: 0,
          hunks: [
            {
              oldStart: 10,
              oldLines: 1,
              newStart: 10,
              newLines: 2,
              changes: [
                { type: 'context', content: 'export function helper() {', oldLineNumber: 10, newLineNumber: 10 },
                { type: 'added', content: '  // Added comment', newLineNumber: 11 },
              ],
            },
          ],
        }),
      ],
    },
    overrides,
  );
}

export function createCodeVisualization(
  overrides: Partial<CodeVisualization> = {},
): CodeVisualization {
  return merge<CodeVisualization>(
    {
      type: 'code',
      path: 'src/main.ts',
      content: [
        "import { app } from './app';",
        '',
        'async function main() {',
        "  const port = parseInt(process.env.PORT || '3000', 10);",
        '  await app.listen({ port });',
        '  console.log(`Server listening on port ${port}`);',
        '}',
        '',
        'main().catch(console.error);',
      ].join('\n'),
      language: 'typescript',
      created: false,
      highlightLines: [4],
      lineCount: 9,
    },
    overrides,
  );
}

export function createFileListVisualization(
  overrides: Partial<FileListVisualization> = {},
): FileListVisualization {
  return merge<FileListVisualization>(
    {
      type: 'file-list',
      total: 5,
      groups: [
        {
          label: 'Modified',
          icon: 'edit' as const,
          files: [
            { path: 'src/index.ts', action: 'modified' as const, line: 4 },
            { path: 'src/utils.ts', action: 'modified' as const },
          ],
        },
        {
          label: 'Created',
          icon: 'plus' as const,
          files: [
            { path: 'src/config.ts', action: 'created' as const },
          ],
        },
        {
          label: 'Deleted',
          icon: 'trash' as const,
          files: [
            { path: 'src/old-module.ts', action: 'deleted' as const },
          ],
        },
      ],
    },
    overrides,
  );
}

export function createTableVisualization(
  overrides: Partial<TableVisualization> = {},
): TableVisualization {
  return merge<TableVisualization>(
    {
      type: 'table',
      columns: [
        { key: 'name', label: 'Name', width: '200px' },
        { key: 'status', label: 'Status', width: '100px' },
        { key: 'size', label: 'Size', width: '80px' },
      ],
      rows: [
        { name: 'index.ts', status: 'modified', size: '2.4 KB' },
        { name: 'utils.ts', status: 'unmodified', size: '1.1 KB' },
        { name: 'config.ts', status: 'created', size: '0.8 KB' },
      ],
      totalRows: 3,
      hasMore: false,
    },
    overrides,
  );
}

export function createMarkdownVisualization(
  overrides: Partial<MarkdownVisualization> = {},
): MarkdownVisualization {
  return merge<MarkdownVisualization>(
    {
      type: 'markdown',
      content: [
        '# Analysis Results',
        '',
        '## Summary',
        '',
        'The project uses **TypeScript** with the following structure:',
        '',
        '- `src/index.ts` — Entry point',
        '- `src/app.ts` — Hono app setup',
        '- `src/utils/` — Utility functions',
        '',
        '> This analysis was generated automatically.',
      ].join('\n'),
    },
    overrides,
  );
}

export function createShellOutputVisualization(
  overrides: Partial<ShellOutputVisualization> = {},
): ShellOutputVisualization {
  return merge<ShellOutputVisualization>(
    {
      type: 'shell-output',
      command: 'bun run build',
      stdout: [
        '$ bun run build',
        'Building server...',
        '  ✓ src/index.ts (1.2kb)',
        '  ✓ src/app.ts (3.4kb)',
        '  ✓ src/utils.ts (0.8kb)',
        '',
        '  3 files built in 142ms',
      ].join('\n'),
      stderr: '',
      exitCode: 0,
    },
    overrides,
  );
}

export function createNoneVisualization(
  overrides: Partial<NoneVisualization> = {},
): NoneVisualization {
  return merge<NoneVisualization>(
    { type: 'none', message: 'No visualization available for this output.' },
    overrides,
  );
}

export function createTodoListVisualization(
  overrides: Partial<TodoListVisualization> = {},
): TodoListVisualization {
  return merge<TodoListVisualization>(
    {
      type: 'todo-list',
      items: [
        { content: 'Set up project structure', status: 'completed', priority: 'high' },
        { content: 'Implement authentication', status: 'completed', priority: 'high' },
        { content: 'Add database migrations', status: 'in_progress', priority: 'high' },
        { content: 'Write API tests', status: 'pending', priority: 'medium' },
        { content: 'Update documentation', status: 'pending', priority: 'low' },
        { content: 'Deploy to staging', status: 'cancelled', priority: 'medium' },
      ],
    },
    overrides,
  );
}

// =============================================================================
// Visualization Presets
// =============================================================================

export const visualizationPresets = {
  diff: createDiffVisualization(),
  diffs: createDiffsVisualization(),
  code: createCodeVisualization(),
  fileList: createFileListVisualization(),
  table: createTableVisualization(),
  markdown: createMarkdownVisualization(),
  shellOutput: createShellOutputVisualization(),
  none: createNoneVisualization(),
  todoList: createTodoListVisualization(),
  shellError: createShellOutputVisualization({
    command: 'npm test',
    stdout: '',
    stderr: [
      'FAIL src/utils.test.ts',
      '  ● validateInput › should reject empty strings',
      '',
      "    expect(received).toBe(expected)",
      '    Expected: false',
      '    Received: true',
    ].join('\n'),
    exitCode: 1,
  }),
  largeDiff: createDiffVisualization({
    path: 'src/large-file.ts',
    additions: 45,
    deletions: 12,
  }),
  newFile: createCodeVisualization({
    path: 'src/new-module.ts',
    content: "export const VERSION = '1.0.0';\n",
    created: true,
  }),
} as const;
