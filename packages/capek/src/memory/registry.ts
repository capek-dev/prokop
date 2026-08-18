import { existsSync } from 'fs';
import { mkdir, readFile, writeFile } from 'fs/promises';
import { join } from 'path';

const USER_FILE = 'USER.md';
const MEMORY_FILE = 'MEMORY.md';
export const USER_CHAR_LIMIT = 1500;
export const MEMORY_CHAR_LIMIT = 2500;
export type MemoryTarget = 'user' | 'memory';

export interface MemoryUsage { chars: number; limit: number }
export interface MemoryFile {
  path: string;
  content: string;
  entries: string[];
  charCount: number;
  charLimit: number;
}
export interface MemoryActionResult {
  success: boolean;
  result?: {
    target: MemoryTarget;
    action: 'list' | 'add' | 'replace' | 'remove';
    path: string;
    usage: MemoryUsage;
    entry?: string;
    entries?: string[];
  };
  error?: string;
  entries?: string[];
  usage?: MemoryUsage;
}

const fileName = (target: MemoryTarget) => target === 'user' ? USER_FILE : MEMORY_FILE;
const filePath = (basePath: string, target: MemoryTarget) => join(basePath, fileName(target));
const charLimit = (target: MemoryTarget) => target === 'user' ? USER_CHAR_LIMIT : MEMORY_CHAR_LIMIT;

export function parseEntries(content: string): string[] {
  return content.split('\n').map((line) => line.trim()).filter((line) => line.startsWith('- '));
}
export function entriesToContent(entries: string[]): string { return entries.join('\n'); }
export function formatEntriesForDisplay(entries: string[]): string[] {
  return entries.map((entry, index) => `[${index}] ${entry.replace(/^- /, '')}`);
}
export function formatMemorySection(tag: string, path: string, content: string, chars: number, limit: number): string {
  return `<${tag} path="${path}" usage="${chars}/${limit}">\n${content}\n</${tag}>`;
}

export async function loadMemoryFile(basePath: string, target: MemoryTarget): Promise<MemoryFile | null> {
  const path = filePath(basePath, target);
  if (!existsSync(path)) return null;
  try {
    const content = (await readFile(path, 'utf-8')).trim();
    if (!content) return null;
    return { path: fileName(target), content, entries: parseEntries(content), charCount: content.length, charLimit: charLimit(target) };
  } catch {
    return null;
  }
}

async function ensureDir(basePath: string): Promise<void> {
  if (!existsSync(basePath)) await mkdir(basePath, { recursive: true });
}

function fullResult(existing: string, target: MemoryTarget, entries: string[], replaceHint: string): MemoryActionResult {
  const limit = charLimit(target);
  return {
    success: false,
    error: `Memory is full (${existing.length}/${limit} chars). Consider merging related entries to free space, or ${replaceHint}.`,
    entries: formatEntriesForDisplay(entries),
    usage: { chars: existing.length, limit },
  };
}

export async function addEntry(basePath: string, target: MemoryTarget, content: string): Promise<MemoryActionResult> {
  const trimmed = content.trim();
  if (!trimmed) return { success: false, error: 'Content cannot be empty.' };
  const entry = `- ${trimmed}`;
  const path = filePath(basePath, target);
  let existingContent = '';
  let entries: string[] = [];
  if (existsSync(path)) {
    try {
      existingContent = (await readFile(path, 'utf-8')).trim();
      entries = parseEntries(existingContent);
    } catch {
      existingContent = '';
      entries = [];
    }
  }
  if (entries.includes(entry)) return { success: false, error: 'Exact duplicate entry already exists.' };
  const next = existingContent ? `${existingContent}\n${entry}` : entry;
  if (next.length > charLimit(target)) return fullResult(existingContent, target, entries, 'replace/remove existing ones first');
  await ensureDir(basePath);
  await writeFile(path, next, 'utf-8');
  return { success: true, result: { target, action: 'add', path: fileName(target), usage: { chars: next.length, limit: charLimit(target) }, entry: trimmed } };
}

async function readExisting(basePath: string, target: MemoryTarget): Promise<{ content: string; entries: string[] } | MemoryActionResult> {
  const path = filePath(basePath, target);
  if (!existsSync(path)) return { success: false, error: 'Memory file does not exist.' };
  try {
    const content = (await readFile(path, 'utf-8')).trim();
    return { content, entries: parseEntries(content) };
  } catch {
    return { success: false, error: 'Failed to read memory file.' };
  }
}

