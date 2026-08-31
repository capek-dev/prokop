import type { ToolDefinition, ToolContext, ToolResult } from '@prokopai/sdk';
import type { ShellOutputVisualization } from '@prokopai/sdk';
import { existsSync } from 'fs';
import { join } from 'path';
import {
  createShellPermissionAskStructured,
  createOutsideWorkspaceAsk,
  createWorkspaceModificationAsk,
} from '@prokopai/sdk';
import { analyzeRisk, resolveCommandPath, stripRedundantCd } from './risk';

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
  display: { summary: '{command}' },
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

export async function execute(input: Input, ctx: ToolContext): Promise<ToolResult> {
  try {
    const commandInput = input.command.trim();
    if (!commandInput) {
      return { success: false, error: 'EMPTY_COMMAND: shell tool requires a non-empty command' };
    }

    const resolvedCwd = input.cwd ? ctx.resolvePath(input.cwd) : ctx.workspacePath;
    const resolveFromCwd = (path: string): string => resolveCommandPath(path, resolvedCwd, ctx);
    const effectiveCommand = stripRedundantCd(commandInput, resolvedCwd, resolveFromCwd);
    const risk = analyzeRisk(effectiveCommand, ctx, resolvedCwd);

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

    const cwd = resolvedCwd;

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
