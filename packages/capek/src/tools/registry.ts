import { readdir } from 'fs/promises';
import { existsSync } from 'fs';
import { watch } from 'fs';
import { join, resolve, relative } from 'path';
import type { ToolDefinition, LoadedTool } from '@jean2/sdk';
import { readInstallManifest, resolveToolsPath } from '../compat/jean2-dependencies';

const toolsCache: Map<string, LoadedTool> = new Map();
let lastScanTime = 0;
const CACHE_TTL = 60000;

let watcher: ReturnType<typeof watch> | null = null;
let debounceTimer: ReturnType<typeof setTimeout> | null = null;
let watcherToolsPath: string | null = null;

function getDefaultToolsPath(): string {
  return resolveToolsPath();
}

async function loadToolModule(toolDir: string): Promise<LoadedTool | null> {
  const toolName = toolDir.split('/').pop() || '';
  const toolsBasePath = toolDir.split('/').slice(0, -1).join('/');

  const manifest = readInstallManifest(toolsBasePath, toolName);

  let modulePath: string | null = null;

  if (manifest?.entry) {
    const manifestEntryPath = join(toolDir, manifest.entry);
    if (existsSync(manifestEntryPath)) {
      modulePath = manifestEntryPath;
    }
  }

  if (!modulePath) {
    const toolJsPath = join(toolDir, 'tool.js');
    const toolTsPath = join(toolDir, 'tool.ts');

    if (existsSync(toolJsPath)) {
      modulePath = toolJsPath;
    } else if (existsSync(toolTsPath)) {
      modulePath = toolTsPath;
    }
  }

  if (!modulePath) {
    return null;
  }

  try {
    const module = await import(modulePath);

    if (!module.definition || typeof module.execute !== 'function') {
      console.warn(
        `Tool at ${toolDir} missing required exports (definition, execute)`,
      );
      return null;
    }

    const definition: ToolDefinition = module.definition;
    if (!definition.name || !definition.inputSchema) {
      console.warn(
        `Tool at ${toolDir} has invalid definition (missing name or inputSchema)`,
      );
      return null;
    }

    return {
      definition,
      execute: module.execute,
      path: toolDir,
    };
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : String(e);

    if (message.includes('Cannot find module')) {
      console.warn(
        `Tool at ${toolDir} has missing dependencies: ${message}`,
      );
    } else if (
      message.includes('SyntaxError') ||
      message.includes('Unexpected')
    ) {
      console.warn(
        `Tool at ${toolDir} has a syntax/load error: ${message}`,
      );
    } else {
      console.warn(`Failed to load tool module at ${toolDir}:`, e);
    }
    return null;
  }
}

function invalidateToolAtPath(filePath: string): void {
  if (!watcherToolsPath) return;

  const relativePath = relative(watcherToolsPath, filePath);
  const pathParts = relativePath.split(/[\\/]/);
  const toolDir = pathParts[0];

  if (!toolDir || toolDir === '.' || toolDir === '..') return;

  const toolPath = join(watcherToolsPath, toolDir);
  const toolCacheKey = Array.from(toolsCache.keys()).find((key) => {
    const cachedTool = toolsCache.get(key);
    return cachedTool?.path === toolPath;
  });

  if (toolCacheKey) {
    toolsCache.delete(toolCacheKey);
  }
}

function scheduleInvalidation(filePath: string): void {
  if (debounceTimer) {
    clearTimeout(debounceTimer);
  }

  debounceTimer = setTimeout(() => {
    invalidateToolAtPath(filePath);
    debounceTimer = null;
  }, 100);
}

export function watchTools(
  toolsPath: string = getDefaultToolsPath(),
): void {
  if (watcher) {
    stopWatching();
  }

  const absoluteToolsPath = resolve(toolsPath);
  watcherToolsPath = absoluteToolsPath;

  try {
    watcher = watch(
      absoluteToolsPath,
      { recursive: true },
      (_event, filename) => {
        if (!filename) return;
        const filePath = join(absoluteToolsPath, filename);
        scheduleInvalidation(filePath);
      },
    );

    watcher.on('error', (err) => {
      console.warn(`Tool watcher error: ${err}`);
    });

  } catch (_e) {
    console.warn(`Failed to start tool watcher for: ${absoluteToolsPath}`);
    watcherToolsPath = null;
  }
}

export function stopWatching(): void {
  if (debounceTimer) {
    clearTimeout(debounceTimer);
    debounceTimer = null;
  }

  if (watcher) {
    watcher.close();
    watcher = null;
  }

  watcherToolsPath = null;
}

export async function scanTools(
  toolsPath: string = getDefaultToolsPath(),
): Promise<LoadedTool[]> {
  const tools: LoadedTool[] = [];
  const absoluteToolsPath = resolve(toolsPath);

  try {
    const entries = await readdir(absoluteToolsPath, { withFileTypes: true });

    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      if (entry.name.endsWith('.staging') || entry.name.endsWith('.previous'))
        continue;

      const toolDir = join(absoluteToolsPath, entry.name);
      const loaded = await loadToolModule(toolDir);

      if (loaded) {
        tools.push(loaded);
      }
    }
  } catch (_e) {
    console.warn(`Tools directory not found: ${absoluteToolsPath}`);
  }

  toolsCache.clear();
  for (const tool of tools) {
    toolsCache.set(tool.definition.name, tool);
  }
  lastScanTime = Date.now();

  return tools;
}

export async function getTool(name: string): Promise<LoadedTool | null> {
  if (Date.now() - lastScanTime < CACHE_TTL && toolsCache.has(name)) {
    return toolsCache.get(name) || null;
  }

  await scanTools();
  return toolsCache.get(name) || null;
}

export async function listTools(): Promise<ToolDefinition[]> {
  if (Date.now() - lastScanTime >= CACHE_TTL) {
    await scanTools();
  }

  return Array.from(toolsCache.values()).map((t) => t.definition);
}

export function clearCache(): void {
  toolsCache.clear();
  lastScanTime = 0;
}
