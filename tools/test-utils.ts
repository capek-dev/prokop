/**
 * Shared test utilities for tool tests.
 *
 * Provides a fully-mocked ToolContext so tools never touch the real filesystem,
 * network, or local processes.
 */
import { mock } from 'bun:test';
import type { ToolContext, PermissionAsk } from '@capekai/tool';

export const WORKSPACE = '/workspace/project';

/**
 * Stateful virtual filesystem backed by an in-memory Map.
 * Tools can read/write through ctx.fs and we can assert on the contents.
 */
export class VirtualFS {
  private files = new Map<string, string>();
  private modifiedAt = new Map<string, Date>();
  private dirs = new Set<string>();

  constructor() {
    this.dirs.add(WORKSPACE);
  }

  /** Write a file into the virtual FS, creating parent dirs as needed. */
  writeFile(path: string, content: string): void {
    this.files.set(path, content);
    this.modifiedAt.set(path, new Date());
    // Ensure parent dirs exist
    const parts = path.split('/');
    for (let i = 2; i <= parts.length; i++) {
      this.dirs.add(parts.slice(0, i).join('/'));
    }
  }

  /** Read a file from the virtual FS. Returns undefined if not found. */
  readFile(path: string): string | undefined {
    return this.files.get(path);
  }

  /** Check if a file exists. */
  hasFile(path: string): boolean {
    return this.files.has(path);
  }

  /** Add a directory entry. */
  addDir(path: string): void {
    this.dirs.add(path);
  }

  /** List directory entries (both files and subdirectories). */
  listDir(dirPath: string): Array<{ name: string; isDirectory: boolean; isFile: boolean }> {
    const entries: Array<{ name: string; isDirectory: boolean; isFile: boolean }> = [];

    // Direct children dirs
    for (const d of this.dirs) {
      const parent = d.substring(0, d.lastIndexOf('/'));
      if (parent === dirPath) {
        const name = d.substring(d.lastIndexOf('/') + 1);
        if (name) entries.push({ name, isDirectory: true, isFile: false });
      }
    }

    // Direct children files
    for (const [f] of this.files) {
      const parent = f.substring(0, f.lastIndexOf('/'));
      if (parent === dirPath) {
        const name = f.substring(f.lastIndexOf('/') + 1);
        entries.push({ name, isDirectory: false, isFile: true });
      }
    }

    return entries.sort((a, b) => a.name.localeCompare(b.name));
  }

  exists(path: string): boolean {
    return this.files.has(path) || this.dirs.has(path);
  }

  /**
   * Remove a file or directory from the virtual FS.
   * When recursive is true (or the path is a file), removes the entry and
   * any descendant entries. Returns true if anything was removed.
   */
  remove(path: string, options?: { recursive?: boolean }): boolean {
    let removed = false;
    if (this.files.has(path)) {
      this.files.delete(path);
      this.modifiedAt.delete(path);
      removed = true;
    }
    if (this.dirs.has(path)) {
      if (options?.recursive) {
        // Remove any descendant files and dirs
        const prefix = path.endsWith('/') ? path : path + '/';
        for (const f of [...this.files.keys()]) {
          if (f.startsWith(prefix)) {
            this.files.delete(f);
            this.modifiedAt.delete(f);
            removed = true;
          }
        }
        for (const d of [...this.dirs]) {
          if (d === path || d.startsWith(prefix)) {
            this.dirs.delete(d);
            removed = true;
          }
        }
      } else {
        // Only remove the dir entry if it has no children
        const prefix = path.endsWith('/') ? path : path + '/';
        const hasChildren =
          [...this.files.keys()].some(f => f.startsWith(prefix)) ||
          [...this.dirs].some(d => d !== path && d.startsWith(prefix));
        if (!hasChildren) {
          this.dirs.delete(path);
          removed = true;
        }
      }
    }
    return removed;
  }

  /**
   * Rename (move) a file from oldPath to newPath. Creates parent dirs of the
   * destination. Returns true if the source existed and was moved.
   */
  rename(oldPath: string, newPath: string): boolean {
    if (!this.files.has(oldPath)) return false;
    const content = this.files.get(oldPath)!;
    this.files.delete(oldPath);
    this.modifiedAt.delete(oldPath);
    this.writeFile(newPath, content);
    return true;
  }

  stat(path: string) {
    if (this.files.has(path)) {
      const content = this.files.get(path)!;
      const timestamp = this.modifiedAt.get(path) ?? new Date();
      return {
        size: new TextEncoder().encode(content).length,
        isDirectory: false,
        isFile: true,
        modifiedAt: timestamp,
        createdAt: timestamp,
      };
    }
    if (this.dirs.has(path)) {
      return {
        size: 0,
        isDirectory: true,
        isFile: false,
        modifiedAt: new Date(),
        createdAt: new Date(),
      };
    }
    return null;
  }

  reset(): void {
    this.files.clear();
    this.modifiedAt.clear();
    this.dirs.clear();
    this.dirs.add(WORKSPACE);
  }
}

