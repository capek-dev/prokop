/**
 * Command analysis pipeline (permissions v2, slice 3).
 *
 * Turns a shell command string into a Finding: pure facts (concerns,
 * catastrophic, evidence, resolved paths) with no policy. decide() in
 * ../concerns.ts is the only place facts become a decision.
 *
 * Pipeline order (docs/plans/unified-permissions.md):
 *   1. unwrap login-shell wrappers (`/bin/zsh -lc '...'`)
 *   2. quote/substitution-aware tokenization, split into `&&`/`;`/`|` segments
 *   3. token screen on *active* text: bare words, command-substitution bodies,
 *      and quoted strings passed to command-executing bases (sh -c "rm ...").
 *      Single-quoted content of ordinary commands is inert (a git commit
 *      message may say "rm file" without escalating).
 *   4. per-segment analysis with cwd tracking (`cd X && cmd`):
 *      destructive flag rules, catastrophic target confirmation (fail closed
 *      on unresolvable targets), sensitive matching, escape vs allowed roots,
 *      opaque for constructs we cannot see through. Command substitutions and
 *      `sudo`/`doas` prefixes are analyzed recursively and their concerns
 *      union into the finding.
 *
 * Fail-closed defaults: an operand that cannot be resolved (`$VAR`, globs
 * beyond a static prefix) makes a destructive command catastrophic, because
 * full mode auto-runs everything except catastrophic findings.
 */

import { lstatSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { isAbsolute, join, resolve } from 'node:path';
import { effectivePath, isWithinRoot } from '../paths';
import type { Concern, Finding } from '../concerns';
import { unwrapShellCommand } from './shell-wrapper';
import {
  CATASTROPHIC_BASES,
  containsScreenedToken,
  isProtectedTarget,
  isSensitiveFilename,
  matchDestructiveRule,
  type InvocationShape,
} from './tables';

export interface CommandAnalyzeContext {
  /** Allowed roots (session root, workspace `.prokopai`, `~/.prokopai`, temp). */
  readonly roots: readonly string[];
  /** Read-only roots (agent directory, uploads): operands of read-only
   * commands and `<` redirects may sit here without escaping. */
  readonly readRoots?: readonly string[];
  /** Extra containment check the caller owns (the Prokop tool context knows
   * its additional workspace roots only as a predicate). */
  readonly isWithinRoots?: (path: string) => boolean;
  /** Directory the command runs in. */
  readonly cwd: string;
  /** Current user's home, for `~` expansion and protected-target checks. */
  readonly home: string;
}

// ── Tokenization ────────────────────────────────────────────────────────────

type TokenKind = 'word' | 'single' | 'double' | 'substitution' | 'operator';

interface Token {
  kind: TokenKind;
  text: string;
  inner: string;
  joined?: boolean;
}

const OPERATOR_STARTS = new Set(['&', '|', ';', '<', '>']);
const SEGMENT_OPERATORS = new Set(['&&', '||', '|', ';', '&']);

function tokenize(input: string): Token[] {
  const tokens: Token[] = [];
  const n = input.length;
  let i = 0;
  const add = (token: Token): void => {
    const previous = tokens.at(-1);
    tokens.push({ ...token, joined: !!previous && previous.kind !== 'operator'
      && token.kind !== 'operator' && i > 0 && !/\s/.test(input[i - 1]!) });
  };
  while (i < n) {
    const ch = input[i]!;
    if (/\s/.test(ch)) {
      i += 1;
      continue;
    }
    if (OPERATOR_STARTS.has(ch)) {
      const two = input.slice(i, i + 2);
      const text = ['&&', '||', '>>', '>&', '<&', '&>'].includes(two) ? two : ch;
      add({ kind: 'operator', text, inner: text });
      i += text.length;
      continue;
    }
    if (ch === "'") {
      const end = input.indexOf("'", i + 1);
      const stop = end === -1 ? n : end;
      add({ kind: 'single', text: input.slice(i, stop + 1), inner: input.slice(i + 1, stop) });
      i = stop + 1;
      continue;
    }
    if (ch === '"') {
      let j = i + 1;
      while (j < n && input[j] !== '"') {
        if (input[j] === '\\') j += 1;
        j += 1;
      }
      add({ kind: 'double', text: input.slice(i, j + 1), inner: input.slice(i + 1, j) });
      i = j + 1;
      continue;
    }
    if (ch === '`') {
      const end = input.indexOf('`', i + 1);
      const stop = end === -1 ? n : end;
      add({ kind: 'substitution', text: input.slice(i, stop + 1), inner: input.slice(i + 1, stop) });
      i = stop + 1;
      continue;
    }
    if (ch === '$' && input[i + 1] === '(') {
      let depth = 1;
      let j = i + 2;
      while (j < n && depth > 0) {
        if (input[j] === '(') depth += 1;
        else if (input[j] === ')') depth -= 1;
        j += 1;
      }
      const innerEnd = depth === 0 ? j - 1 : j;
      add({ kind: 'substitution', text: input.slice(i, j), inner: input.slice(i + 2, innerEnd) });
      i = j;
      continue;
    }
    let j = i;
    while (j < n && !/\s/.test(input[j]!) && !OPERATOR_STARTS.has(input[j]!)
      && input[j] !== "'" && input[j] !== '"' && input[j] !== '`') {
      if (input[j] === '\\') j += 1;
      j += 1;
    }
    if (!(/^\d+$/.test(input.slice(i, j)) && (input[j] === '>' || input[j] === '<'))) {
      add({ kind: 'word', text: input.slice(i, j), inner: input.slice(i, j) });
    }
    i = j;
  }
  return tokens;
}

/** Command-substitution bodies inside an arbitrary string (`"$(date)"`). */
function extractSubstitutionBodies(text: string): string[] {
  const bodies: string[] = [];
  let i = 0;
  const n = text.length;
  while (i < n) {
    if (text[i] === '$' && text[i + 1] === '(') {
      let depth = 1;
      let j = i + 2;
      while (j < n && depth > 0) {
        if (text[j] === '(') depth += 1;
        else if (text[j] === ')') depth -= 1;
        j += 1;
      }
      bodies.push(text.slice(i + 2, depth === 0 ? j - 1 : j));
      i = j;
      continue;
    }
    if (text[i] === '`') {
      const end = text.indexOf('`', i + 1);
      const stop = end === -1 ? n : end;
      bodies.push(text.slice(i + 1, stop));
      i = stop + 1;
      continue;
    }
    i += 1;
  }
  return bodies;
}

interface Segment {
  tokens: Token[];
  /** This segment is the target of a pipe (`a | this`). */
  pipedInto: boolean;
}

function splitSegments(tokens: Token[]): Segment[] {
  const segments: Segment[] = [];
  let current: Token[] = [];
  let pipedInto = false;
  for (const token of tokens) {
    if (token.kind === 'operator' && SEGMENT_OPERATORS.has(token.text)) {
      if (current.length > 0) segments.push({ tokens: current, pipedInto });
      current = [];
      pipedInto = token.text === '|';
      continue;
    }
    current.push(token);
  }
  if (current.length > 0) segments.push({ tokens: current, pipedInto });
  return segments;
}

// ── Command tables local to analysis ────────────────────────────────────────

const FILE_ORIENTED_COMMANDS = new Set([
  'cat', 'head', 'tail', 'less', 'more', 'wc', 'file', 'stat',
  'ls', 'find', 'grep', 'awk', 'sed', 'sort', 'uniq', 'diff',
  'comm', 'cut', 'tr', 'tee', 'touch', 'mkdir', 'rmdir',
  'rm', 'mv', 'cp', 'ln', 'cd', 'pushd',
]);

/** Bases that only read their path operands, so read-only roots satisfy
 * them. Commands with write forms (sort -o, uniq OUT, sed -i, tee, xxd -r)
 * stay out; find qualifies only without its acting predicates. */
const READ_ONLY_COMMANDS = new Set([
  'cat', 'head', 'tail', 'less', 'more', 'wc', 'file', 'stat', 'ls', 'tree',
  'grep', 'egrep', 'fgrep', 'rg', 'diff', 'comm', 'cut', 'nl', 'du',
  'realpath', 'readlink', 'md5', 'md5sum', 'shasum', 'sha1sum', 'sha256sum',
  'find', 'cd', 'pushd',
]);

const FIND_ACTIONS = new Set([
  '-delete', '-exec', '-execdir', '-ok', '-okdir', '-fprint', '-fprint0', '-fprintf', '-fls',
]);

/** Bases whose arguments are executed as code (so quoted strings are active
 * for the token screen, and screened tokens escalate even without flags). */
const EXEC_BASES = new Set([
  'sh', 'bash', 'zsh', 'dash', 'ksh', 'fish',
  'eval', 'exec', 'xargs', 'env', 'sudo', 'doas', 'su', 'nohup', 'watch',
]);

const SHELL_BASES = new Set(['sh', 'bash', 'zsh', 'dash', 'ksh', 'fish']);

/** Destructive rules whose operands can destroy protected trees; those get
 * catastrophic-target confirmation. git reset/push have no local targets. */
const CATASTROPHIC_ELIGIBLE = new Set([
  'rm', 'shred', 'chmod', 'chown',
]);

/** git flags that take a value before the subcommand (`git -C /x status`). */
const GIT_VALUE_FLAGS = new Set(['-C', '-c', '--git-dir', '--work-tree', '--namespace']);

const MAX_RECURSION_DEPTH = 5;

function isLikelyUrl(arg: string): boolean {
  return /^[a-z][a-z0-9+.-]*:\/\//i.test(arg);
}

// ── Operand resolution ──────────────────────────────────────────────────────

/** Resolves an operand to an absolute path; null when it cannot be seen
 * through (environment variables). Globs resolve via their static prefix. */
function resolveOperand(raw: string, cwd: string, home: string): string | null {
  if (raw === '' || /[$`]/.test(raw)) return null;
  const globIndex = [raw.indexOf('*'), raw.indexOf('?')].filter(index => index >= 0);
  const hasGlob = globIndex.length > 0;
  let candidate = raw;
  if (hasGlob) {
    const prefix = raw.slice(0, Math.min(...globIndex));
    // Resolve the glob-free prefix as a directory (`*.log` -> cwd, `/tmp/x*` -> /tmp).
    const lastSlash = prefix.lastIndexOf('/');
    candidate = prefix.endsWith('/') ? prefix
      : lastSlash < 0 ? '.' : prefix.slice(0, lastSlash) || '/';
  }
  if (candidate === '~') return home;
  if (candidate.startsWith('~/')) return resolve(home, candidate.slice(2));
  if (isAbsolute(candidate)) return resolve(candidate);
  return resolve(cwd, candidate);
}

function withinAny(path: string, roots: readonly string[]): boolean {
  return roots.some(root => isWithinRoot(path, effectivePath(root)));
}

/** True when an effective path sits inside the allowed roots for the access. */
function isAllowedTarget(path: string, ctx: CommandAnalyzeContext, access: 'read' | 'write'): boolean {
  return withinAny(path, ctx.roots) || ctx.isWithinRoots?.(path) === true
    || access === 'read' && withinAny(path, ctx.readRoots ?? []);
}

/** Symlink-resolved path; missing tails keep their literal spelling. */
function toEffective(path: string): string {
  return effectivePath(path);
}

// ── Segment analysis ────────────────────────────────────────────────────────

interface SegmentResult {
  concerns: Set<Concern>;
  catastrophic: boolean;
  evidence: string[];
  resolvedPaths: string[];
}

function emptyResult(): SegmentResult {
  return { concerns: new Set(), catastrophic: false, evidence: [], resolvedPaths: [] };
}

function baseNameOf(word: string): string {
  return word.replace(/.*\//, '').toLowerCase();
}

interface CommandWord {
  text: string;
  redirect: 'none' | 'write' | 'read';
  quoted: boolean;
}

function collectWords(tokens: Token[]): CommandWord[] {
  const words: CommandWord[] = [];
  let pending: CommandWord['redirect'] | 'descriptor' = 'none';
  for (const token of tokens) {
    if (token.kind === 'operator') {
      pending = ['>', '>>', '&>'].includes(token.text) ? 'write'
        : token.text === '<' ? 'read'
          : token.text === '>&' || token.text === '<&' ? 'descriptor' : 'none';
      continue;
    }
    const text = token.kind === 'single' || token.kind === 'double' ? token.inner : token.text;
    if (pending === 'descriptor' && /^(?:\d+|-)$/.test(text)) {
      pending = 'none';
      continue;
    }
    if (token.joined && pending === 'none' && words.length) {
      words[words.length - 1]!.text += text;
      continue;
    }
    words.push({ text, redirect: pending === 'descriptor' ? 'write' : pending,
      quoted: token.kind === 'single' || token.kind === 'double' });
    pending = 'none';
  }
  return words;
}

function isNullDevice(path: string): boolean {
  if (process.platform === 'win32' || path !== '/dev/null') return false;
  try { return lstatSync(path).isCharacterDevice(); }
  catch { return false; }
}

function isSharedTempTarget(path: string): boolean {
  return ['/tmp', '/private/tmp', tmpdir()].some(base =>
    path === effectivePath(base) || path === effectivePath(join(base, 'jean2')));
}

function analyzeSegment(
  segment: Segment,
  ctx: CommandAnalyzeContext,
  cwdAtStart: string,
  depth: number,
): SegmentResult & { nextCwd: string | null } {
  const result = emptyResult();
  let nextCwd: string | null = null;
  const words = collectWords(segment.tokens);

  // Substitution bodies: analyzed recursively (word position and inside
  // double quotes). Their concerns union into this segment.
  if (depth < MAX_RECURSION_DEPTH) {
    for (const token of segment.tokens) {
      const bodies = token.kind === 'substitution' ? [token.inner]
        : token.kind === 'double' ? extractSubstitutionBodies(token.inner)
          : [];
      for (const body of bodies) {
        if (!body.trim()) continue;
        const nested = analyzeCommand(body, ctx, cwdAtStart, depth + 1);
        for (const concern of nested.concerns) result.concerns.add(concern);
        if (nested.catastrophic) result.catastrophic = true;
        result.evidence.push(...nested.evidence.map(item => `in substitution: ${item}`));
        result.resolvedPaths.push(...nested.resolvedPaths);
      }
    }
  }

  const commandWords = words.filter(word => word.redirect === 'none');
  const firstWord = commandWords[0];
  if (!firstWord && !words.some(word => word.redirect !== 'none')) {
    // A segment made only of substitutions: we cannot see the command.
    if (segment.tokens.some(token => token.kind === 'substitution')) {
      result.concerns.add('opaque');
      result.evidence.push('command substitution in command position');
    }
    return { ...result, nextCwd };
  }

  const base = baseNameOf(firstWord?.text ?? ':');
  const args = commandWords.slice(1).map(word => word.text);
  const redirectTargets = words.filter(word => word.redirect !== 'none');

  // Token screen on active text: bare words always; quoted strings only when
  // the base executes its arguments as code.
  const activeParts = words.filter(word => !word.quoted).map(word => word.text);
  const isExecBase = EXEC_BASES.has(base);
  if (isExecBase) {
    for (const token of segment.tokens) {
      if (token.kind === 'single' || token.kind === 'double') activeParts.push(token.inner);
    }
  }
  const screened = containsScreenedToken(activeParts.join(' '));

  // sudo / doas prefix: analyze the remainder as its own command.
  if ((base === 'sudo' || base === 'doas') && args.length > 0 && depth < MAX_RECURSION_DEPTH) {
    const inner = analyzeCommand(args.join(' '), ctx, cwdAtStart, depth + 1);
    for (const concern of inner.concerns) result.concerns.add(concern);
    if (inner.catastrophic) result.catastrophic = true;
    result.evidence.push(...inner.evidence.map(item => `under ${base}: ${item}`));
    result.resolvedPaths.push(...inner.resolvedPaths);
  }

  // Shell bases execute their quoted arguments as code (`sh -c '...'`), so
  // those strings are analyzed recursively rather than treated as inert.
  if (SHELL_BASES.has(base) && depth < MAX_RECURSION_DEPTH) {
    for (const token of segment.tokens) {
      if (token.kind !== 'single' && token.kind !== 'double') continue;
      if (!token.inner.trim()) continue;
      const inner = analyzeCommand(token.inner, ctx, cwdAtStart, depth + 1);
      for (const concern of inner.concerns) result.concerns.add(concern);
      if (inner.catastrophic) result.catastrophic = true;
      result.evidence.push(...inner.evidence.map(item => `in ${base} code: ${item}`));
      result.resolvedPaths.push(...inner.resolvedPaths);
    }
  }

  // Destructive rules. Selector matches (git checkout/restore) only count
  // with a whole-tree operand; flags rules need their flag.
  const sub = gitSubcommand(base, args);
  const invocation: InvocationShape = { base, sub, args };
  const destructive = matchDestructiveRule(invocation);
  const findDeletes = base === 'find' && args.includes('-delete');
  let destructiveConfirmed = findDeletes;
  if (findDeletes) result.evidence.push('find deletes matching files');
  if (destructive) {
    if (destructive.rule.kind === 'selector') {
      const operands = args.filter(arg => !arg.startsWith('-'));
      const wholeTree = operands.length === 0 || operands.includes('.') || operands.includes('./');
      if (wholeTree) {
        destructiveConfirmed = true;
        result.evidence.push(`${base} ${sub} with a whole-tree target`);
      }
    } else {
      destructiveConfirmed = true;
      result.evidence.push(destructive.reason);
    }
  }
  if (base === 'xargs' && containsScreenedToken(args.join(' '))) {
    destructiveConfirmed = true;
    result.evidence.push('xargs runs a dangerous command');
  }
  if (segment.pipedInto && SHELL_BASES.has(base)) {
    destructiveConfirmed = true;
    result.evidence.push('pipe into a shell executes unknown code');
  }
  if (isExecBase && screened && !destructiveConfirmed && !result.catastrophic) {
    // e.g. su -c 'rm -rf /': the dangerous token sits inside executed code we
    // cannot structurally confirm, so treat it as destructive, not opaque.
    destructiveConfirmed = true;
    result.evidence.push(`dangerous token inside executed ${base} arguments`);
  }
  if (destructiveConfirmed) result.concerns.add('destructive');

  // Catastrophic: unconditional bases, dd to a device, and destructive
  // commands whose delete-targets are protected or unresolvable.
  if (CATASTROPHIC_BASES.some(prefix => base.startsWith(prefix))) {
    result.catastrophic = true;
    result.evidence.push(`${base} can destroy the system`);
  }
  if (base === 'dd') {
    const of = args.find(arg => arg.startsWith('of='));
    if (of && of.slice(3).startsWith('/dev/')) {
      result.catastrophic = true;
      result.evidence.push('dd writes to a device');
    }
  }
  if (findDeletes || CATASTROPHIC_ELIGIBLE.has(base) && (destructiveConfirmed || base === 'rm')) {
    const targets = args.filter(arg => !arg.startsWith('-'));
    for (const raw of targets) {
      const resolved = resolveOperand(raw, cwdAtStart, ctx.home);
      if (resolved === null) {
        result.catastrophic = true;
        result.evidence.push(`unresolvable destructive target ${raw}`);
        continue;
      }
      const effective = toEffective(resolved);
      if (isProtectedTarget(effective, ctx.home) || isSharedTempTarget(effective)) {
        result.catastrophic = true;
        result.evidence.push(`destructive target ${effective} is protected`);
      }
    }
  }

  // Path operands: escape, sensitive, unresolvable-opaque.
  const isFileCommand = FILE_ORIENTED_COMMANDS.has(base);
  // Read-only roots satisfy operands only when the whole invocation reads.
  const operandAccess: 'read' | 'write' = READ_ONLY_COMMANDS.has(base)
    && !(base === 'find' && args.some(arg => FIND_ACTIONS.has(arg))) ? 'read' : 'write';
  const operandCandidates: Array<{ raw: string; resolved: string | null; access: 'read' | 'write' }> = [];
  const pushOperand = (raw: string, access: 'read' | 'write'): void => {
    if (raw === '' || raw.startsWith('-')) return;
    if (isLikelyUrl(raw)) return;
    const resolved = resolveOperand(raw, cwdAtStart, ctx.home);
    operandCandidates.push({ raw, resolved, access });
  };
  for (const word of commandWords.slice(1)) {
    if (!word.quoted || isFileCommand || /^(?:\/|~|\$)/.test(word.text)) pushOperand(word.text, operandAccess);
  }
  if (isFileCommand && operandCandidates.length === 0 && (base === 'ls' || base === 'find')) {
    operandCandidates.push({ raw: cwdAtStart, resolved: resolve(cwdAtStart), access: operandAccess });
  }
  for (const target of redirectTargets) {
    const resolved = resolveOperand(target.text, cwdAtStart, ctx.home);
    if (resolved !== null) {
      const effective = toEffective(resolved);
      if (target.redirect === 'write' && isWithinRoot(effective, '/dev') && !isNullDevice(resolved)) {
        result.catastrophic = true;
        result.evidence.push('redirect writes to a device');
      }
      if (isSensitiveFilename(effective) || isSensitiveFilename(target.text)) {
        result.concerns.add('sensitive');
        result.evidence.push(`${target.text} references sensitive material`);
      }
      result.resolvedPaths.push(effective);
      if (!isNullDevice(resolved) && !isAllowedTarget(effective, ctx, target.redirect === 'read' ? 'read' : 'write')) {
        result.concerns.add('escape');
        result.evidence.push(`redirect target ${effective} is outside the allowed roots`);
      }
    } else {
      result.concerns.add('opaque');
      result.evidence.push(`unresolvable redirect target ${target.text}`);
      if (/\$\{?(?:TMPDIR|TEMP|TMP)\b/.test(target.text)) result.concerns.add('escape');
    }
  }
  for (const { raw, resolved, access } of operandCandidates) {
    if (resolved === null) {
      if (raw.includes('$')) {
        result.concerns.add('opaque');
        result.evidence.push(`unresolvable operand ${raw}`);
        if (/\$\{?(?:TMPDIR|TEMP|TMP)\b/.test(raw)) result.concerns.add('escape');
      }
      continue;
    }
    const effective = toEffective(resolved);
    result.resolvedPaths.push(effective);
    if (access === 'write' && isWithinRoot(effective, '/dev')) {
      result.catastrophic = true;
      result.evidence.push('operation can replace or modify a device');
    }
    if (!(access === 'read' && isNullDevice(resolved)) && !isAllowedTarget(effective, ctx, access)) {
      result.concerns.add('escape');
      result.evidence.push(`path ${effective} is outside the allowed roots`);
    }
    if (isSensitiveFilename(effective) || isSensitiveFilename(raw)) {
      result.concerns.add('sensitive');
      result.evidence.push(`${raw} references sensitive material`);
    }
  }

  // cd tracking: following segments resolve relative paths against the new cwd.
  if (base === 'cd') {
    const target = args.find(arg => !arg.startsWith('-'));
    if (target === undefined) {
      nextCwd = ctx.home;
    } else {
      const resolved = resolveOperand(target, cwdAtStart, ctx.home);
      nextCwd = resolved ?? cwdAtStart;
    }
  }

  // Opaque: constructs we cannot see through even after recursion.
  if (base === 'eval' || base === 'exec') {
    result.concerns.add('opaque');
    result.evidence.push(`${base} runs dynamic code`);
  }
  if (base === 'find' && args.some(arg => arg === '-exec' || arg === '-execdir')) {
    result.concerns.add('opaque');
    result.evidence.push('find -exec runs dynamic code');
    // The -exec payload is itself a command: analyze it so `find . -exec rm
    // -rf {}` keeps its destructive concern instead of hiding behind opaque.
    if (depth < MAX_RECURSION_DEPTH) {
      for (let i = 0; i < args.length; i += 1) {
        if (args[i] !== '-exec' && args[i] !== '-execdir') continue;
        const payload: string[] = [];
        for (let j = i + 1; j < args.length && args[j] !== ';' && args[j] !== '+'; j += 1) {
          if (args[j] !== '{}') payload.push(args[j]);
        }
        if (payload.length === 0) continue;
        const inner = analyzeCommand(payload.join(' '), ctx, cwdAtStart, depth + 1);
        for (const concern of inner.concerns) result.concerns.add(concern);
        if (inner.catastrophic) result.catastrophic = true;
        result.evidence.push(...inner.evidence.map(item => `in find -exec: ${item}`));
        result.resolvedPaths.push(...inner.resolvedPaths);
      }
    }
  }
  if (segment.tokens.some(token => token.kind === 'substitution')) {
    result.concerns.add('opaque');
    result.evidence.push('command substitution hides the effective operand');
  }

  return { ...result, nextCwd };
}

function gitSubcommand(base: string, args: readonly string[]): string | undefined {
  if (base !== 'git') return undefined;
  let skipValue = false;
  for (const arg of args) {
    if (skipValue) {
      skipValue = false;
      continue;
    }
    if (GIT_VALUE_FLAGS.has(arg)) {
      skipValue = true;
      continue;
    }
    if (arg.startsWith('-')) continue;
    return arg;
  }
  return undefined;
}

// ── Entry point ─────────────────────────────────────────────────────────────

export function analyzeCommand(
  command: string,
  ctx: CommandAnalyzeContext,
  initialCwd?: string,
  depth = 0,
): Finding {
  const concerns = new Set<Concern>();
  const evidence: string[] = [];
  const resolvedPaths: string[] = [];
  let catastrophic = false;

  const unwrapped = unwrapShellCommand(command) ?? command;
  if (!unwrapped.trim()) {
    return { concerns: [], catastrophic: false, evidence: [], resolvedPaths: [] };
  }

  let cwd = initialCwd ?? ctx.cwd;
  for (const segment of splitSegments(tokenize(unwrapped))) {
    const result = analyzeSegment(segment, ctx, cwd, depth);
    for (const concern of result.concerns) concerns.add(concern);
    if (result.catastrophic) catastrophic = true;
    evidence.push(...result.evidence);
    resolvedPaths.push(...result.resolvedPaths);
    if (result.nextCwd !== null) cwd = result.nextCwd;
  }

  return {
    concerns: [...concerns],
    catastrophic,
    evidence: [...new Set(evidence)].slice(0, 8),
    resolvedPaths: [...new Set(resolvedPaths)],
  };
}
