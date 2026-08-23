import type { ToolDefinition, ToolContext, ToolResult } from '@prokopai/sdk';
import type { FileListVisualization } from '@prokopai/sdk';

interface Input {
  path?: string;
  ignore?: string[];
  showHidden?: boolean;
}

const LIMIT = 100;

const IGNORED_NAMES = new Set([
  'node_modules',
  '.git',
  '__pycache__',
  'dist',
  'build',
  'target',
  'vendor',
  'bin',
  'obj',
  '.idea',
  '.vscode',
  '.zig-cache',
  'zig-out',
  '.coverage',
  'coverage',
  'tmp',
  'temp',
  '.cache',
  'cache',
  'logs',
  '.venv',
  'venv',
  'env',
  '.next',
  '.nuxt',
  '.output',
  '.svelte-kit',
  '.turbo',
  '.DS_Store',
  'Thumbs.db',
  '.env',
  '.env.local',
  '.env.production',
  '.env.development',
]);

export const definition: ToolDefinition = {
  name: 'ls',
  description: 'List directory contents with tree formatting.\n\nWhen to use:\n- Exploring project structure for the first time\n- Understanding directory layout\n- Viewing file organization\n\nWhen NOT to use:\n- Finding specific files: Use glob tool instead\n- Searching file contents: Use grep tool instead\n\nParameters:\n- path (optional): Directory to list. Defaults to workspace root.\n- ignore (optional): Additional directory/file names to ignore.\n- showHidden (optional): Show hidden files (dotfiles). Default false.\n\nNote: Output is limited to 100 entries. Common directories (node_modules, .git, dist, build, target, vendor, .venv, coverage, etc.) are automatically hidden.',
  display: { summary: '{path}' },
  inputSchema: {
    type: 'object',
    properties: {
      path: {
        type: 'string',
        description: 'The directory to list. Supports relative paths from workspace, absolute paths, or home paths. Defaults to workspace root.',
      },
      ignore: {
        type: 'array',
        items: { type: 'string' },
        description: 'List of additional directory or file names to ignore.',
      },
      showHidden: {
        type: 'boolean',
        description: 'Whether to show hidden files (starting with .). Default false.',
      },
    },
    required: [],
  },
  timeout: 30000,
};

function shouldIgnore(name: string, additionalIgnore?: string[]): boolean {
  if (IGNORED_NAMES.has(name)) {
    return true;
  }
  if (additionalIgnore && additionalIgnore.includes(name)) {
    return true;
  }
  return false;
}

async function walkDirectory(
  ctx: ToolContext,
  dirPath: string,
  relativePath: string,
  files: string[],
  showHidden: boolean,
  additionalIgnore?: string[],
): Promise<void> {
  if (files.length >= LIMIT) {
    return;
  }

  let entries;
  try {
    entries = await ctx.fs.readDir(dirPath);
  } catch (err) {
    const errno = err as { code?: string };
    if (errno.code === 'EACCES' || errno.code === 'EPERM' || errno.code === 'ENOENT') {
      return;
    }
    throw err;
  }

  for (const entry of entries) {
    if (files.length >= LIMIT) {
      return;
    }

    if (!showHidden && entry.name.startsWith('.')) {
      continue;
    }

    if (shouldIgnore(entry.name, additionalIgnore)) {
      continue;
    }

    const entryRelativePath = relativePath ? `${relativePath}/${entry.name}` : entry.name;

    if (entry.isDirectory) {
      const fullPath = `${dirPath}/${entry.name}`;
      await walkDirectory(ctx, fullPath, entryRelativePath, files, showHidden, additionalIgnore);
    } else {
      files.push(entryRelativePath);
    }
  }
}

function buildDirectoryStructure(files: string[]) {
  const dirs = new Set<string>();
  const filesByDir = new Map<string, string[]>();

  for (const file of files) {
    const parts = file.split(/[/\\]/);
    const dir = parts.length > 1 ? parts.slice(0, -1).join('/') : '.';

    for (let i = 0; i <= parts.length; i++) {
      const dirPath = i === 0 ? '.' : parts.slice(0, i).join('/');
      dirs.add(dirPath);
    }

    const fileName = parts[parts.length - 1];
    if (!filesByDir.has(dir)) {
      filesByDir.set(dir, []);
    }
    filesByDir.get(dir)!.push(fileName);
  }

  return { dirs, filesByDir };
}

function renderDir(dirPath: string, depth: number, dirs: Set<string>, filesByDir: Map<string, string[]>, isLast = true, parentPrefix = ''): string {
  const lines: string[] = [];
  const branch = isLast ? '└── ' : '├── ';

  if (depth === 0) {
    lines.push('./');
  } else {
    const parts = dirPath.split(/[/\\]/);
    lines.push(`${parentPrefix}${branch}${parts[parts.length - 1]}/`);
  }

  const childPrefix = parentPrefix + (isLast ? '    ' : '│   ');

  const childDirs = Array.from(dirs)
    .filter((d) => {
      const dParts = d.split(/[/\\]/);
      const dDir = dParts.length > 1 ? dParts.slice(0, -1).join('/') : '.';
      return dDir === dirPath && d !== dirPath;
    })
    .sort();

  const childFiles = (filesByDir.get(dirPath) || []).slice().sort();

  for (let i = 0; i < childDirs.length; i++) {
    const isLastDir = i === childDirs.length - 1 && childFiles.length === 0;
    const dirLines = renderDir(childDirs[i], depth + 1, dirs, filesByDir, isLastDir, childPrefix);
    lines.push(dirLines);
  }

  for (let i = 0; i < childFiles.length; i++) {
    const isLastFile = i === childFiles.length - 1;
    const fileBranch = isLastFile ? '└── ' : '├── ';
    lines.push(`${childPrefix}${fileBranch}${childFiles[i]}`);
  }

  return lines.join('\n');
}

export async function execute(input: Input, ctx: ToolContext): Promise<ToolResult> {
  try {
    const cwd = input.path ? ctx.fs.resolve(input.path) : ctx.workspacePath;

    let dirStat;
    try {
      dirStat = await ctx.fs.stat(cwd);
    } catch {
      return { success: false, error: `Directory not found: ${cwd}` };
    }

    if (!dirStat.isDirectory) {
      return { success: false, error: `Not a directory: ${cwd}` };
    }

    const files: string[] = [];
    await walkDirectory(ctx, cwd, '', files, input.showHidden ?? false, input.ignore);

    const truncated = files.length >= LIMIT;
    const { dirs, filesByDir } = buildDirectoryStructure(files);

    let content = renderDir('.', 0, dirs, filesByDir);

    if (truncated) {
      content += `\n\n(Showing 100 of ${files.length} entries. Use grep or glob for targeted searching.)`;
    }

    const visualization: FileListVisualization = {
      type: 'file-list',
      badge: truncated ? `${files.length}+ entries` : `${files.length} entries`,
      files: files.slice(0, 50).map((f) => ({ path: f })),
      total: files.length,
    };

    return {
      success: true,
      result: { content, _truncated: truncated || undefined, _count: files.length },
      visualization,
    };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return { success: false, error: message };
  }
}