export interface MockContextOverrides {
  ask?: ToolContext['ask'];
  allowedPaths?: string[];
  workspacePath?: string;
}

/**
 * Create a fully-mocked ToolContext.
 * All I/O is routed through the VirtualFS, nothing touches the real filesystem.
 */
export function createMockContext(vfs: VirtualFS, overrides: MockContextOverrides = {}): ToolContext {
  const ws = overrides.workspacePath ?? WORKSPACE;

  return {
    sessionId: 'test-session-123',
    workspacePath: ws,
    workspaceId: 'ws-1',
    abortSignal: new AbortController().signal,
    allowedPaths: overrides.allowedPaths ?? [],

    fs: {
      resolve: (p: string) => {
        if (p.startsWith('/')) return p;
        return `${ws}/${p}`;
      },
      readFile: mock(async (path: string, encoding?: string) => {
        if (encoding) {
          const content = vfs.readFile(path);
          if (content === undefined) throw new Error(`ENOENT: ${path}`);
          return content;
        }
        const content = vfs.readFile(path);
        if (content === undefined) throw new Error(`ENOENT: ${path}`);
        return new TextEncoder().encode(content);
      }) as unknown as ToolContext['fs']['readFile'],
      writeFile: mock(async (path: string, data: string | Uint8Array) => {
        const content = typeof data === 'string' ? data : new TextDecoder().decode(data);
        vfs.writeFile(path, content);
      }),
      appendFile: mock(async (path: string, data: string | Uint8Array) => {
        const content = typeof data === 'string' ? data : new TextDecoder().decode(data);
        const existing = vfs.readFile(path) ?? '';
        vfs.writeFile(path, existing + content);
      }),
      readDir: mock(async (path: string) => {
        const entries = vfs.listDir(path);
        if (entries.length === 0 && !vfs.exists(path)) {
          const err = new Error(`ENOENT: dir ${path}`) as Error & { code: string };
          err.code = 'ENOENT';
          throw err;
        }
        return entries;
      }),
      exists: mock(async (path: string) => vfs.exists(path)),
      stat: mock(async (path: string) => {
        const s = vfs.stat(path);
        if (!s) throw new Error(`ENOENT: ${path}`);
        return s;
      }),
      mkdir: mock(async (path: string) => {
        vfs.addDir(path);
      }),
      rm: mock(async (path: string, options?: { recursive?: boolean }) => {
        vfs.remove(path, options);
      }),
      rename: mock(async (oldPath: string, newPath: string) => {
        if (!vfs.rename(oldPath, newPath)) {
          throw new Error(`ENOENT: no such file or directory, rename '${oldPath}' -> '${newPath}'`);
        }
      }),
      detectLanguage: () => 'text',
      tempDir: '/tmp/jean2/test-session-123',
    },

    llm: {
      generateText: mock(async () => ''),
      generateStructured: mock(async () => ({})) as unknown as ToolContext['llm']['generateStructured'],
    },

    ask: overrides.ask ?? mock(async (_request: unknown) => true) as unknown as ToolContext['ask'],

    env: {
      get: (_key: string) => undefined,
      require: (_key: string) => { throw new Error('Not set'); },
    },

    logger: {
      debug: mock(() => {}),
      info: mock(() => {}),
      warn: mock(() => {}),
      error: mock(() => {}),
    },

    fetch: mock(async (_url: string | URL | Request, _init?: RequestInit): Promise<Response> => {
      return new Response('<html><body>mock page</body></html>', {
        status: 200,
        headers: { 'content-type': 'text/html' },
      });
    }) as unknown as ToolContext['fetch'],

    resolvePath(path: string): string {
      if (path.startsWith('~/') || path === '~') {
        return `/home/user${path.slice(1)}`;
      }
      if (path.startsWith('/')) {
        return path;
      }
      return `${ws}/${path}`;
    },

    isWithinWorkspace(path: string): boolean {
      return path.startsWith(ws);
    },

    isSensitivePath(path: string): boolean {
      const lower = path.toLowerCase();
      return ['.env', '.pem', '.key', '.ssh/', 'id_rsa'].some(p => lower.includes(p));
    },

    isBlockedPath(path: string): boolean {
      return ['/etc/', '/usr/', '/bin/', '/sbin/'].some(p => path.startsWith(p));
    },

    addWorkspacePath: mock(async (_path: string) => true),
    removeWorkspacePath: mock(async (_path: string) => true),
  };
}

/**
 * Extract the first ask() call argument for assertions on permission requests.
 */
export function getAskCall(ctx: ToolContext): PermissionAsk {
  const calls = (ctx.ask as ReturnType<typeof mock>).mock.calls;
  if (calls.length === 0) throw new Error('ask was never called');
  return calls[0][0] as PermissionAsk;
}

/**
 * Get all ask() call arguments.
 */
export function getAllAskCalls(ctx: ToolContext): PermissionAsk[] {
  const calls = (ctx.ask as ReturnType<typeof mock>).mock.calls;
  return calls.map((c: unknown[]) => c[0] as PermissionAsk);
}
