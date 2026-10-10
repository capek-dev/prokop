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
import type { Concern, Finding, Highlight } from '../concerns';
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
  /** Offsets of `text` in the tokenized input. */
  start: number;
  end: number;
}

const OPERATOR_STARTS = new Set(['&', '|', ';', '<', '>']);
const SEGMENT_OPERATORS = new Set(['&&', '||', '|', ';', '&']);

function tokenize(input: string): Token[] {
  const tokens: Token[] = [];
  const n = input.length;
  let i = 0;
  const add = (token: Pick<Token, 'kind' | 'text' | 'inner'>): void => {
    const previous = tokens.at(-1);
    tokens.push({ ...token, start: i, end: i + token.text.length,
      joined: !!previous && previous.kind !== 'operator'
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

/** Command-substitution bodies inside an arbitrary string (`"$(date)"`),
 * each with its offset in `text`. */
function extractSubstitutionBodies(text: string): Array<{ body: string; offset: number }> {
  const bodies: Array<{ body: string; offset: number }> = [];
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
      bodies.push({ body: text.slice(i + 2, depth === 0 ? j - 1 : j), offset: i + 2 });
      i = j;
      continue;
    }
    if (text[i] === '`') {
      const end = text.indexOf('`', i + 1);
      const stop = end === -1 ? n : end;
      bodies.push({ body: text.slice(i + 1, stop), offset: i + 1 });
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

interface Span {
  start: number;
  end: number;
}

function segmentSpan(segment: Segment): Span {
  return { start: segment.tokens[0]!.start, end: segment.tokens.at(-1)!.end };
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

/** xargs options that take a separate value (GNU and BSD), so the command it
 * runs starts after them. `-a`/`--arg-file` values are files xargs reads. */
const XARGS_SHORT_VALUE_FLAGS = new Set(['-a', '-d', '-E', '-I', '-J', '-L', '-n', '-P', '-R', '-s', '-S']);
const XARGS_LONG_VALUE_FLAGS = new Set([
  '--arg-file', '--delimiter', '--max-args', '--max-procs', '--max-chars', '--process-slot-var',
]);

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
  highlights: Highlight[];
}

function emptyResult(): SegmentResult {
  return { concerns: new Set(), catastrophic: false, evidence: [], resolvedPaths: [], highlights: [] };
}

function baseNameOf(word: string): string {
  return word.replace(/.*\//, '').toLowerCase();
}

interface CommandWord extends Span {
  text: string;
  redirect: 'none' | 'write' | 'read';
  quoted: boolean;
}

/** Where xargs' own options end: the command it runs, and the files it reads
 * its items from. No command means xargs runs `echo`. */
function parseXargs(words: readonly CommandWord[]): { command: number | null; argFiles: CommandWord[] } {
  const argFiles: CommandWord[] = [];
  for (let i = 1; i < words.length; i += 1) {
    const text = words[i]!.text;
    if (text === '--') return { command: i + 1 < words.length ? i + 1 : null, argFiles };
    if (!text.startsWith('-')) return { command: i, argFiles };
    const long = text.startsWith('--');
    const name = long ? text.split('=')[0]! : text.slice(0, 2);
    const attached = long ? text.includes('=') : text.length > 2;
    const takesValue = long ? XARGS_LONG_VALUE_FLAGS.has(name) : XARGS_SHORT_VALUE_FLAGS.has(name);
    if (!takesValue) continue;
    const isArgFile = name === '-a' || name === '--arg-file';
    if (attached) {
      if (isArgFile) {
        const valueStart = long ? text.indexOf('=') + 1 : 2;
        argFiles.push({ ...words[i]!, text: text.slice(valueStart) });
      }
      continue;
    }
    if (isArgFile && words[i + 1]) argFiles.push(words[i + 1]!);
    i += 1;
  }
  return { command: null, argFiles };
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
      words[words.length - 1]!.end = token.end;
      continue;
    }
    words.push({ text, redirect: pending === 'descriptor' ? 'write' : pending,
      quoted: token.kind === 'single' || token.kind === 'double',
      start: token.start, end: token.end });
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
  source: string,
  ctx: CommandAnalyzeContext,
  cwdAtStart: string,
  depth: number,
): SegmentResult & { nextCwd: string | null } {
  const result = emptyResult();
  let nextCwd: string | null = null;
  const words = collectWords(segment.tokens);
  const span = segmentSpan(segment);
  const mark = (at: Span, reason: string): void => {
    result.highlights.push({ start: at.start, end: at.end, reason });
  };
  /** Unions a nested analysis into this segment. `offset` places its
   * highlights in `source`; null (text rebuilt from words) pins them to the
   * whole segment instead. */
  const absorb = (nested: Finding, prefix: string, offset: number | null): void => {
    for (const concern of nested.concerns) result.concerns.add(concern);
    if (nested.catastrophic) result.catastrophic = true;
    result.evidence.push(...nested.evidence.map(item => `${prefix}${item}`));
    result.resolvedPaths.push(...nested.resolvedPaths);
    for (const highlight of nested.highlights ?? []) {
      mark(offset === null ? span
        : { start: highlight.start + offset, end: highlight.end + offset }, highlight.reason);
    }
  };

  // Substitution bodies: analyzed recursively (word position and inside
  // double quotes). Their concerns union into this segment.
  if (depth < MAX_RECURSION_DEPTH) {
    for (const token of segment.tokens) {
      const bodies = token.kind === 'substitution'
        ? [{ body: token.inner, offset: token.start + (token.text.startsWith('$(') ? 2 : 1) }]
        : token.kind === 'double'
          ? extractSubstitutionBodies(token.inner)
            .map(({ body, offset }) => ({ body, offset: token.start + 1 + offset }))
          : [];
      for (const { body, offset } of bodies) {
        if (!body.trim()) continue;
        absorb(analyzeCommand(body, ctx, cwdAtStart, depth + 1), 'in substitution: ', offset);
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
  // the base executes its arguments as code. xargs is screened by the
  // command it runs (analyzed below), never by its own name.
  const activeParts = words
    .filter(word => !word.quoted && !(base === 'xargs' && word === firstWord))
    .map(word => word.text);
  const isExecBase = EXEC_BASES.has(base);
  if (isExecBase) {
    for (const token of segment.tokens) {
      if (token.kind === 'single' || token.kind === 'double') activeParts.push(token.inner);
    }
  }
  const screened = containsScreenedToken(activeParts.join(' '));

  // sudo / doas prefix: analyze the remainder as its own command.
  if ((base === 'sudo' || base === 'doas') && args.length > 0 && depth < MAX_RECURSION_DEPTH) {
    absorb(analyzeCommand(args.join(' '), ctx, cwdAtStart, depth + 1), `under ${base}: `, null);
  }

  // Shell bases execute their quoted arguments as code (`sh -c '...'`), so
  // those strings are analyzed recursively rather than treated as inert.
  if (SHELL_BASES.has(base) && depth < MAX_RECURSION_DEPTH) {
    for (const token of segment.tokens) {
      if (token.kind !== 'single' && token.kind !== 'double') continue;
      if (!token.inner.trim()) continue;
      absorb(analyzeCommand(token.inner, ctx, cwdAtStart, depth + 1), `in ${base} code: `, token.start + 1);
    }
  }

  // xargs runs a command with piped items appended: analyze that command as
  // written; the appended operands are unseen, like a substitution's output.
  const xargs = base === 'xargs' ? parseXargs(commandWords) : null;
  const xargsCommand: Span = xargs?.command != null
    ? { start: commandWords[xargs.command]!.start, end: commandWords.at(-1)!.end }
    : span;
  if (xargs?.command != null && depth < MAX_RECURSION_DEPTH) {
    absorb(analyzeCommand(source.slice(xargsCommand.start, xargsCommand.end), ctx, cwdAtStart, depth + 1),
      'under xargs: ', xargsCommand.start);
    result.concerns.add('opaque');
    result.evidence.push('xargs appends piped input as operands');
  }

  // Destructive rules. Selector matches (git checkout/restore) only count
  // with a whole-tree operand; flags rules need their flag.
  const sub = gitSubcommand(base, args);
  const invocation: InvocationShape = { base, sub, args };
  const destructive = matchDestructiveRule(invocation);
  const findDeletes = base === 'find' && args.includes('-delete');
  let destructiveConfirmed = findDeletes;
  if (findDeletes) {
    result.evidence.push('find deletes matching files');
    mark(span, 'deletes every matching file');
  }
  if (destructive) {
    if (destructive.rule.kind === 'selector') {
      const operands = args.filter(arg => !arg.startsWith('-'));
      const wholeTree = operands.length === 0 || operands.includes('.') || operands.includes('./');
      if (wholeTree) {
        destructiveConfirmed = true;
        result.evidence.push(`${base} ${sub} with a whole-tree target`);
        mark(span, destructive.rule.label);
      }
    } else {
      destructiveConfirmed = true;
      result.evidence.push(destructive.reason);
      mark(span, destructive.rule.label);
    }
  }
  if (base === 'xargs' && containsScreenedToken(args.join(' '))) {
    destructiveConfirmed = true;
    result.evidence.push('xargs runs a dangerous command');
    mark(xargsCommand, 'runs a dangerous command on every piped item');
  }
  if (segment.pipedInto && SHELL_BASES.has(base)) {
    destructiveConfirmed = true;
    result.evidence.push('pipe into a shell executes unknown code');
    mark(span, 'runs piped text as shell code');
  }
  if (isExecBase && screened && !destructiveConfirmed && !result.catastrophic) {
    // e.g. su -c 'rm -rf /': the dangerous token sits inside executed code we
    // cannot structurally confirm, so treat it as destructive, not opaque.
    destructiveConfirmed = true;
    result.evidence.push(`dangerous token inside executed ${base} arguments`);
    mark(span, 'runs code containing a dangerous command');
  }
  if (destructiveConfirmed) result.concerns.add('destructive');

  // Catastrophic: unconditional bases, dd to a device, and destructive
  // commands whose delete-targets are protected or unresolvable.
  if (CATASTROPHIC_BASES.some(prefix => base.startsWith(prefix))) {
    result.catastrophic = true;
    result.evidence.push(`${base} can destroy the system`);
    mark(span, 'can wipe or shut down the system');
  }
  if (base === 'dd') {
    const of = commandWords.slice(1).find(word => word.text.startsWith('of='));
    if (of && of.text.slice(3).startsWith('/dev/')) {
      result.catastrophic = true;
      result.evidence.push('dd writes to a device');
      mark(of, 'writes directly to a device');
    }
  }
  if (findDeletes || CATASTROPHIC_ELIGIBLE.has(base) && (destructiveConfirmed || base === 'rm')) {
    const targets = commandWords.slice(1).filter(word => !word.text.startsWith('-'));
    for (const target of targets) {
      const resolved = resolveOperand(target.text, cwdAtStart, ctx.home);
      if (resolved === null) {
        result.catastrophic = true;
        result.evidence.push(`unresolvable destructive target ${target.text}`);
        mark(target, 'target is unknown until the command runs');
        continue;
      }
      const effective = toEffective(resolved);
      if (isProtectedTarget(effective, ctx.home) || isSharedTempTarget(effective)) {
        result.catastrophic = true;
        result.evidence.push(`destructive target ${effective} is protected`);
        mark(target, 'targets a protected system or home path');
      }
    }
  }

  // Path operands: escape, sensitive, unresolvable-opaque. xargs operands
  // were analyzed with its command; only its item files remain.
  const isFileCommand = FILE_ORIENTED_COMMANDS.has(base);
  // Read-only roots satisfy operands only when the whole invocation reads.
  const operandAccess: 'read' | 'write' = xargs || READ_ONLY_COMMANDS.has(base)
    && !(base === 'find' && args.some(arg => FIND_ACTIONS.has(arg))) ? 'read' : 'write';
  const operandCandidates: Array<{
    raw: string; resolved: string | null; access: 'read' | 'write'; at: Span;
  }> = [];
  const pushOperand = (word: CommandWord, access: 'read' | 'write'): void => {
    const raw = word.text;
    if (raw === '' || raw.startsWith('-')) return;
    if (isLikelyUrl(raw)) return;
    const resolved = resolveOperand(raw, cwdAtStart, ctx.home);
    operandCandidates.push({ raw, resolved, access, at: word });
  };
  for (const word of xargs ? xargs.argFiles : commandWords.slice(1)) {
    if (xargs || !word.quoted || isFileCommand || /^(?:\/|~|\$)/.test(word.text)) pushOperand(word, operandAccess);
  }
  if (isFileCommand && operandCandidates.length === 0 && (base === 'ls' || base === 'find')) {
    operandCandidates.push({ raw: cwdAtStart, resolved: resolve(cwdAtStart), access: operandAccess, at: firstWord! });
  }
  for (const target of redirectTargets) {
    const resolved = resolveOperand(target.text, cwdAtStart, ctx.home);
    if (resolved !== null) {
      const effective = toEffective(resolved);
      if (target.redirect === 'write' && isWithinRoot(effective, '/dev') && !isNullDevice(resolved)) {
        result.catastrophic = true;
        result.evidence.push('redirect writes to a device');
        mark(target, 'writes directly to a device');
      }
      if (isSensitiveFilename(effective) || isSensitiveFilename(target.text)) {
        result.concerns.add('sensitive');
        result.evidence.push(`${target.text} references sensitive material`);
        mark(target, 'may contain secrets');
      }
      result.resolvedPaths.push(effective);
      if (!isNullDevice(resolved) && !isAllowedTarget(effective, ctx, target.redirect === 'read' ? 'read' : 'write')) {
        result.concerns.add('escape');
        result.evidence.push(`redirect target ${effective} is outside the allowed roots`);
        mark(target, 'outside the workspace');
      }
    } else {
      result.concerns.add('opaque');
      result.evidence.push(`unresolvable redirect target ${target.text}`);
      if (/\$\{?(?:TMPDIR|TEMP|TMP)\b/.test(target.text)) result.concerns.add('escape');
    }
  }
  for (const { raw, resolved, access, at } of operandCandidates) {
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
      mark(at, 'can modify a device');
    }
    if (!(access === 'read' && isNullDevice(resolved)) && !isAllowedTarget(effective, ctx, access)) {
      result.concerns.add('escape');
      result.evidence.push(`path ${effective} is outside the allowed roots`);
      mark(at, 'outside the workspace');
    }
    if (isSensitiveFilename(effective) || isSensitiveFilename(raw)) {
      result.concerns.add('sensitive');
      result.evidence.push(`${raw} references sensitive material`);
      mark(at, 'may contain secrets');
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
        absorb(analyzeCommand(payload.join(' '), ctx, cwdAtStart, depth + 1), 'in find -exec: ', null);
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
  const highlights = new Map<string, Highlight>();
  let catastrophic = false;

  const unwrapped = unwrapShellCommand(command) ?? command;
  if (!unwrapped.trim()) {
    return { concerns: [], catastrophic: false, evidence: [], resolvedPaths: [], highlights: [] };
  }
  // Highlights index `command`: an unwrapped script maps back when it appears
  // verbatim (single-quoted), otherwise it covers the whole command.
  const shift = unwrapped === command ? 0 : command.indexOf(unwrapped);

  let cwd = initialCwd ?? ctx.cwd;
  for (const segment of splitSegments(tokenize(unwrapped))) {
    const result = analyzeSegment(segment, unwrapped, ctx, cwd, depth);
    for (const concern of result.concerns) concerns.add(concern);
    if (result.catastrophic) catastrophic = true;
    evidence.push(...result.evidence);
    resolvedPaths.push(...result.resolvedPaths);
    for (const highlight of result.highlights) {
      const mapped = shift < 0 ? { ...highlight, start: 0, end: command.length }
        : { ...highlight, start: highlight.start + shift, end: highlight.end + shift };
      highlights.set(`${mapped.start}:${mapped.end}:${mapped.reason}`, mapped);
    }
    if (result.nextCwd !== null) cwd = result.nextCwd;
  }

  return {
    concerns: [...concerns],
    catastrophic,
    evidence: [...new Set(evidence)].slice(0, 8),
    resolvedPaths: [...new Set(resolvedPaths)],
    highlights: [...highlights.values()].slice(0, 8),
  };
}

/** Top-level command segments (`a | b && c`) as spans of `command`, so an
 * ask can lay a pipeline out one stage per line. Empty when the command is
 * a shell wrapper whose script does not appear verbatim. */
export function commandSegmentSpans(command: string): Array<{ start: number; end: number }> {
  const unwrapped = unwrapShellCommand(command) ?? command;
  const shift = unwrapped === command ? 0 : command.indexOf(unwrapped);
  if (shift < 0) return [];
  return splitSegments(tokenize(unwrapped)).map(segment => {
    const { start, end } = segmentSpan(segment);
    return { start: start + shift, end: end + shift };
  });
}
