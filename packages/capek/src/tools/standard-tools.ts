import { createHash } from 'node:crypto';
import { basename, dirname, resolve, sep } from 'node:path';
import ignore from 'ignore';
import picomatch from 'picomatch';
import type { LoadedTool, ToolContext, ToolDefinition, ToolResult } from '@capekai/tool';
import {
  SHELL_FILESYSTEM_COMMANDS, SHELL_SHELL_OPERATORS, SHELL_DANGEROUS_COMMANDS,
} from '@capekai/tool';
import { createFilePermissionAsk, getEffectiveShellCommandIdentity } from '@capekai/types';
import { retrieveToolOutputStandardTool } from '../tool-output/policy';

const STANDARD_TOOL_PATH = 'builtin:@capekai/core';
const SKIP_NAMES = new Set(['node_modules', '.git', 'dist', 'build', 'target', 'vendor', '.venv', 'coverage']);

function tool(
  definition: ToolDefinition,
  execute: (input: Record<string, unknown>, context: ToolContext) => Promise<ToolResult>,
): LoadedTool {
  return { definition, execute, path: STANDARD_TOOL_PATH };
}

function schema(
  name: string,
  description: string,
  properties: Record<string, unknown>,
  required: string[],
  timeout = 30_000,
  capabilities?: ToolDefinition['capabilities'],
): ToolDefinition {
  return {
    name,
    description,
    inputSchema: { type: 'object', properties, required },
    timeout,
    ...(capabilities ? { capabilities } : {}),
  };
}

function isWithinPath(path: string, root: string): boolean {
  const resolvedPath = resolve(path);
  const resolvedRoot = resolve(root);
  return resolvedPath === resolvedRoot || resolvedPath.startsWith(`${resolvedRoot}${sep}`);
}

async function authorizeFile(
  context: ToolContext,
  path: string,
  operation: 'read' | 'write' | 'edit',
): Promise<boolean> {
  if (context.isBlockedPath(path)) return false;
  const scopedTempRead = operation === 'read' && isWithinPath(path, context.fs.tempDir);
  const outsideWorkspace = !context.isWithinWorkspace(path) && !scopedTempRead;
  const sensitive = context.isSensitivePath(path);
  if (outsideWorkspace) {
    const approved = await context.ask(createFilePermissionAsk({
      path,
      operation,
      risk: 'medium',
      isOutsideWorkspace: true,
    }));
    if (!approved) return false;
  }
  if (sensitive) {
    const approved = await context.ask(createFilePermissionAsk({
      path,
      operation,
      risk: 'medium',
      isSensitiveFile: true,
      reason: 'This file may contain credentials or secrets.',
    }));
    if (!approved) return false;
  }
  return true;
}

function success(result: unknown): ToolResult {
  return { success: true, result };
}

function failure(error: string): ToolResult {
  return { success: false, error };
}

function revision(content: string): string {
  return `sha256:${createHash('sha256').update(content).digest('hex')}`;
}

const readFile = tool(
  schema(
    'read-file',
    'Read a file or directory. Regular files include stable revision and pagination metadata.',
    {
      path: { type: 'string' },
      offset: { type: 'number', minimum: 1 },
      limit: { type: 'number', minimum: 1 },
    },
    ['path'],
  ),
  async (input, context) => {
    const path = context.resolvePath(String(input.path));
    if (!(await authorizeFile(context, path, 'read'))) return failure('USER_REJECTION');
    try {
      const stat = await context.fs.stat(path);
      if (stat.isDirectory) {
        const entries = (await context.fs.readDir(path))
          .map((entry) => `${entry.name}${entry.isDirectory ? '/' : ''}`)
          .sort();
        return success({ content: entries.join('\n'), entries });
      }
      const content = await context.fs.readFile(path, 'utf-8');
      if (content.includes('\0')) return failure(`Cannot read binary file: ${path}`);
      const lines = content.split('\n');
      const offset = Number(input.offset ?? 1);
      const limit = Number(input.limit ?? 2000);
      if (!Number.isInteger(offset) || offset < 1 || !Number.isInteger(limit) || limit < 1) {
        return failure('offset and limit must be positive integers');
      }
      const selected = lines.slice(offset - 1, offset - 1 + limit);
      const numbered = selected.map((line, index) => `${offset + index}: ${line}`).join('\n');
      return success({
        content: numbered,
        revision: revision(content),
        totalLines: lines.length,
        offset,
        linesReturned: selected.length,
        truncated: offset - 1 + selected.length < lines.length,
      });
    } catch (error: unknown) {
      return failure(error instanceof Error ? error.message : String(error));
    }
  },
);

