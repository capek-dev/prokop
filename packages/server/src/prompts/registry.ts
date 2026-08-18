import { readdir, readFile } from 'fs/promises';
import { join } from 'path';
import { existsSync, mkdirSync } from 'fs';
import type { PromptInfo } from '@jean2/sdk';
import { getPromptsDir as getPromptsDirFromPaths } from '@/infrastructure/runtime/paths';

let promptsCache: PromptInfo[] | null = null;
let lastScanTime = 0;
const CACHE_TTL = 60_000;

function getPromptsDir(): string {
  return getPromptsDirFromPaths();
}

export function ensurePromptsDir(): void {
  const dir = getPromptsDir();
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
}

function parsePromptFile(raw: string, fileName: string): PromptInfo {
  const name = fileName.replace(/\.md$/i, '');
  const trimmed = raw.trim();
  const lines = trimmed.split('\n');

  const firstLine = lines[0] || '';
  const isHeading = firstLine.startsWith('# ');
  const description = isHeading ? firstLine.slice(2).trim() : firstLine.slice(0, 80).trim();
  const contentStartIndex = isHeading ? 1 : 0;

  const content = lines.slice(contentStartIndex).join('\n').trim();

  return { name, description, content };
}

async function scanPromptsFromDisk(): Promise<PromptInfo[]> {
  const dir = getPromptsDir();

  if (!existsSync(dir)) {
    return [];
  }

  try {
    const entries = await readdir(dir);
    const mdFiles = entries.filter(e => e.endsWith('.md'));

    const prompts: PromptInfo[] = [];
    for (const file of mdFiles) {
      try {
        const raw = await readFile(join(dir, file), 'utf-8');
        prompts.push(parsePromptFile(raw, file));
      } catch (err) {
        console.warn(`Failed to read prompt file ${file}:`, err);
      }
    }

    return prompts;
  } catch (err) {
    console.error('Failed to scan prompts directory:', err);
    return [];
  }
}

export async function listPrompts(): Promise<PromptInfo[]> {
  const now = Date.now();
  if (promptsCache !== null && now - lastScanTime < CACHE_TTL) {
    return promptsCache;
  }

  promptsCache = await scanPromptsFromDisk();
  lastScanTime = now;
  return promptsCache;
}

export function clearPromptsCache(): void {
  promptsCache = null;
  lastScanTime = 0;
}

export async function getPrompt(name: string): Promise<PromptInfo | null> {
  const prompts = await listPrompts();
  return prompts.find(p => p.name === name) || null;
}

export { parsePromptFile };
