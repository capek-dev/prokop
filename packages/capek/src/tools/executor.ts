import { resolve, extname } from 'path';
import { existsSync, mkdirSync } from 'fs';
import type {
  ToolContext, ToolResult, LoadedTool, FileSystemApi, DirEntry, FileStat, EnvApi, ToolLogger, AskApi, LlmApi,
} from '@capekai/tool';
import type { WorkspaceCapability } from '../workspace/contracts';

function createThrowingStub<T>(name: string): T {
  return new Proxy({}, {
    get() {
      throw new Error(`${name} API not available: this tool requires ${name} capabilities that were not provided`);
    },
  }) as T;
}

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
  workspace: WorkspaceCapability;
  sessionId: string;
  workspaceId?: string;
  toolCallId?: string;
  abortSignal?: AbortSignal;
  /** Milliseconds deadline. Pass `null` (or declare it on the tool
   * definition) to run without a deadline until interrupted. */
  timeout?: number | null;
  createLlmApi?: (defaultModel?: string) => LlmApi;
  createAskApi?: (toolCallId: string) => AskApi;
  broadcastFn?: (event: { type: string; [key: string]: unknown }) => void;
}

function createFileSystemApi(workspace: WorkspaceCapability): FileSystemApi {
  const { tempDir } = workspace;

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
      return workspace.resolvePath(path);
    },

    detectLanguage(path: string): string {
      const ext = extname(path);
      return EXTENSION_LANGUAGE_MAP[ext] || 'text';
    },
  };

  mkdirSync(tempDir, { recursive: true });

  return api;
}

function createEnvApi(workspace: WorkspaceCapability): EnvApi {
  return {
    get(key: string): string | undefined {
      return workspace.getEnvironmentValue(key);
    },
    require(key: string): string {
      const value = workspace.getEnvironmentValue(key);
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

export async function executeTool(options: ExecuteToolOptions): Promise<ToolResult> {
  const {
    tool,
    args,
    workspace,
    sessionId,
    abortSignal,
    // Definition null is authoritative "no deadline"; only an absent
    // definition falls back to the 30s default.
    timeout = tool.definition.timeout === undefined ? 30000 : tool.definition.timeout,
    createLlmApi,
    createAskApi,
  } = options;

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
    workspacePath: workspace.effectiveRoot,
    workspaceId: options.workspaceId,
    abortSignal: toolAbortController.signal,
    allowedPaths: workspace.allowedRoots,
    fs: createFileSystemApi(workspace),
    llm: createLlmApi ? createLlmApi() : createThrowingStub<LlmApi>('llm'),
    ask: createAskApi ? createAskApi(options.toolCallId ?? '') : createThrowingStub<AskApi>('ask'),
    env: createEnvApi(workspace),
    logger: createLogger(tool.definition.name, sessionId),
    fetch: globalThis.fetch.bind(globalThis),
    resolvePath: workspace.resolvePath,
    isWithinWorkspace: workspace.isWithinWorkspace,
    isSensitivePath: workspace.isSensitivePath,
    isBlockedPath: workspace.isBlockedPath,
    addWorkspacePath: workspace.addWorkspacePath,
    removeWorkspacePath: workspace.removeWorkspacePath,
  };

  const executePromise = tool.execute(args, ctx);

  let timeoutId: ReturnType<typeof setTimeout> | undefined;
  // `timeout === null` is the tool's explicit "no deadline": the executor
  // arms no timer and the tool runs until it settles or is interrupted.
  const timeoutPromise = timeout === null
    ? null
    : new Promise<never>((_, reject) => {
        timeoutId = setTimeout(() => {
          toolAbortController.abort(new Error(`Tool execution timed out after ${timeout}ms`));
          reject(new Error(`Tool execution timed out after ${timeout}ms`));
        }, timeout);
      });

  // Abort must settle the race even when the tool ignores its abort signal
  // (for example a tool blocked on ctx.ask()). Promise.race keeps handlers
  // on every promise, so a late rejection after settlement cannot surface as
  // an unhandled rejection.
  const abortPromise = abortSignal
    ? new Promise<never>((_, reject) => {
        if (abortSignal.aborted) {
          reject(new Error('Tool execution interrupted'));
          return;
        }
        abortSignal.addEventListener('abort', () => reject(new Error('Tool execution interrupted')), { once: true });
      })
    : null;

  const racers = timeoutPromise
    ? (abortPromise ? [executePromise, timeoutPromise, abortPromise] : [executePromise, timeoutPromise])
    : (abortPromise ? [executePromise, abortPromise] : [executePromise]);

  try {
    const result = await Promise.race(racers);
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