const writeFile = tool(
  schema(
    'write-file',
    'Write content to a file, creating it or replacing its contents.',
    { path: { type: 'string' }, content: { type: 'string' } },
    ['path', 'content'],
  ),
  async (input, context) => {
    const path = context.resolvePath(String(input.path));
    if (!(await authorizeFile(context, path, 'write'))) return failure('USER_REJECTION');
    try {
      const content = String(input.content);
      await context.fs.writeFile(path, content);
      return success({ path, bytes: new TextEncoder().encode(content).length });
    } catch (error: unknown) {
      return failure(error instanceof Error ? error.message : String(error));
    }
  },
);

const edit = tool(
  schema(
    'edit',
    'Replace one unique text block in an existing file.',
    {
      path: { type: 'string' },
      oldString: { type: 'string' },
      newString: { type: 'string' },
    },
    ['path', 'oldString', 'newString'],
  ),
  async (input, context) => {
    const path = context.resolvePath(String(input.path));
    if (!(await authorizeFile(context, path, 'edit'))) return failure('USER_REJECTION');
    const oldString = String(input.oldString);
    if (!oldString) return failure('oldString must not be empty');
    try {
      const content = await context.fs.readFile(path, 'utf-8');
      const first = content.indexOf(oldString);
      if (first < 0) return failure('oldString was not found');
      if (content.indexOf(oldString, first + oldString.length) >= 0) return failure('oldString is ambiguous');
      const updated = content.slice(0, first) + String(input.newString) + content.slice(first + oldString.length);
      await context.fs.writeFile(path, updated);
      return success({ path, replacements: 1 });
    } catch (error: unknown) {
      return failure(error instanceof Error ? error.message : String(error));
    }
  },
);

interface RangeEdit {
  startLine: number;
  endLine: number;
  newString: string;
}

const editRange = tool(
  schema(
    'edit-range',
    'Apply revision-checked, non-overlapping line range edits atomically.',
    {
      path: { type: 'string' },
      revision: { type: 'string' },
      edits: {
        type: 'array',
        minItems: 1,
        items: {
          type: 'object',
          properties: {
            startLine: { type: 'integer', minimum: 1 },
            endLine: { type: 'integer', minimum: 1 },
            newString: { type: 'string' },
          },
          required: ['startLine', 'endLine', 'newString'],
        },
      },
    },
    ['path', 'revision', 'edits'],
    180_000,
  ),
  async (input, context) => {
    const path = context.resolvePath(String(input.path));
    if (!(await authorizeFile(context, path, 'edit'))) return failure('USER_REJECTION');
    try {
      const content = await context.fs.readFile(path, 'utf-8');
      const currentRevision = revision(content);
      if (currentRevision !== input.revision) return failure('STALE_REVISION');
      const edits = [...(input.edits as RangeEdit[])].sort((left, right) => right.startLine - left.startLine);
      const ascending = [...edits].sort((left, right) => left.startLine - right.startLine);
      for (let index = 0; index < ascending.length; index++) {
        const item = ascending[index];
        if (!Number.isInteger(item.startLine) || !Number.isInteger(item.endLine) || item.startLine < 1 || item.endLine < item.startLine) {
          return failure(`Invalid range at edit ${index}`);
        }
        if (index > 0 && item.startLine <= ascending[index - 1].endLine) return failure('Edit ranges overlap');
      }
      const lines = content.split('\n');
      for (const item of edits) {
        if (item.endLine > lines.length) return failure(`Range ends after line ${lines.length}`);
        lines.splice(item.startLine - 1, item.endLine - item.startLine + 1, ...item.newString.split('\n'));
      }
      const updated = lines.join('\n');
      await context.fs.writeFile(path, updated);
      return success({ path, previousRevision: currentRevision, revision: revision(updated), editsApplied: edits.length });
    } catch (error: unknown) {
      return failure(error instanceof Error ? error.message : String(error));
    }
  },
);

