/**
 * Shared shell command classification (S11.5a, rebuilt on the permissions v2
 * pipeline in slice 4).
 *
 * One policy definition point for shell operations, consumed identically by
 * the Prokop shell and terminal tools and by the native-harness permission
 * policies (Codex pre-tool hook, Claude pre-tool hook). The end-goal anchor:
 * sensitive files, potentially dangerous or destructive actions, and
 * workspace locking are decided here; per-harness adapters only translate
 * the classification into their own wire formats.
 *
 * classifyShellCommand runs the v2 analyzer and returns the Finding plus the
 * ask to show when the mode ceiling says ask. Decision authority:
 * shouldAutoApproveAsk (domains/permissions/ask.ts) — the ask's legacy risk
 * is derived from the Finding, so severity consumers and decide() agree.
 */

import { homedir } from 'node:os';
import { isAbsolute, resolve } from 'node:path';
import { analyzeCommand } from './command/analyze';
import type { Concern, Finding } from './concerns';
import {
  concernRisk,
  grantScopesForFinding,
  type ConcernsPermissionAsk,
} from './ask';

export interface ShellRiskContext {
  workspacePath: string;
  fs: { tempDir: string };
  resolvePath(path: string): string;
  isWithinWorkspace(path: string): boolean;
  isSensitivePath(path: string): boolean;
  /** Optional workspace-aware resolution the tools may provide. */
  resolvePathFrom?(candidate: string, basePath: string): string;
}

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
  const cdMatch = trimmed.match(/^cd\s+(\S+)\s*&&\s+(.+)/i);
  if (!cdMatch) return command;

  const cdTarget = cdMatch[1];
  const rest = cdMatch[2].trim();
  const resolvedCdTarget = resolvePath(cdTarget);

  if (resolvedCdTarget === cwd) {
    return rest || command;
  }

  return command;
}

export function resolveCommandPath(path: string, executionCwd: string, ctx: ShellRiskContext): string {
  if (ctx.resolvePathFrom) {
    return ctx.resolvePathFrom(path, executionCwd);
  }
  if (path === '~' || path.startsWith('~/') || isAbsolute(path)) {
    return ctx.resolvePath(path);
  }
  return resolve(executionCwd, path);
}

/** The classification result: the analyzer's Finding plus the ask to show
 * when the permission mode requires a human. */
export interface ShellClassification {
  finding: Finding;
  ask: ConcernsPermissionAsk;
}

/**
 * Classify a shell command. Undefined means malformed input (the caller
 * denies); a ShellClassification is returned for every valid command — the
 * CALLER decides auto vs ask (shouldAutoApproveAsk / requiresHumanReview),
 * because the mode lives on the session, not here.
 *
 * `cwdOutsideRoots` lets execution contexts whose working directory already
 * sits outside the allowed roots (the tools' `cwd` parameter) union an escape
 * concern in, so bare commands like `bun test` still escape correctly.
 */
export function classifyShellCommand(
  command: string,
  root: string | readonly string[],
  cwd: string,
  options?: {
    cwdOutsideRoots?: boolean;
    /** Read-only roots (agent directory, uploads); see CommandAnalyzeContext. */
    readRoots?: readonly string[];
    /** Caller-owned containment check for additional workspace roots. */
    isWithinRoots?: (path: string) => boolean;
  },
): ShellClassification | undefined {
  if (typeof command !== 'string' || !command.trim() || command.length > 64 * 1024) return undefined;
  // Native harnesses wrap unified exec in a login shell; inspect the inner command if present.
  const match = command.match(/^\/(?:bin\/)?(?:zsh|bash|sh)\s+-lc\s+'([\s\S]*)'$/);
  const effective = match ? match[1]!.replace(/'\\''/g, "'") : command;

  const roots = typeof root === 'string' ? [root] : root;
  const analyzed = analyzeCommand(effective, {
    roots, readRoots: options?.readRoots, isWithinRoots: options?.isWithinRoots, cwd, home: homedir(),
  });
  const finding: Finding = options?.cwdOutsideRoots && !analyzed.concerns.includes('escape')
    ? {
        ...analyzed,
        concerns: [...analyzed.concerns, 'escape'] as Concern[],
        evidence: [...analyzed.evidence, 'working directory is outside the allowed roots'],
      }
    : analyzed;
  const { baseCommand } = parseCommand(effective);

  const ask: ConcernsPermissionAsk = {
    type: 'permission',
    question: 'Allow this command to run?',
    description: (finding.evidence[0] ?? effective).slice(0, 1000),
    resource: 'shell-command',
    action: 'execute',
    risk: concernRisk(finding),
    concerns: finding.concerns,
    evidence: finding.evidence,
    catastrophic: finding.catastrophic,
    allowedScopes: grantScopesForFinding(finding),
    metadata: { command: effective, cwd, baseCommand, resolvedPaths: finding.resolvedPaths },
  };

  return { finding, ask };
}
