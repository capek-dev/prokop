/**
 * Shared shell command risk analysis, used by the shell tool and the
 * terminal tool so both apply identical permission gating.
 */

import type { ToolContext } from '@capekai/tool';
import {
  SHELL_DANGEROUS_COMMANDS,
  SHELL_FILESYSTEM_COMMANDS,
  SHELL_SHELL_OPERATORS,
  getEffectiveShellCommandIdentity,
  type ShellRiskCategory,
} from '@prokopai/sdk';

export interface ParsedCommand {
  baseCommand: string;
  args: string[];
  flags: string[];
}

export function parseCommand(cmd: string): ParsedCommand {
  const parts = cmd.trim().split(/\s+/);
  const baseCommand = parts[0]?.replace(/.*\//, '') || '';
  const args = parts.slice(1);
  const flags = args.filter(arg => arg.startsWith('-'));
  return { baseCommand, args, flags };
}

export function stripRedundantCd(command: string, cwd: string, resolvePath: (p: string) => string): string {
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

export interface RiskAnalysis {
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

export function analyzeRisk(cmd: string, ctx: ToolContext): RiskAnalysis {
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
