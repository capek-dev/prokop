import type { ToolDefinition, ToolContext, ToolResult } from '@prokopai/sdk';
import type { NoneVisualization } from '@prokopai/sdk';
import ignore from 'ignore';
import picomatch from 'picomatch';

interface Input {
  pattern: string;
  path?: string;
  include?: string;
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

const BINARY_EXTENSIONS = new Set([
  '.png', '.jpg', '.jpeg', '.gif', '.ico', '.svg', '.woff', '.woff2',
  '.ttf', '.eot', '.zip', '.tar', '.gz', '.7z', '.rar', '.pdf',
  '.exe', '.dll', '.so', '.dylib', '.wasm', '.mp4', '.mp3', '.wav',
  '.avi', '.mov', '.mkv', '.webp', '.webm', '.sqlite', '.db', '.bin', '.dat',
]);

const MAX_MATCHES = 5000;
const MAX_FILE_SIZE = 10 * 1024 * 1024;

export const definition: ToolDefinition = {
  name: 'grep',
  description: 'Search for text patterns in files using regular expressions.\n\nWhen to use:\n- Finding code containing specific patterns\n- Searching for function/class definitions\n- Locating usage of variables or imports\n\nWhen NOT to use:\n- Finding files by name: Use glob tool instead\n- Simple file reading: Use read-file tool instead\n\nPattern examples:\n- `function\\s+\\w+` - Function declarations\n- `import.*from` - Import statements\n- `TODO|FIXME` - Todo comments\n- `class \\w+` - Class declarations\n\nUsage:\n- pattern (required): Regex pattern to search for\n- path (required): File or directory to search in. Supports relative paths from workspace, absolute paths, or home paths.\n- include (optional): File pattern to filter (e.g., `*.ts`, `*.{ts,tsx}`). Supports brace expansion, character classes, and extglob via picomatch.\n- ignore (optional): Glob patterns to exclude from results (e.g., `[\\"*.test.ts\\", \\"**/fixtures/**\\"]`).\n\nReturns file paths and line numbers with matching content.',
  inputSchema: {
    type: 'object',
    properties: {
      pattern: {
        type: 'string',
        description: 'The regex pattern to search for',
      },
      path: {
        type: 'string',
        description: 'The file or directory to search in. Supports relative paths from workspace, absolute paths, or home paths.',
      },
      include: {
        type: 'string',
        description: 'File pattern to include. Supports brace expansion {a,b}, character classes [a-z], and extglob !(pattern).',
      },
      ignore: {
        type: 'array',
        items: { type: 'string' },
        description: 'Glob patterns to exclude from results. For example, ["*.test.ts", "**/fixtures/**"].',
      },
    },
    required: ['pattern', 'path'],
  },
  timeout: 30000,
};

function isBinaryFile(filePath: string): boolean {
  const ext = filePath.split('.').pop()?.toLowerCase() || '';
  return BINARY_EXTENSIONS.has(ext);
}

async function searchInFile(ctx: ToolContext, filePath: string, regex: RegExp): Promise<Array<{ line: number; content: string }>> {
  const matches: Array<{ line: number; content: string }> = [];

  try {
    const stat = await ctx.fs.stat(filePath);
    if (stat.size > MAX_FILE_SIZE) {
      return matches;
    }
  } catch { /* empty */ }

  try {
    const content = await ctx.fs.readFile(filePath, 'utf-8');

    if (content.includes('\0')) {
      return matches;
    }

    const lines = content.split('\n');

    for (let i = 0; i < lines.length; i++) {
      regex.lastIndex = 0;
      if (regex.test(lines[i])) {
        matches.push({
          line: i + 1,
          content: lines[i].trimEnd(),
        });
      }
    }
  } catch { /* empty */ }

  return matches;
}

async function walkDirectory(
  ctx: ToolContext,
  dirPath: string,
  basePath: string,
  ig: ReturnType<typeof ignore>,
  includeMatcher: ((path: string) => boolean) | null,
  ignoreMatcher: ((path: string) => boolean) | null,
  regex: RegExp,
  matches: Array<{ file: string; line: number; content: string }>,
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

      if (ig.ignores(relativePath)) {
        continue;
      }

      if (entry.isDirectory) {
        await walkDirectory(ctx, fullPath, basePath, ig, includeMatcher, ignoreMatcher, regex, matches);
      } else if (entry.isFile) {
        if (includeMatcher && !includeMatcher(relativePath)) {
          continue;
        }

        if (ignoreMatcher && ignoreMatcher(relativePath)) {
          continue;
        }

        if (isBinaryFile(fullPath)) {
          continue;
        }

        const fileMatches = await searchInFile(ctx, fullPath, regex);
        for (const fileMatch of fileMatches) {
          if (matches.length >= MAX_MATCHES) {
            return;
          }
          matches.push({
            file: relativePath,
            line: fileMatch.line,
            content: fileMatch.content,
          });
        }
      }
    }
  } catch (error) {
    const err = error as { code?: string };
    if (
      err.code !== 'EACCES' &&
      err.code !== 'EPERM' &&
      err.code !== 'ENOENT' &&
      err.code !== 'ENOTDIR'
    ) {
      throw error;
    }
  }
}

