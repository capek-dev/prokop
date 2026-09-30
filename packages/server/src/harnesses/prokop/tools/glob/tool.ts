import type { ToolDefinition, ToolContext, ToolResult } from '@prokopai/sdk';
import type { FileListVisualization } from '@prokopai/sdk';
import picomatch from 'picomatch';
import { scan as scanGlob } from 'picomatch';

interface Input {
  pattern: string;
  path?: string;
  ignore?: string[];
}

const SKIP_DIRS = new Set([
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
]);

export const definition: ToolDefinition = {
  name: 'glob',
  description: 'Find files matching a glob pattern. Returns matching file paths sorted by modification time.\n\nWhen to use:\n- Finding files by name patterns (e.g., all TypeScript files)\n- Locating specific file types in a project\n- When you know the directory structure pattern\n\nWhen NOT to use:\n- Searching file contents: Use grep tool instead\n- Exploring unknown structure: Use ls tool instead\n\nPattern examples:\n- `**/*.ts` - All TypeScript files recursively\n- `src/**/*.tsx` - All TSX files in src directory\n- `*.{js,ts}` - All JS and TS files in current directory (brace expansion)\n- `[abc]*.ts` - TS files starting with a, b, or c (character class)\n- `package.json` - Specific file\n- `!(README)*` - Files NOT matching README (extglob)\n\nSupports full Bash-compliant glob features via picomatch:\n- Brace expansion: `*.{js,ts}`, `src/{lib,test}/**`\n- Character classes: `[a-z]`, `[!.]`\n- Extglob: `!(pattern)`, `+(pattern)`, `?(pattern)`, `@(pattern)`\n- Globstar: `**` for recursive directory matching\n- Ignore patterns: exclude matched files from results',
  display: { summary: '{pattern}' },
  inputSchema: {
    type: 'object',
    properties: {
      pattern: {
        type: 'string',
        description: 'The glob pattern to match. Supports *, **, ?, brace expansion {a,b}, character classes [a-z], and extglob !(pattern).',
      },
      path: {
        type: 'string',
        description: 'The directory to search in. Supports relative paths from workspace, absolute paths, or home paths. Defaults to workspace root.',
      },
      ignore: {
        type: 'array',
        items: { type: 'string' },
        description: 'Glob patterns to exclude from results. For example, ["*.test.ts", "**/fixtures/**"].',
      },
    },
    required: ['pattern'],
  },
  timeout: 30000,
};

function isRecursivePattern(pattern: string): boolean {
  return pattern.includes('**');
}

interface FileResult {
  relativePath: string;
  fullPath: string;
  modifiedAt: Date;
}

async function walkDirectory(
  ctx: ToolContext,
  dirPath: string,
  basePath: string,
  results: FileResult[],
  recursive: boolean,
  ignoreMatcher: ((path: string) => boolean) | null,
): Promise<void> {
  const dirName = dirPath.split(/[/\\]/).pop() || '';
  if (SKIP_DIRS.has(dirName)) {
    return;
  }

  try {
    const entries = await ctx.fs.readDir(dirPath);

    for (const entry of entries) {
      const fullPath = `${dirPath}/${entry.name}`;
      const relativePath = fullPath.slice(basePath.length + 1).replace(/\\/g, '/');

      if (entry.isDirectory) {
        if (recursive) {
          await walkDirectory(ctx, fullPath, basePath, results, recursive, ignoreMatcher);
        }
      } else if (entry.isFile) {
        if (ignoreMatcher && ignoreMatcher(relativePath)) {
          continue;
        }
        let modifiedAt = new Date();
        try {
          const stat = await ctx.fs.stat(fullPath);
          modifiedAt = stat.modifiedAt ?? new Date();
        } catch {
          // use default date if stat fails
        }
        results.push({ relativePath, fullPath, modifiedAt });
      }
    }
  } catch (error) {
    const err = error as { code?: string };
    if (err.code !== 'EACCES' && err.code !== 'EPERM' && err.code !== 'ENOENT') {
      throw error;
    }
  }
}

export async function execute(input: Input, ctx: ToolContext): Promise<ToolResult> {
  try {
    const searchPath = input.path || ctx.workspacePath;
    const normalizedPath = ctx.resolvePath(searchPath);

    if (ctx.isBlockedPath(normalizedPath)) {
      return { success: false, error: `Globbing system directories is not allowed: ${searchPath}` };
    }

    const tempDir = ctx.env.get('JEAN2_TEMP_DIR') || ctx.env.get('TMPDIR') || '';
    const jean2TempPrefix = tempDir ? `${tempDir.replace(/[/\\]$/, '')}/jean2/` : '';
    const isJean2Temp = jean2TempPrefix && normalizedPath.startsWith(jean2TempPrefix);

    if (!isJean2Temp && !ctx.isWithinWorkspace(normalizedPath)) {
      const approved = await ctx.ask({
        target: 'permission',
        type: 'permission',
        question: 'Globbing outside the workspace requires approval.',
        risk: 'medium',
        metadata: { permissionKey: 'path:outside_workspace', permissionType: 'action' }
      });
      if (!approved) return { success: false, error: 'USER_REJECTION' };
    }

    const cwd = input.path ? ctx.fs.resolve(input.path) : ctx.workspacePath;

    const scanned = scanGlob(input.pattern);
    const hasWildcard = scanned.isGlob;

    const recursive = isRecursivePattern(input.pattern);

    const ignoreMatcher = input.ignore?.length
      ? picomatch(input.ignore, { dot: true })
      : null;

    if (!hasWildcard) {
      try {
        const exists = await ctx.fs.exists(cwd + '/' + input.pattern);
        if (exists) {
          return {
            success: true,
            result: { files: [input.pattern] },
            visualization: {
              type: 'file-list',
              badge: '1 file',
              files: [{ path: input.pattern }],
              total: 1,
            } as FileListVisualization,
          };
        }
      } catch { /* empty */ }
      return {
        success: true,
        result: { files: [] },
        visualization: {
          type: 'file-list',
          badge: '0 files',
          files: [],
          total: 0,
        } as FileListVisualization,
      };
    }

    const fileResults: FileResult[] = [];
    await walkDirectory(ctx, cwd, cwd, fileResults, recursive, ignoreMatcher);

    const isMatch = picomatch(input.pattern, { dot: true });
    const matched = fileResults.filter(f => isMatch(f.relativePath));

    matched.sort((a, b) => b.modifiedAt.getTime() - a.modifiedAt.getTime());

    const files = matched.map(f => f.relativePath);

    const visualization: FileListVisualization = {
      type: 'file-list',
      badge: `${files.length} file${files.length === 1 ? '' : 's'}`,
      title: input.pattern,
      files: files.slice(0, 50).map((f) => ({ path: f })),
      total: files.length,
    };

    return {
      success: true,
      result: { files },
      visualization,
    };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return { success: false, error: message };
  }
}