interface PatchOperation {
  kind: 'add' | 'delete' | 'update';
  path: string;
  lines: string[];
}

function parsePatch(patch: string): PatchOperation[] {
  const lines = patch.replaceAll('\r\n', '\n').split('\n');
  if (lines[0] !== '*** Begin Patch') throw new Error('Patch must start with *** Begin Patch');
  const operations: PatchOperation[] = [];
  let current: PatchOperation | null = null;
  for (const line of lines.slice(1)) {
    if (line === '*** End Patch') break;
    const header = line.match(/^\*\*\* (Add|Delete|Update) File: (.+)$/);
    if (header) {
      current = { kind: header[1].toLowerCase() as PatchOperation['kind'], path: header[2], lines: [] };
      operations.push(current);
      continue;
    }
    if (current) current.lines.push(line);
  }
  if (operations.length === 0) throw new Error('Patch contains no file operations');
  return operations;
}

const applyPatch = tool(
  schema(
    'apply-patch',
    'Apply a Begin Patch document containing add, update, or delete file operations.',
    { patch: { type: 'string' } },
    ['patch'],
    180_000,
  ),
  async (input, context) => {
    try {
      const operations = parsePatch(String(input.patch));
      const planned: Array<{ operation: PatchOperation; path: string; content?: string }> = [];
      for (const operation of operations) {
        const path = context.resolvePath(operation.path);
        if (!(await authorizeFile(context, path, 'edit'))) return failure('USER_REJECTION');
        if (operation.kind === 'add') {
          planned.push({ operation, path, content: operation.lines.map((line) => line.startsWith('+') ? line.slice(1) : line).join('\n') });
        } else if (operation.kind === 'delete') {
          planned.push({ operation, path });
        } else {
          const original = await context.fs.readFile(path, 'utf-8');
          const oldLines = operation.lines.filter((line) => line.startsWith('-')).map((line) => line.slice(1));
          const newLines = operation.lines.filter((line) => line.startsWith('+')).map((line) => line.slice(1));
          const oldBlock = oldLines.join('\n');
          if (!oldBlock || original.indexOf(oldBlock) < 0 || original.indexOf(oldBlock) !== original.lastIndexOf(oldBlock)) {
            return failure(`Patch update for ${operation.path} did not match one unique block`);
          }
          planned.push({ operation, path, content: original.replace(oldBlock, newLines.join('\n')) });
        }
      }
      for (const item of planned) {
        if (item.operation.kind === 'delete') await context.fs.rm(item.path);
        else await context.fs.writeFile(item.path, item.content ?? '');
      }
      return success({
        added: planned.filter((item) => item.operation.kind === 'add').map((item) => item.operation.path),
        modified: planned.filter((item) => item.operation.kind === 'update').map((item) => item.operation.path),
        deleted: planned.filter((item) => item.operation.kind === 'delete').map((item) => item.operation.path),
      });
    } catch (error: unknown) {
      return failure(error instanceof Error ? error.message : String(error));
    }
  },
);

async function walk(
  context: ToolContext,
  root: string,
  callback: (path: string, relativePath: string) => Promise<boolean | void>,
  relativePath = '',
  enterDirectory: (relativePath: string) => boolean = () => true,
): Promise<boolean> {
  for (const entry of await context.fs.readDir(root)) {
    if (SKIP_NAMES.has(entry.name)) continue;
    const path = `${root}/${entry.name}`;
    const relative = relativePath ? `${relativePath}/${entry.name}` : entry.name;
    if (entry.isDirectory) {
      if (enterDirectory(relative) && await walk(context, path, callback, relative, enterDirectory)) return true;
    } else if (entry.isFile && await callback(path, relative)) {
      return true;
    }
  }
  return false;
}