export async function execute(input: Input, ctx: ToolContext): Promise<ToolResult> {
  try {
    const targetPath = input.path || ctx.workspacePath;
    const normalizedPath = ctx.resolvePath(targetPath);

    if (ctx.isBlockedPath(normalizedPath)) {
      return { success: false, error: `Searching in system directories is not allowed: ${targetPath}` };
    }

    const tempDir = ctx.env.get('JEAN2_TEMP_DIR') || ctx.env.get('TMPDIR') || '';
    const jean2TempPrefix = tempDir ? `${tempDir.replace(/[/\\]$/, '')}/jean2/` : '';
    const isJean2Temp = jean2TempPrefix && normalizedPath.startsWith(jean2TempPrefix);

    if (!isJean2Temp && !ctx.isWithinWorkspace(normalizedPath)) {
      const approved = await ctx.ask({
        target: 'permission',
        type: 'permission',
        question: 'Searching in files outside the workspace requires approval.',
        risk: 'medium',
        metadata: { permissionKey: 'path:outside_workspace', permissionType: 'action' }
      });
      if (!approved) return { success: false, error: 'USER_REJECTION' };
    }

    if (ctx.isSensitivePath(normalizedPath)) {
      const approved = await ctx.ask({
        target: 'permission',
        type: 'permission',
        question: 'Searching in sensitive directories requires approval.',
        risk: 'medium',
        metadata: { permissionKey: 'file_pattern:sensitive', permissionType: 'action' }
      });
      if (!approved) return { success: false, error: 'USER_REJECTION' };
    }

    const searchPath = input.path ? ctx.fs.resolve(input.path) : ctx.workspacePath;

    let isDirectory = true;
    try {
      const stat = await ctx.fs.stat(searchPath);
      isDirectory = stat.isDirectory;
    } catch { /* empty */ }

    const gitignoreDir = isDirectory ? searchPath : searchPath.split(/[/\\]/).slice(0, -1).join('/');

    const ig = ignore();
    try {
      const gitignoreContent = await ctx.fs.readFile(`${gitignoreDir}/.gitignore`, 'utf-8');
      ig.add(gitignoreContent);
    } catch { /* empty */ }

    let regex: RegExp;
    try {
      regex = new RegExp(input.pattern);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return {
        success: false,
        error: `Invalid regex pattern: ${message}`,
      };
    }

    const includeMatcher = input.include ? picomatch(input.include, { dot: true }) : null;
    const ignoreMatcher = input.ignore?.length ? picomatch(input.ignore, { dot: true }) : null;

    const matches: Array<{ file: string; line: number; content: string }> = [];

    if (!isDirectory) {
      const relativePath = searchPath.replace(gitignoreDir, '').replace(/^[/\\]/, '').replace(/\\/g, '/');
      if (!ig.ignores(relativePath) && !isBinaryFile(searchPath)) {
        const fileMatches = await searchInFile(ctx, searchPath, regex);
        for (const fileMatch of fileMatches) {
          if (matches.length >= MAX_MATCHES) break;
          matches.push({
            file: relativePath,
            line: fileMatch.line,
            content: fileMatch.content,
          });
        }
      }
    } else {
      await walkDirectory(ctx, searchPath, searchPath, ig, includeMatcher, ignoreMatcher, regex, matches);
    }

    const truncated = matches.length >= MAX_MATCHES;
    const message = truncated
      ? `Grep: "${input.pattern}" (${matches.length} matches, truncated to ${MAX_MATCHES})`
      : `Grep: "${input.pattern}" (${matches.length} matches)`;

    const visualization: NoneVisualization = {
      type: 'none',
      message,
    };

    return {
      success: true,
      result: { matches },
      visualization,
    };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return { success: false, error: message };
  }
}
