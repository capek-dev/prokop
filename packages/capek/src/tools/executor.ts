import { isAbsolute, join, resolve, extname } from 'path';
import { homedir, tmpdir } from 'os';
import { existsSync, mkdirSync } from 'fs';
import type { ToolContext, ToolResult, LoadedTool, FileSystemApi, DirEntry, FileStat, EnvApi, ToolLogger, AskApi, LlmApi } from '@jean2/sdk';
import {
  getJean2EnvValue,
  getWorkspace,
  isPathWithinWorkspace,
  resolvePath as sharedResolvePath,
  updateWorkspace,
} from '../compat/jean2-dependencies';

const BLOCKED_PATHS = [
  '/etc/', '/usr/', '/bin/', '/sbin/', '/boot/', '/dev/',
  '/proc/', '/sys/', '/root/',
];

function createThrowingStub<T>(name: string): T {
  return new Proxy({}, {
    get() {
      throw new Error(`${name} API not available: this tool requires ${name} capabilities that were not provided`);
    },
  }) as T;
}

const SENSITIVE_PATTERNS = [
  '.env', '.pem', '.key', '.ssh/', 'id_rsa', 'id_ed25519',
  '.gitconfig', '.npmrc', 'credentials', 'secrets', 'password',
  '.htpasswd',
];

const EXTENSION_LANGUAGE_MAP: Record<string, string> = {
  '.ts': 'typescript', '.tsx': 'typescript', '.js': 'javascript', '.jsx': 'javascript',
  '.py': 'python', '.rb': 'ruby', '.go': 'go', '.rs': 'rust', '.java': 'java',
  '.kt': 'kotlin', '.swift': 'swift', '.c': 'c', '.cpp': 'cpp', '.h': 'c', '.hpp': 'cpp',
  '.cs': 'csharp', '.php': 'php', '.sh': 'bash', '.bash': 'bash', '.zsh': 'zsh', '.fish': 'fish', '.ps1': 'powershell',
  '.html': 'html', '.css': 'css', '.scss': 'scss', '.less': 'less',
  '.json': 'json', '.yaml': 'yaml', '.yml': 'yaml', '.toml': 'toml',
  '.xml': 'xml', '.sql': 'sql', '.md': 'markdown', '.txt': 'text',
  '.env': 'dotenv', '.gitignore': 'gitignore', '.dockerfile': 'dockerfile',
  '.graphql': 'graphql', '.proto': 'protobuf',
  '.svelte': 'svelte', '.vue': 'vue',
};

export interface ExecuteToolOptions {
  tool: LoadedTool;
  args: Record<string, unknown>;
  workspacePath?: string;
  sessionId: string;
  workspaceId?: string;
  allowedPaths?: string[];
  additionalPaths?: string[];
  toolCallId?: string;
  abortSignal?: AbortSignal;
  timeout?: number;
  createLlmApi?: (defaultModel?: string) => LlmApi;
  createAskApi?: (toolCallId: string) => AskApi;
  broadcastFn?: (event: { type: string; [key: string]: unknown }) => void;
}

function createFileSystemApi(workspacePath: string, sessionId: string): FileSystemApi {
  const tempDir = join(tmpdir(), 'jean2', sessionId);

  const api: FileSystemApi = {
    tempDir,

    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- Overloaded signature requires any for FileSystemApi compatibility
    async readFile(path: string, encoding?: any): Promise<any> {
      const resolved = api.resolve(path);
      const fs = await import('fs/promises');
      if (encoding) {
        return fs.readFile(resolved, encoding);
      }
      const buffer = await fs.readFile(resolved);
      return new Uint8Array(buffer.buffer, buffer.byteOffset, buffer.byteLength);
    },

    async writeFile(path: string, data: string | Uint8Array): Promise<void> {
      const resolved = api.resolve(path);
      const dir = resolve(resolved, '..');
      const fs = await import('fs/promises');
      await fs.mkdir(dir, { recursive: true });
      await fs.writeFile(resolved, data);
    },

    async appendFile(path: string, data: string | Uint8Array): Promise<void> {
      const resolved = api.resolve(path);
      const fs = await import('fs/promises');
      await fs.appendFile(resolved, data);
    },

    async readDir(path: string): Promise<DirEntry[]> {
      const resolved = api.resolve(path);
      const fs = await import('fs/promises');
      const entries = await fs.readdir(resolved, { withFileTypes: true });
      return entries.map(e => ({
        name: e.name,
        isDirectory: e.isDirectory(),
        isFile: e.isFile(),
      }));
    },

    async exists(path: string): Promise<boolean> {
      const resolved = api.resolve(path);
      return existsSync(resolved);
    },

    async stat(path: string): Promise<FileStat> {
      const resolved = api.resolve(path);
      const fs = await import('fs/promises');
      const stat = await fs.stat(resolved);
      return {
        size: stat.size,
        isDirectory: stat.isDirectory(),
        isFile: stat.isFile(),
        modifiedAt: stat.mtime,
        createdAt: stat.birthtime,
      };
    },

    async mkdir(path: string, options?: { recursive?: boolean }): Promise<void> {
      const resolved = api.resolve(path);
      const fs = await import('fs/promises');
      await fs.mkdir(resolved, options);
    },

    async rm(path: string, options?: { recursive?: boolean }): Promise<void> {
      const resolved = api.resolve(path);
      const fs = await import('fs/promises');
      await fs.rm(resolved, options);
    },

    async rename(oldPath: string, newPath: string): Promise<void> {
      const fs = await import('fs/promises');
      await fs.rename(api.resolve(oldPath), api.resolve(newPath));
    },

    resolve(path: string): string {
      if (path.startsWith('~')) {
        return join(homedir(), path.slice(1));
      }
      if (isAbsolute(path)) {
        return resolve(path);
      }
      return resolve(workspacePath, path);
    },

    detectLanguage(path: string): string {
      const ext = extname(path);
      return EXTENSION_LANGUAGE_MAP[ext] || 'text';
    },
  };

  mkdirSync(tempDir, { recursive: true });

  return api;
}

