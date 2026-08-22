import { AsyncLocalStorage } from 'node:async_hooks';
import { readdir } from 'fs/promises';
import { existsSync } from 'fs';
import { watch } from 'fs';
import { basename, dirname, join, resolve, relative } from 'path';
import type { ToolDefinition } from '@capekai/tool'
import { LoadedTool } from '@capekai/tool';
import { readInstallManifest } from './install-manifest';

export interface ToolRegistryResolver {
  get(name: string): LoadedTool | null;
  list(): LoadedTool[];
}

const toolsCache: Map<string, LoadedTool> = new Map();
const scopedResolver = new AsyncLocalStorage<ToolRegistryResolver>();
let lastScanTime = 0;
const CACHE_TTL = 60000;

let watcher: ReturnType<typeof watch> | null = null;
let debounceTimer: ReturnType<typeof setTimeout> | null = null;
let watcherToolsPath: string | null = null;
let defaultToolsPath: string | null = null;

export function withToolRegistryResolver<T>(resolver: ToolRegistryResolver, callback: () => T): T {
  return scopedResolver.run(resolver, callback);
}

/** True when an ambient scoped tool resolver is installed. The legacy
 * unscoped execution path keeps its unconditional builtin-tool injection;
 * scoped compositions resolve every tool, including retrieve-tool-output,
 * through their resolver instead. */
export function hasScopedToolRegistryResolver(): boolean {
  return scopedResolver.getStore() !== undefined;
}

export function configureToolsPath(path?: string): void {
  defaultToolsPath = path ? resolve(path) : null;
  clearCache();
}

function getDefaultToolsPath(): string | null {
  return defaultToolsPath;
}

export async function loadToolModule(toolDir: string): Promise<LoadedTool | null> {
  const toolName = basename(toolDir);
  const toolsBasePath = dirname(toolDir);
  const manifest = readInstallManifest(toolsBasePath, toolName);
  let modulePath: string | null = null;

  if (manifest?.entry) {
    const manifestEntryPath = join(toolDir, manifest.entry);
    if (existsSync(manifestEntryPath)) modulePath = manifestEntryPath;
  }

  if (!modulePath) {
    const toolJsPath = join(toolDir, 'tool.js');
    const toolTsPath = join(toolDir, 'tool.ts');
    if (existsSync(toolJsPath)) modulePath = toolJsPath;
    else if (existsSync(toolTsPath)) modulePath = toolTsPath;
  }

  if (!modulePath) return null;

  try {
    const module = await import(modulePath);
    if (!module.definition || typeof module.execute !== 'function') {
      console.warn(`Tool at ${toolDir} missing required exports (definition, execute)`);
      return null;
    }
    const definition: ToolDefinition = module.definition;
    if (!definition.name || !definition.inputSchema) {
      console.warn(`Tool at ${toolDir} has invalid definition (missing name or inputSchema)`);
      return null;
    }
    return { definition, execute: module.execute, path: toolDir };
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    if (message.includes('Cannot find module')) console.warn(`Tool at ${toolDir} has missing dependencies: ${message}`);
    else if (message.includes('SyntaxError') || message.includes('Unexpected')) console.warn(`Tool at ${toolDir} has a syntax/load error: ${message}`);
    else console.warn(`Failed to load tool module at ${toolDir}:`, error);
    return null;
  }
}

function invalidateToolAtPath(filePath: string): void {
  if (!watcherToolsPath) return;
  const relativePath = relative(watcherToolsPath, filePath);
  const toolDir = relativePath.split(/[\\/]/)[0];
  if (!toolDir || toolDir === '.' || toolDir === '..') return;
  const toolPath = join(watcherToolsPath, toolDir);
  const key = [...toolsCache.keys()].find((name) => toolsCache.get(name)?.path === toolPath);
  if (key) toolsCache.delete(key);
}

function scheduleInvalidation(filePath: string): void {
  if (debounceTimer) clearTimeout(debounceTimer);
  debounceTimer = setTimeout(() => {
    invalidateToolAtPath(filePath);
    debounceTimer = null;
  }, 100);
}

export function watchTools(toolsPath: string | null = getDefaultToolsPath()): void {
  if (!toolsPath) return;
  if (watcher) stopWatching();
  const absoluteToolsPath = resolve(toolsPath);
  watcherToolsPath = absoluteToolsPath;
  try {
    watcher = watch(absoluteToolsPath, { recursive: true }, (_event, filename) => {
      if (filename) scheduleInvalidation(join(absoluteToolsPath, filename));
    });
    watcher.on('error', (error) => console.warn(`Tool watcher error: ${error}`));
  } catch {
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

export async function scanTools(toolsPath: string | null = getDefaultToolsPath()): Promise<LoadedTool[]> {
  const tools: LoadedTool[] = [];
  if (toolsPath) {
    const absoluteToolsPath = resolve(toolsPath);
    try {
      const entries = await readdir(absoluteToolsPath, { withFileTypes: true });
      for (const entry of entries) {
        if (!entry.isDirectory() || entry.name.endsWith('.staging') || entry.name.endsWith('.previous')) continue;
        const loaded = await loadToolModule(join(absoluteToolsPath, entry.name));
        if (loaded) tools.push(loaded);
      }
    } catch {
      console.warn(`Tools directory not found: ${absoluteToolsPath}`);
    }
  }

  toolsCache.clear();
  for (const loaded of tools) toolsCache.set(loaded.definition.name, loaded);
  lastScanTime = Date.now();
  return tools;
}

let ensureScannedPromise: Promise<void> | null = null;

function ensureScanned(): Promise<void> {
  if (Date.now() - lastScanTime < CACHE_TTL) return Promise.resolve();
  if (ensureScannedPromise === null) {
    ensureScannedPromise = scanTools().then(() => undefined).finally(() => {
      ensureScannedPromise = null;
    });
  }
  return ensureScannedPromise;
}

export async function getTool(name: string): Promise<LoadedTool | null> {
  const resolver = scopedResolver.getStore();
  if (resolver) return resolver.get(name);
  await ensureScanned();
  return toolsCache.get(name) ?? null;
}

export async function listTools(): Promise<ToolDefinition[]> {
  const resolver = scopedResolver.getStore();
  if (resolver) return resolver.list().map((loaded) => loaded.definition);
  await ensureScanned();
  return [...toolsCache.values()].map((loaded) => loaded.definition);
}

/** Synchronous cache read of one installed tool. Ignores any ambient
 * scoped resolver: this is the dir-scan branch of `getTool`, for
 * resolver implementations that layer installed tools beneath their
 * own contributions. Returns null when the cache has not been scanned
 * (or the name is unknown); callers own ensuring a scan happened. */
export function getInstalledTool(name: string): LoadedTool | null {
  return toolsCache.get(name) ?? null;
}

/** Synchronous snapshot of the installed-tools cache. Ignores any
 * ambient scoped resolver, like `getInstalledTool`. Empty when the
 * cache has not been scanned. */
export function listInstalledTools(): LoadedTool[] {
  return [...toolsCache.values()];
}

/** True when the installed-tools cache is empty because no scan has
 * run yet (as opposed to a genuinely empty tools directory). */
export function hasUnscannedToolCache(): boolean {
  return lastScanTime === 0;
}

export function clearCache(): void {
  toolsCache.clear();
  lastScanTime = 0;
}
