import type { ToolDefinition, ToolContext, ToolResult } from '@prokopai/sdk';
import type { ShellOutputVisualization } from '@prokopai/sdk';
import { existsSync } from 'fs';
import { join } from 'path';
import {
  SHELL_DANGEROUS_COMMANDS,
  SHELL_FILESYSTEM_COMMANDS,
  SHELL_SHELL_OPERATORS,
  createShellPermissionAskStructured,
  createOutsideWorkspaceAsk,
  createWorkspaceModificationAsk,
  getEffectiveShellCommandIdentity,
  type ShellRiskCategory,
} from '@prokopai/sdk';

interface Input {
  command: string;
  cwd?: string;
}

export const definition: ToolDefinition = {
  name: 'shell',
  description: `Execute a shell command in a persistent session.

This tool is for terminal operations (package managers, build tools, etc). DO NOT use it for file operations - use specialized tools instead.

## When to use

- Running package managers (npm, bun, pip)
- Build tools and compilers
- Process management
- Network operations (curl, etc)

## When NOT to use (use specialized tools instead)

- File search: Use glob tool
- Content search: Use grep tool
- Read files: Use read-file tool
- Edit files: Use edit tool
- Write files: Use write-file tool

## Usage

- The cwd parameter sets the working directory
- Commands timeout after 60 seconds by default
- Quote file paths containing spaces with double quotes

## Permission Model

This tool requires explicit permission for:
- Dangerous commands (rm, sudo, curl, etc.)
- Filesystem modifications (mv, cp, mkdir, etc.)
- Commands outside the workspace
- Commands with shell operators (|, >, &&, etc.)`,
  inputSchema: {
    type: 'object',
    properties: {
      command: {
        type: 'string',
        description: 'The shell command to execute',
      },
      cwd: {
        type: 'string',
        description: 'Working directory for the command',
      },
    },
    required: ['command'],
  },
  timeout: 60000,
};

interface ParsedCommand {
  baseCommand: string;
  args: string[];
  flags: string[];
}