function createPathHelpers(workspacePath: string, additionalPaths: string[] = []) {
  const _allAllowedPaths = [resolve(workspacePath), ...additionalPaths.map(p => resolve(p))];

  function resolvePath(path: string): string {
    return sharedResolvePath(path, workspacePath);
  }

  function isWithinWorkspace(path: string): boolean {
    return isPathWithinWorkspace(path, workspacePath, additionalPaths);
  }

  function isSensitivePath(path: string): boolean {
    const lower = path.toLowerCase();
    return SENSITIVE_PATTERNS.some(p => lower.includes(p));
  }

  function isBlockedPath(path: string): boolean {
    const resolved = resolvePath(path);
    return BLOCKED_PATHS.some(p => resolved.startsWith(p));
  }

  return { resolvePath, isWithinWorkspace, isSensitivePath, isBlockedPath };
}

function createEnvApi(_allowedEnv?: string[]): EnvApi {
  return {
    get(key: string): string | undefined {
      return getJean2EnvValue(key) ?? process.env[key];
    },
    require(key: string): string {
      const value = getJean2EnvValue(key) ?? process.env[key];
      if (!value) {
        throw new Error(`Required environment variable not set: ${key}`);
      }
      return value;
    },
  };
}

function createLogger(toolName: string, sessionId: string): ToolLogger {
  const prefix = `[tool:${toolName}:${sessionId.slice(0, 8)}]`;
  return {
    debug(message: string, data?: Record<string, unknown>): void {
      console.debug(prefix, message, data || '');
    },
    info(message: string, data?: Record<string, unknown>): void {
      console.info(prefix, message, data || '');
    },
    warn(message: string, data?: Record<string, unknown>): void {
      console.warn(prefix, message, data || '');
    },
    error(message: string, data?: Record<string, unknown>): void {
      console.error(prefix, message, data || '');
    },
  };
}

function createWorkspacePathManager(workspaceId: string | undefined) {
  async function addWorkspacePath(path: string): Promise<boolean> {
    if (!workspaceId) return false;
    const workspace = getWorkspace(workspaceId);
    if (!workspace) return false;

    const resolved = resolve(path);
    if (workspace.additionalPaths.includes(resolved)) return true;

    updateWorkspace(workspaceId, {
      additionalPaths: [...workspace.additionalPaths, resolved],
    });
    return true;
  }

  async function removeWorkspacePath(path: string): Promise<boolean> {
    if (!workspaceId) return false;
    const workspace = getWorkspace(workspaceId);
    if (!workspace) return false;

    const resolved = resolve(path);
    if (!workspace.additionalPaths.includes(resolved)) return true;

    updateWorkspace(workspaceId, {
      additionalPaths: workspace.additionalPaths.filter((p: string) => p !== resolved),
    });
    return true;
  }

  return { addWorkspacePath, removeWorkspacePath };
}

export async function executeTool(options: ExecuteToolOptions): Promise<ToolResult> {
  const {
    tool,
    args,
    workspacePath,
    sessionId,
    abortSignal,
    timeout = tool.definition.timeout ?? 30000,
    createLlmApi,
    createAskApi,
  } = options;

  const effectiveWorkspace = workspacePath || process.cwd();
  const pathHelpers = createPathHelpers(effectiveWorkspace, options.additionalPaths);
  const toolAbortController = new AbortController();
  const forwardAbort = (): void => {
    toolAbortController.abort(abortSignal?.reason);
  };

  if (abortSignal?.aborted) {
    forwardAbort();
  } else {
    abortSignal?.addEventListener('abort', forwardAbort, { once: true });
  }

  const ctx: ToolContext = {
    sessionId,
    workspacePath: effectiveWorkspace,
    workspaceId: options.workspaceId,
    abortSignal: toolAbortController.signal,
    allowedPaths: options.allowedPaths ?? [],
    fs: createFileSystemApi(effectiveWorkspace, sessionId),
    llm: createLlmApi ? createLlmApi() : createThrowingStub<LlmApi>('llm'),
    ask: createAskApi ? createAskApi(options.toolCallId ?? '') : createThrowingStub<AskApi>('ask'),
    env: createEnvApi(tool.definition.env),
    logger: createLogger(tool.definition.name, sessionId),
    fetch: globalThis.fetch.bind(globalThis),
    ...pathHelpers,
    ...createWorkspacePathManager(options.workspaceId),
  };

  const executePromise = tool.execute(args, ctx);

  let timeoutId: ReturnType<typeof setTimeout> | undefined;
  const timeoutPromise = new Promise<never>((_, reject) => {
    timeoutId = setTimeout(() => {
      toolAbortController.abort(new Error(`Tool execution timed out after ${timeout}ms`));
      reject(new Error(`Tool execution timed out after ${timeout}ms`));
    }, timeout);
  });

  try {
    const result = await Promise.race([executePromise, timeoutPromise]);
    return result;
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);

    if (abortSignal?.aborted) {
      return {
        success: false,
        error: 'Tool execution interrupted',
      };
    }

    return {
      success: false,
      error: message,
    };
  } finally {
    abortSignal?.removeEventListener('abort', forwardAbort);
    clearTimeout(timeoutId);
  }
}