function findOne(content: string, entries: string[], target: MemoryTarget, oldText: string): string | MemoryActionResult {
  const matches = entries.filter((entry) => entry.includes(oldText));
  const usage = { chars: content.length, limit: charLimit(target) };
  if (matches.length === 0) return { success: false, error: `No entry found matching "${oldText}". Use the list action to see current entries.`, entries: formatEntriesForDisplay(entries), usage };
  if (matches.length > 1) return { success: false, error: `Multiple entries match "${oldText}". Be more specific.`, entries: formatEntriesForDisplay(matches), usage };
  return matches[0];
}

export async function replaceEntry(basePath: string, target: MemoryTarget, oldText: string, content: string): Promise<MemoryActionResult> {
  const trimmed = content.trim();
  if (!trimmed) return { success: false, error: 'New content cannot be empty.' };
  const loaded = await readExisting(basePath, target);
  if ('success' in loaded) return loaded;
  const match = findOne(loaded.content, loaded.entries, target, oldText);
  if (typeof match !== 'string') return match;
  const next = loaded.content.replace(match, `- ${trimmed}`);
  if (next.length > charLimit(target)) return fullResult(loaded.content, target, loaded.entries, 'remove existing ones first');
  await writeFile(filePath(basePath, target), next, 'utf-8');
  return { success: true, result: { target, action: 'replace', path: fileName(target), usage: { chars: next.length, limit: charLimit(target) }, entry: trimmed } };
}

export async function removeEntry(basePath: string, target: MemoryTarget, oldText: string): Promise<MemoryActionResult> {
  const loaded = await readExisting(basePath, target);
  if ('success' in loaded) return loaded;
  const match = findOne(loaded.content, loaded.entries, target, oldText);
  if (typeof match !== 'string') return match;
  const lines = loaded.content.split('\n');
  const matchIndex = lines.findIndex((line) => line.trim() === match);
  const next = matchIndex >= 0
    ? [...lines.slice(0, matchIndex), ...lines.slice(matchIndex + 1)].join('\n').trim()
    : loaded.content;
  await writeFile(filePath(basePath, target), next, 'utf-8');
  return { success: true, result: { target, action: 'remove', path: fileName(target), usage: { chars: next.length, limit: charLimit(target) } } };
}

export async function listEntries(basePath: string, target: MemoryTarget): Promise<MemoryActionResult> {
  const file = await loadMemoryFile(basePath, target);
  return { success: true, result: { target, action: 'list', path: fileName(target), usage: { chars: file?.charCount ?? 0, limit: charLimit(target) }, entries: file ? formatEntriesForDisplay(file.entries) : [] } };
}

export async function loadMemoryInstructions(basePath: string): Promise<string | null> {
  const sections: string[] = [];
  const user = await loadMemoryFile(basePath, 'user');
  if (user) sections.push(formatMemorySection('user_memory', user.path, user.content, user.charCount, user.charLimit));
  const memory = await loadMemoryFile(basePath, 'memory');
  if (memory) sections.push(formatMemorySection('workspace_memory', memory.path, memory.content, memory.charCount, memory.charLimit));
  return sections.length > 0 ? sections.join('\n\n') : null;
}

export const MEMORY_LINE_USER_TARGET = 'Use target="user" for user preferences and communication/workflow expectations.';
export const MEMORY_LINE_MEMORY_TARGET = 'Use target="memory" for workspace facts, repo conventions, commands, lessons, and non-obvious fixes.';
export const MEMORY_LINE_ONLY_COMPACT = 'Only save compact facts that should affect future sessions.';
export const MEMORY_LINE_NO_SECRETS = 'Do not save secrets, raw logs, large code, or one-off details.';
export const MEMORY_LINE_USE_LIST = 'Use list before replace/remove to see the exact current entries and avoid guesswork.';

export const MEMORY_GUIDANCE = `You can persist durable workspace knowledge using the memory tool.
${MEMORY_LINE_USER_TARGET}
${MEMORY_LINE_MEMORY_TARGET}
Character limits: user=${USER_CHAR_LIMIT}, workspace=${MEMORY_CHAR_LIMIT}.
${MEMORY_LINE_ONLY_COMPACT}
${MEMORY_LINE_NO_SECRETS}
If memory is full, consolidate existing entries with replace before adding.
Use the list action to verify current entries before replacing or removing.`;