const ls = tool(
  schema(
    'ls',
    'List workspace directory contents recursively with common generated directories excluded.',
    {
      path: { type: 'string' },
      ignore: { type: 'array', items: { type: 'string' } },
      showHidden: { type: 'boolean' },
    },
    [],
  ),
  async (input, context) => {
    const root = context.resolvePath(String(input.path ?? context.workspacePath));
    if (!(await authorizeFile(context, root, 'read'))) return failure('USER_REJECTION');
    const ignored = new Set((input.ignore as string[] | undefined) ?? []);
    const files: string[] = [];
    try {
      await walk(context, root, async (_path, relative) => {
        if (ignored.has(relative) || (!input.showHidden && relative.split('/').some((part) => part.startsWith('.')))) return false;
        files.push(relative);
        return files.length >= 100;
      }, '', (relative) => !ignored.has(relative)
        && (Boolean(input.showHidden) || !relative.split('/').some((part) => part.startsWith('.'))));
      return success({ content: files.sort().join('\n'), files, truncated: files.length >= 100 });
    } catch (error: unknown) {
      return failure(error instanceof Error ? error.message : String(error));
    }
  },
);

const glob = tool(
  schema(
    'glob',
    'Find files matching a Bash-style glob pattern.',
    {
      pattern: { type: 'string' },
      path: { type: 'string' },
      ignore: { type: 'array', items: { type: 'string' } },
    },
    ['pattern'],
  ),
  async (input, context) => {
    const root = context.resolvePath(String(input.path ?? context.workspacePath));
    if (!(await authorizeFile(context, root, 'read'))) return failure('USER_REJECTION');
    const matches = picomatch(String(input.pattern), { dot: true });
    const ignored = input.ignore ? picomatch(input.ignore as string[], { dot: true }) : () => false;
    const files: string[] = [];
    try {
      await walk(context, root, async (_path, relative) => {
        if (matches(relative) && !ignored(relative)) files.push(relative);
      });
      return success({ files: files.sort() });
    } catch (error: unknown) {
      return failure(error instanceof Error ? error.message : String(error));
    }
  },
);

const grep = tool(
  schema(
    'grep',
    'Search file contents with a regular expression and return file, line, and content matches.',
    {
      pattern: { type: 'string' },
      path: { type: 'string' },
      include: { type: 'string' },
      ignore: { type: 'array', items: { type: 'string' } },
    },
    ['pattern'],
  ),
  async (input, context) => {
    const root = context.resolvePath(String(input.path ?? context.workspacePath));
    if (!(await authorizeFile(context, root, 'read'))) return failure('USER_REJECTION');
    let expression: RegExp;
    try {
      expression = new RegExp(String(input.pattern));
    } catch (error: unknown) {
      return failure(error instanceof Error ? error.message : String(error));
    }
    const include = input.include ? picomatch(String(input.include), { dot: true }) : () => true;
    const ignored = input.ignore ? picomatch(input.ignore as string[], { dot: true }) : () => false;
    const gitignore = ignore();
    const matches: Array<{ file: string; line: number; content: string }> = [];
    const search = async (path: string, relative: string): Promise<void> => {
      if (!include(relative) || ignored(relative) || gitignore.ignores(relative)) return;
      try {
        const content = await context.fs.readFile(path, 'utf-8');
        if (content.includes('\0')) return;
        for (const [index, line] of content.split('\n').entries()) {
          expression.lastIndex = 0;
          if (expression.test(line)) matches.push({ file: relative, line: index + 1, content: line.trimEnd() });
          if (matches.length >= 5000) return;
        }
      } catch {
        return;
      }
    };
    try {
      const stat = await context.fs.stat(root);
      const gitignoreRoot = stat.isDirectory ? root : dirname(root);
      try {
        gitignore.add(await context.fs.readFile(`${gitignoreRoot}/.gitignore`, 'utf-8'));
      } catch {
        gitignore.add('');
      }
      if (stat.isDirectory) await walk(context, root, search);
      else await search(root, basename(root));
      return success({ matches, truncated: matches.length >= 5000 });
    } catch (error: unknown) {
      return failure(error instanceof Error ? error.message : String(error));
    }
  },
);

