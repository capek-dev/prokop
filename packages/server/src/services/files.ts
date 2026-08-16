import { readdir } from 'fs/promises';
import { readFileSync, existsSync } from 'fs';
import { extname, join } from 'path';
import fg from 'fast-glob';
import ignore from 'ignore';
import type { FileEntry } from '@jean2/sdk';
import { isPathWithinWorkspace } from '@/domains/workspaces';

export { isPathWithinWorkspace };

const IGNORE_PATTERNS = [
  'node_modules/**',
  '.git/**',
  'dist/**',
  'build/**',
  '.next/**',
  '.DS_Store',
  'Thumbs.db',
];

const ignoreCache = new Map<string, { ig: ignore.Ignore; mtime: number }>();
const CACHE_TTL = 30_000;

function loadIgnoreFileContent(filePath: string): string | null {
  try {
    if (!existsSync(filePath)) return null;
    return readFileSync(filePath, 'utf-8');
  } catch {
    return null;
  }
}

export function buildIgnoreFilter(rootPath: string): ignore.Ignore {
  const now = Date.now();
  const cached = ignoreCache.get(rootPath);
  if (cached && now - cached.mtime < CACHE_TTL) {
    return cached.ig;
  }

  const ig = ignore();

  ig.add(IGNORE_PATTERNS);

  const gitignorePath = join(rootPath, '.gitignore');
  const gitignoreContent = loadIgnoreFileContent(gitignorePath);
  if (gitignoreContent) {
    ig.add(gitignoreContent);
  }

  const ignoreFilePath = join(rootPath, '.ignore');
  const ignoreContent = loadIgnoreFileContent(ignoreFilePath);
  if (ignoreContent) {
    ig.add(ignoreContent);
  }

  ignoreCache.set(rootPath, { ig, mtime: now });
  return ig;
}

export async function listDirectory(
  dirPath: string,
  showHidden = false,
): Promise<FileEntry[]> {
  const entries = await readdir(dirPath, { withFileTypes: true });

  return entries
    .filter((e) => (showHidden ? e.name !== '.git' : !e.name.startsWith('.')))
    .filter((e) => !IGNORE_PATTERNS.some((p) => e.name === p.split('/')[0]))
    .map((e) => ({
      name: e.name,
      type: e.isDirectory() ? ('directory' as const) : ('file' as const),
      path: e.name,
      extension: e.isFile() ? extname(e.name) : undefined,
    }))
    .sort((a, b) => {
      if (a.type !== b.type) return a.type === 'directory' ? -1 : 1;
      return a.name.localeCompare(b.name);
    });
}

export async function searchFiles(
  rootPath: string,
  query: string,
  limit = 20,
  showHidden = false,
  signal?: AbortSignal,
): Promise<FileEntry[]> {
  if (!query || query.length < 2) return [];
  if (signal?.aborted) return [];

  const pattern = `**/*${query}*`;

  const ignorePatterns = showHidden
    ? IGNORE_PATTERNS.filter((p) => p.startsWith('.git'))
    : IGNORE_PATTERNS;

  const entries = await fg(
    [pattern, ...ignorePatterns.map((p) => `!${p}`)],
    {
      cwd: rootPath,
      onlyFiles: false,
      suppressErrors: true,
      caseSensitiveMatch: false,
      dot: showHidden,
      markDirectories: true,
    },
  );

  if (signal?.aborted) return [];

  const ig = buildIgnoreFilter(rootPath);

  const results: FileEntry[] = [];

  for (const entryPath of entries) {
    if (signal?.aborted) break;
    if (results.length >= limit) break;

    const isDir = entryPath.endsWith('/');
    const cleanPath = isDir ? entryPath.slice(0, -1) : entryPath;

    if (ig.ignores(cleanPath)) continue;

    const name = cleanPath.split('/').pop()!;

    results.push({
      name,
      type: isDir ? ('directory' as const) : ('file' as const),
      path: cleanPath,
      extension: isDir ? undefined : extname(cleanPath),
    });
  }

  return results;
}