function parseCommand(cmd: string): ParsedCommand {
  const parts = cmd.trim().split(/\s+/);
  const baseCommand = parts[0]?.replace(/.*\//, '') || '';
  const args = parts.slice(1);
  const flags = args.filter(arg => arg.startsWith('-'));
  return { baseCommand, args, flags };
}

function stripRedundantCd(command: string, cwd: string, resolvePath: (p: string) => string): string {
  const trimmed = command.trimStart();
  const cdMatch = trimmed.match(/^cd\s+(\S+)\s*&&\s*(.+)/i);
  if (!cdMatch) return command;

  const cdTarget = cdMatch[1];
  const rest = cdMatch[2].trim();
  const resolvedCdTarget = resolvePath(cdTarget);

  if (resolvedCdTarget === cwd) {
    return rest || command;
  }

  return command;
}

const FILE_ORIENTED_COMMANDS = new Set([
  'cat', 'head', 'tail', 'less', 'more', 'wc', 'file', 'stat',
  'ls', 'find', 'grep', 'awk', 'sed', 'sort', 'uniq', 'diff',
  'comm', 'cut', 'tr', 'tee',
  'touch', 'mkdir',
  'rm', 'rmdir', 'del', 'erase',
  'mv', 'cp', 'ln',
]);

function isLikelyUrl(arg: string): boolean {
  return /^[a-z][a-z0-9+.-]*:\/\//i.test(arg);
}

function extractPathArguments(cmd: string): string[] {
  const paths: string[] = [];
  const parts = cmd.split(/\s+/);
  const baseCommand = parts[0]?.replace(/.*\//, '') || '';
  const isFileCommand = FILE_ORIENTED_COMMANDS.has(baseCommand);

  // For file-oriented commands, all non-flag args are path candidates
  if (isFileCommand) {
    for (let i = 1; i < parts.length; i++) {
      const part = parts[i];
      if (!part) continue;
      if (part.startsWith('-')) continue;
      if (isLikelyUrl(part)) continue;
      paths.push(part);
    }
    return paths;
  }

  // For non-file commands, only recognize explicit path prefixes
  for (let i = 1; i < parts.length; i++) {
    const part = parts[i];
    if (!part) continue;
    if (part.startsWith('-')) continue;

    const isUnixPath = part.startsWith('/') || part.startsWith('~') || part.startsWith('./') || part.startsWith('../');
    const isWindowsPath = /^[A-Za-z]:[\\]/.test(part) || /^\\\\/.test(part);

    if (isUnixPath || isWindowsPath) {
      paths.push(part);
    }
  }

  return paths;
}

interface RiskAnalysis {
  requiresAsk: boolean;
  riskCategory: ShellRiskCategory;
  risk: 'low' | 'medium' | 'high';
  reason: string;
  hasOperators: boolean;
  workspaceBound: boolean;
  resolvedPaths: string[];
  baseCommand: string;
  flags: string[];
}

function analyzeRisk(cmd: string, ctx: ToolContext): RiskAnalysis {
  const effectiveCommand = getEffectiveShellCommandIdentity(cmd);
  const { flags } = parseCommand(cmd);
  const lowerEffective = effectiveCommand.toLowerCase();
  const paths = extractPathArguments(cmd);
  const resolvedPaths: string[] = [];
  let workspaceBound = true;

  for (const p of paths) {
    const resolved = ctx.resolvePath(p);
    resolvedPaths.push(resolved);
    if (!ctx.isWithinWorkspace(resolved) && !resolved.startsWith(ctx.fs.tempDir)) {
      workspaceBound = false;
    }
  }

  const hasOperators = SHELL_SHELL_OPERATORS.some(op => cmd.includes(op));

  const isDangerous = SHELL_DANGEROUS_COMMANDS.some(dangerous =>
    effectiveCommand === dangerous || lowerEffective.startsWith(dangerous + ' '),
  );

  if (isDangerous) {
    let riskCategory: ShellRiskCategory = 'side-effect';

    if (['rm', 'rmdir', 'del', 'erase', 'dd', 'mkfs', 'format'].includes(effectiveCommand)) {
      riskCategory = 'destructive';
    } else if (['curl', 'wget', 'nc', 'netcat'].includes(effectiveCommand)) {
      riskCategory = 'network';
    } else if (['sudo', 'su', 'doas', 'chmod', 'chown', 'shutdown', 'reboot', 'halt', 'iptables'].includes(effectiveCommand)) {
      riskCategory = 'destructive';
    }

    return {
      requiresAsk: true,
      riskCategory,
      risk: 'high',
      reason: `contains dangerous command "${effectiveCommand}"`,
      hasOperators,
      workspaceBound,
      resolvedPaths,
      baseCommand: effectiveCommand,
      flags,
    };
  }

  const isFilesystem = SHELL_FILESYSTEM_COMMANDS.some(fs => lowerEffective === fs || lowerEffective.startsWith(fs + ' '));

  if (isFilesystem) {
    return {
      requiresAsk: true,
      riskCategory: 'workspace-modification',
      risk: workspaceBound ? 'medium' : 'high',
      reason: `contains filesystem command "${effectiveCommand}"`,
      hasOperators,
      workspaceBound,
      resolvedPaths,
      baseCommand: effectiveCommand,
      flags,
    };
  }

  if (hasOperators) {
    return {
      requiresAsk: true,
      riskCategory: 'side-effect',
      risk: 'medium',
      reason: 'contains shell operators (|, >, &&, etc.)',
      hasOperators,
      workspaceBound,
      resolvedPaths,
      baseCommand: effectiveCommand,
      flags,
    };
  }

  if (!workspaceBound) {
    return {
      requiresAsk: true,
      riskCategory: 'outside-workspace',
      risk: 'medium',
      reason: 'references paths outside the workspace',
      hasOperators: false,
      workspaceBound,
      resolvedPaths,
      baseCommand: effectiveCommand,
      flags,
    };
  }

  const args = parseCommand(cmd).args;
  const nonFlagArgs = args.filter(a => !a.startsWith('-'));
  const hasSensitivePath = nonFlagArgs.some(a => ctx.isSensitivePath(a));

  if (hasSensitivePath) {
    return {
      requiresAsk: true,
      riskCategory: 'sensitive-files',
      risk: 'high',
      reason: 'references sensitive files (.env, .key, .pem, etc.)',
      hasOperators,
      workspaceBound: true,
      resolvedPaths,
      baseCommand: effectiveCommand,
      flags,
    };
  }

  return {
    requiresAsk: false,
    riskCategory: 'side-effect',
    risk: 'low',
    reason: '',
    hasOperators: false,
    workspaceBound: true,
    resolvedPaths: [],
    baseCommand: effectiveCommand,
    flags,
  };
}

export async function execute(input: Input, ctx: ToolContext): Promise<ToolResult> {
  try {
    const commandInput = input.command.trim();
    if (!commandInput) {
      return { success: false, error: 'EMPTY_COMMAND: shell tool requires a non-empty command' };
    }

    const resolvedCwd = input.cwd ? ctx.resolvePath(input.cwd) : ctx.workspacePath;
    const effectiveCommand = stripRedundantCd(commandInput, resolvedCwd, ctx.resolvePath);
    const risk = analyzeRisk(effectiveCommand, ctx);

    const outsideWorkspaceCwd = input.cwd && !ctx.isWithinWorkspace(resolvedCwd);

    if (risk.requiresAsk) {
      let permAsk;

      if (outsideWorkspaceCwd) {
        permAsk = createOutsideWorkspaceAsk({
          command: effectiveCommand,
          cwd: resolvedCwd,
          resolvedPaths: risk.resolvedPaths,
          hasOperators: risk.hasOperators,
        });
      } else if (risk.riskCategory === 'outside-workspace') {
        permAsk = createShellPermissionAskStructured({
          command: effectiveCommand,
          baseCommand: risk.baseCommand,
          flags: risk.flags,
          risk: risk.risk,
          riskCategory: risk.riskCategory,
          reason: risk.reason,
          resolvedPaths: risk.resolvedPaths,
          workspaceBound: risk.workspaceBound,
          hasOperators: risk.hasOperators,
        });
      } else if (risk.riskCategory === 'workspace-modification') {
        permAsk = createWorkspaceModificationAsk({
          command: effectiveCommand,
          baseCommand: risk.baseCommand,
          resolvedPaths: risk.resolvedPaths,
          hasOperators: risk.hasOperators,
        });
      } else {
        permAsk = createShellPermissionAskStructured({
          command: effectiveCommand,
          baseCommand: risk.baseCommand,
          flags: risk.flags,
          risk: risk.risk,
          riskCategory: risk.riskCategory,
          reason: risk.reason,
          resolvedPaths: risk.resolvedPaths,
          workspaceBound: risk.workspaceBound,
          hasOperators: risk.hasOperators,
        });
      }

      const approved = await ctx.ask(permAsk);
      if (!approved) return { success: false, error: 'USER_REJECTION' };
    }

    const cwd = input.cwd ? ctx.fs.resolve(input.cwd) : ctx.workspacePath;

    const platform = await detectPlatform();
    const shell = platform === 'windows'
      ? ['cmd.exe', '/d', '/s', '/c', effectiveCommand]
      : ['sh', '-c', effectiveCommand];

    const proc = Bun.spawn(shell, {
      cwd,
      stdout: 'pipe',
      stderr: 'pipe',
      ...(platform === 'windows' ? { windowsHide: true } : {}),
    } as Record<string, unknown>);

    const killOnAbort = (): void => {
      proc.kill();
    };

    if (ctx.abortSignal.aborted) {
      proc.kill();
    } else {
      ctx.abortSignal.addEventListener('abort', killOnAbort, { once: true });
    }

    const [stdout, stderr, exitCode] = await Promise.all([
      readProcessOutput(proc.stdout),
      readProcessOutput(proc.stderr),
      proc.exited,
    ]);

    ctx.abortSignal.removeEventListener('abort', killOnAbort);

    if (ctx.abortSignal.aborted) {
      return { success: false, error: 'Tool execution interrupted' };
    }

    const visualization: ShellOutputVisualization = {
      type: 'shell-output',
      command: effectiveCommand.substring(0, 100),
      stdout: stdout || undefined,
      stderr: stderr || undefined,
      exitCode,
    };

    const success = exitCode === 0;
    return {
      success,
      result: { stdout, stderr, exitCode },
      visualization,
      ...(!success && { error: `Command exited with code ${exitCode}${stderr ? ': ' + stderr.split('\n')[0] : ''}` }),
    };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return { success: false, error: message };
  }
}

async function readProcessOutput(output: unknown): Promise<string> {
  if (!output) return '';
  if (output instanceof Uint8Array) return Buffer.from(output).toString();
  if (output instanceof ReadableStream) return new Response(output).text();
  if (output instanceof Blob) return output.text();
  if (typeof output === 'object' && 'text' in output && typeof output.text === 'function') {
    return output.text() as Promise<string>;
  }
  return String(output);
}

async function detectPlatform(): Promise<'windows' | 'unix'> {
  if (typeof process !== 'undefined' && process.platform) {
    return process.platform === 'win32' ? 'windows' : 'unix';
  }
  return 'unix';
}

function _resolveCmdExe(): string {
  // Resolve cmd.exe to an absolute path so spawning does not depend on PATH
  // being intact in the current environment. The server may hold a stale or
  // stripped PATH snapshot (e.g. daemon-launched with a filtered env), in
  // which case a bare 'cmd.exe' would fail with ENOENT.
  if (process.env.ComSpec && existsSync(process.env.ComSpec)) {
    return process.env.ComSpec;
  }
  if (process.env.SystemRoot) {
    const candidate = join(process.env.SystemRoot, 'System32', 'cmd.exe');
    if (existsSync(candidate)) return candidate;
  }
  const fallback = join('C:\\Windows', 'System32', 'cmd.exe');
  if (existsSync(fallback)) return fallback;
  // Last resort: let the OS resolve it via PATH (may fail, but no better option)
  return 'cmd.exe';
}