const shell = tool(
  schema(
    'shell',
    'Execute a shell command in the workspace. Commands with side effects, shell operators, or network access require permission.',
    { command: { type: 'string' }, cwd: { type: 'string' } },
    ['command'],
    60_000,
  ),
  async (input, context) => {
    const command = String(input.command);
    const cwd = context.resolvePath(String(input.cwd ?? context.workspacePath));
    const identity = getEffectiveShellCommandIdentity(command).toLowerCase();
    const matchesCommand = (candidate: string): boolean =>
      identity === candidate || identity.startsWith(`${candidate} `);
    const unsafe = SHELL_DANGEROUS_COMMANDS.some(matchesCommand)
      || SHELL_FILESYSTEM_COMMANDS.some(matchesCommand)
      || SHELL_SHELL_OPERATORS.some((operator) => command.includes(operator))
      || command.includes('\n')
      || !context.isWithinWorkspace(cwd)
      || command.split(/\s+/).some((argument) => context.isSensitivePath(argument));
    if (unsafe) {
      const approved = await context.ask({
        target: 'permission',
        type: 'permission',
        question: `Run shell command: ${command}`,
        risk: 'high',
        resource: 'shell-command',
        action: 'execute',
        patterns: [command],
        metadata: { baseCommand: command.trim().split(/\s+/)[0] ?? command },
      });
      if (!approved) return failure('USER_REJECTION');
    }
    if (context.abortSignal.aborted) return failure('Tool execution interrupted');
    let child: ReturnType<typeof Bun.spawn> | null = null;
    const abort = (): void => {
      if (!child) return;
      if (globalThis.process.platform !== 'win32') {
        try {
          globalThis.process.kill(-child.pid, 'SIGTERM');
          return;
        } catch {
          child.kill();
          return;
        }
      }
      child.kill();
    };
    context.abortSignal.addEventListener('abort', abort, { once: true });
    try {
      child = Bun.spawn({
        cmd: globalThis.process.platform === 'win32' ? ['cmd.exe', '/d', '/s', '/c', command] : ['/bin/sh', '-lc', command],
        cwd,
        stdout: 'pipe',
        stderr: 'pipe',
        env: { ...globalThis.process.env },
        detached: globalThis.process.platform !== 'win32',
      });
      if (context.abortSignal.aborted) abort();
      const [stdout, stderr, exitCode] = await Promise.all([
        new Response(child.stdout as ReadableStream<Uint8Array>).text(),
        new Response(child.stderr as ReadableStream<Uint8Array>).text(),
        child.exited,
      ]);
      if (context.abortSignal.aborted) return failure('Tool execution interrupted');
      const output = { stdout, stderr, exitCode };
      if (exitCode !== 0) {
        return {
          success: false,
          error: `Shell command failed with exit code ${exitCode}${stderr.trim() ? `: ${stderr.trim()}` : ''}`,
          result: output,
        };
      }
      return success(output);
    } catch (error: unknown) {
      if (context.abortSignal.aborted) return failure('Tool execution interrupted');
      return failure(error instanceof Error ? error.message : String(error));
    } finally {
      context.abortSignal.removeEventListener('abort', abort);
    }
  },
);

const question = tool(
  schema(
    'question',
    'Ask the user one or more structured questions.',
    {
      title: { type: 'string' },
      description: { type: 'string' },
      questions: { type: 'array', items: { type: 'object' }, minItems: 1 },
    },
    ['title', 'questions'],
    300_000,
    ['interactive-user-input'],
  ),
  async (input, context) => {
    try {
      const response = await context.ask({
        target: 'human',
        type: 'form',
        question: String(input.title),
        description: input.description as string | undefined,
        questions: input.questions as never,
      });
      return success(response);
    } catch (error: unknown) {
      return failure(error instanceof Error ? error.message : String(error));
    }
  },
);

const standardTools = new Map([
  readFile,
  writeFile,
  edit,
  editRange,
  applyPatch,
  ls,
  glob,
  grep,
  shell,
  question,
  retrieveToolOutputStandardTool,
].map((entry) => [entry.definition.name, entry]));

export const STANDARD_TOOL_NAMES = [...standardTools.keys()];

export function getStandardTool(name: string): LoadedTool | null {
  return standardTools.get(name) ?? null;
}

export function listStandardTools(): LoadedTool[] {
  return [...standardTools.values()];
}
