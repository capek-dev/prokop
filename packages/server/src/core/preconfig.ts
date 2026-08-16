import { readdir, readFile, writeFile, unlink, mkdir, rename } from 'fs/promises';
import { join } from 'path';
import { existsSync } from 'fs';
import matter from 'gray-matter';
import type { Preconfig, PreconfigMode } from '@jean2/sdk';
import { getPreconfigsDir as getPreconfigsDirPath } from '@/paths';
import { knownSubagentIds, sanitizeCanSpawnSubagentsIds } from '@/domains/agents';
import { DEFAULT_PREAMBLES } from './defaults';

// ── Slug utilities ─────────────────────────────────────────────

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Check if a string looks like a UUID. */
function isUuid(str: string): boolean {
  return UUID_REGEX.test(str);
}

/**
 * Convert a preconfig name to a URL-safe kebab-case slug.
 * "Code Reviewer" → "code-reviewer"
 * "API v2 Tester!" → "api-v2-tester"
 */
function slugify(name: string): string {
  return name
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .replace(/-{2,}/g, '-');
}

/**
 * Generate a unique slug from a preconfig name, avoiding collisions with existing preconfigs.
 * If "code-reviewer" exists, returns "code-reviewer-2", then "code-reviewer-3", etc.
 */
export async function generatePreconfigSlug(name: string): Promise<string> {
  const base = slugify(name) || 'agent';
  const existing = await listPreconfigs();
  const existingIds = new Set(existing.map(p => p.id));

  if (!existingIds.has(base)) {
    return base;
  }

  let suffix = 2;
  while (existingIds.has(`${base}-${suffix}`)) {
    suffix++;
  }
  return `${base}-${suffix}`;
}

// ── Alias resolution ───────────────────────────────────────────

const ALIASES_FILENAME = 'preconfig_aliases.json';

function getAliasesPath(): string {
  return join(getPreconfigsDir(), ALIASES_FILENAME);
}

/**
 * Load the alias map: { oldId → newId }.
 * Created by the migration to keep old UUID references working.
 */
async function loadAliases(): Promise<Record<string, string>> {
  try {
    const content = await readFile(getAliasesPath(), 'utf-8');
    return JSON.parse(content) as Record<string, string>;
  } catch {
    return {};
  }
}

async function saveAliases(aliases: Record<string, string>): Promise<void> {
  await ensureDir();
  await writeFile(getAliasesPath(), JSON.stringify(aliases, null, 2));
}

/**
 * Resolve a preconfig ID through the alias map.
 * If the ID has been migrated (was a UUID, now a slug), returns the new slug.
 */
async function resolveAlias(id: string): Promise<string> {
  const aliases = await loadAliases();
  return aliases[id] ?? id;
}

// ── UUID migration ─────────────────────────────────────────────

/**
 * Scan preconfigs for UUID-named files and rename them to slugs.
 * Keeps old UUID as alias so existing references still resolve.
 * Safe to run repeatedly — skips non-UUID IDs and already-migrated files.
 */
export async function migrateUuidPreconfigs(): Promise<void> {
  await ensureDir();
  const aliases = await loadAliases();
  let migrated = 0;

  const all = await listPreconfigs();
  const existingIds = new Set(all.map(p => p.id));

  for (const preconfig of all) {
    if (!isUuid(preconfig.id)) continue;

    const newSlug = await generatePreconfigSlug(preconfig.name);

    // Ensure the slug doesn't collide with something else
    if (existingIds.has(newSlug) && newSlug !== preconfig.id) {
      console.warn(`[preconfig-migration] Slug "${newSlug}" already exists, keeping UUID for "${preconfig.id}"`);
      continue;
    }

    // Rename the file on disk
    const { md, json } = await preconfigExists(preconfig.id);
    const oldMdPath = getPreconfigMdPath(preconfig.id);
    const oldJsonPath = getPreconfigJsonPath(preconfig.id);
    const newMdPath = getPreconfigMdPath(newSlug);

    try {
      if (md) {
        await rename(oldMdPath, newMdPath);
      } else if (json) {
        await rename(oldJsonPath, newMdPath); // Normalize to .md
      }
    } catch (err) {
      console.error(`[preconfig-migration] Failed to rename "${preconfig.id}" → "${newSlug}"`, err);
      continue;
    }

    // Update the id field inside the file
    const updated = { ...preconfig, id: newSlug };
    await writeFile(newMdPath, serializePreconfigMd(updated));

    // Record the alias so old references still work
    aliases[preconfig.id] = newSlug;
    existingIds.delete(preconfig.id);
    existingIds.add(newSlug);
    migrated++;
    console.log(`[preconfig-migration] Renamed "${preconfig.id}" → "${newSlug}"`);
  }

  if (migrated > 0) {
    await saveAliases(aliases);
    console.log(`[preconfig-migration] Migrated ${migrated} preconfig(s) from UUID to slug`);
  }
}

function getPreconfigsDir(): string {
  return getPreconfigsDirPath();
}

async function ensureDir(): Promise<void> {
  if (existsSync(getPreconfigsDir())) {
    return;
  }
  await mkdir(getPreconfigsDir(), { recursive: true });
}

export function getPreconfigMdPath(id: string): string {
  return join(getPreconfigsDir(), `${id}.md`);
}

export function getPreconfigJsonPath(id: string): string {
  return join(getPreconfigsDir(), `${id}.json`);
}

export async function preconfigExists(id: string): Promise<{ md: boolean; json: boolean }> {
  await ensureDir();
  const mdPath = getPreconfigMdPath(id);
  const jsonPath = getPreconfigJsonPath(id);
  return {
    md: existsSync(mdPath),
    json: existsSync(jsonPath),
  };
}

function parsePreconfigMd(content: string): Preconfig {
  const { data, content: body } = matter(content);

  return {
    id: data.id || '',
    name: data.name || '',
    description: data.description || '',
    systemPrompt: body.trim(),
    tools: data.tools ?? null,
    model: data.model ?? null,
    provider: data.provider ?? null,
    variant: data.variant ?? null,
    settings: data.settings ?? null,
    isDefault: data.isDefault ?? false,
    mode: data.mode,
    canSpawnSubagents: data.canSpawnSubagents,
    allowSelfAsSubagent: data.allowSelfAsSubagent ?? false,
    skills: data.skills ?? null,
  };
}

/**
 * Validate canSpawnSubagents arrays against known subagent IDs.
 * This is a post-processing step to avoid circular dependencies. The
 * subagent-target classification and id sanitization rules live in the
 * agents domain (`@/domains/agents`); this caller keeps its pre-S4
 * reaction: warn about unknown ids, filter them, and disable spawning when
 * no valid ids remain.
 */
async function validatePreconfigs(preconfigs: Preconfig[]): Promise<Preconfig[]> {
  // Build a set of known subagent IDs from the preconfigs list
  const knownSubagentIdsSet = knownSubagentIds(preconfigs);

  // Validate each preconfig's canSpawnSubagents array
  for (const preconfig of preconfigs) {
    if (Array.isArray(preconfig.canSpawnSubagents)) {
      const { validIds, invalidIds } = sanitizeCanSpawnSubagentsIds(
        preconfig.canSpawnSubagents,
        knownSubagentIdsSet,
      );
      for (const id of invalidIds) {
        console.warn(`[preconfig] Unknown subagent ID "${id}" in canSpawnSubagents for "${preconfig.id}"`);
      }

      if (validIds.length === 0) {
        console.warn(`[preconfig] canSpawnSubagents for "${preconfig.id}" has no valid IDs, disabling subagent spawning`);
        preconfig.canSpawnSubagents = false;
      } else if (validIds.length !== preconfig.canSpawnSubagents.length) {
        preconfig.canSpawnSubagents = validIds;
      }
    }
  }

  return preconfigs;
}

function serializePreconfigMd(preconfig: Preconfig): string {
  const { id: _id, systemPrompt, ...frontmatterData } = preconfig;
  const frontmatter = Object.fromEntries(
    Object.entries(frontmatterData).filter(([, v]) => v !== undefined)
  );
  return matter.stringify(systemPrompt || '', frontmatter);
}

function getDefaultPreamble(id: string): string | null {
  return DEFAULT_PREAMBLES[id] || null;
}

export async function initializePreconfigs(): Promise<void> {
  await ensureDir();

  let installed = 0;

  // Check and install each default preconfig individually
  for (const defaultId of Object.keys(DEFAULT_PREAMBLES)) {
    const { md, json } = await preconfigExists(defaultId);

    if (!md && !json) {
      const preamble = getDefaultPreamble(defaultId);
      if (preamble) {
        const mdPath = getPreconfigMdPath(defaultId);
        await writeFile(mdPath, preamble);
        installed++;
      }
    }
  }



  if (installed > 0) {
    console.log(`Installed ${installed} default preconfig(s)`);
  }
}

export async function listPreconfigs(): Promise<Preconfig[]> {
  await ensureDir();

  const files = await readdir(getPreconfigsDir()).catch(() => []);
  const mdFiles = files.filter(f => f.endsWith('.md'));
  const jsonFiles = files.filter(f => f.endsWith('.json'));

  // Create a set of ids that have .md files (for precedence check)
  const mdIds = new Set(mdFiles.map(f => f.replace(/\.md$/, '')));

  const preconfigs: Preconfig[] = [];

  // Parse .md files first
  for (const file of mdFiles) {
    try {
      const content = await readFile(join(getPreconfigsDir(), file), 'utf-8');
      const parsed = parsePreconfigMd(content);
      const id = parsed.id || file.replace(/\.md$/, '');
      preconfigs.push({ ...parsed, id });
    } catch (e) {
      console.error(`Failed to read preconfig ${file}:`, e);
    }
  }

  // Parse .json files, but skip if corresponding .md exists
  for (const file of jsonFiles) {
    const id = file.replace(/\.json$/, '');
    if (mdIds.has(id)) {
      continue; // .md takes precedence
    }
    try {
      const content = await readFile(join(getPreconfigsDir(), file), 'utf-8');
      const parsed = JSON.parse(content) as Preconfig;
      preconfigs.push({ ...parsed, allowSelfAsSubagent: parsed.allowSelfAsSubagent ?? false });
    } catch (e) {
      console.error(`Failed to read preconfig ${file}:`, e);
    }
  }

  // Validate canSpawnSubagents arrays against known subagent IDs
  const validated = await validatePreconfigs(preconfigs);

  return validated.sort((a, b) => {
    if (a.isDefault) return -1;
    if (b.isDefault) return 1;
    return a.name.localeCompare(b.name);
  });
}

export async function getPreconfig(id: string): Promise<Preconfig | null> {
  await ensureDir();

  // Resolve through alias map first (handles migrated UUID → slug)
  const resolvedId = await resolveAlias(id);

  // Check for .md first (precedence)
  const mdPath = getPreconfigMdPath(resolvedId);
  if (existsSync(mdPath)) {
    try {
      const content = await readFile(mdPath, 'utf-8');
      const parsed = parsePreconfigMd(content);
      return { ...parsed, id: resolvedId };
    } catch (_e) {
      return null;
    }
  }

  // Fall back to .json
  const jsonPath = getPreconfigJsonPath(resolvedId);
  try {
    const content = await readFile(jsonPath, 'utf-8');
    const parsed = JSON.parse(content) as Preconfig;
    return { ...parsed, allowSelfAsSubagent: parsed.allowSelfAsSubagent ?? false };
  } catch (_e) {
    return null;
  }
}

export async function createPreconfig(
  preconfig: Omit<Preconfig, 'id'> & { id?: string },
  format?: 'json' | 'md'
): Promise<Preconfig> {
  await ensureDir();

  // Generate a human-readable slug from the name unless an explicit ID is provided
  const id = preconfig.id || await generatePreconfigSlug(preconfig.name);

  const newPreconfig: Preconfig = {
    ...preconfig,
    id,
    allowSelfAsSubagent: preconfig.allowSelfAsSubagent ?? false,
  };

  if (format === 'md') {
    await writeFile(getPreconfigMdPath(newPreconfig.id), serializePreconfigMd(newPreconfig));
  } else {
    await writeFile(
      getPreconfigJsonPath(newPreconfig.id),
      JSON.stringify(newPreconfig, null, 2)
    );
  }

  return newPreconfig;
}

export async function updatePreconfig(
  id: string,
  updates: Partial<Omit<Preconfig, 'id'>>
): Promise<Preconfig | null> {
  const existing = await getPreconfig(id);
  if (!existing) return null;

  const updated: Preconfig = {
    ...existing,
    ...updates,
    id, // Ensure id is not changed
  };

  const { md, json } = await preconfigExists(id);

  if (md) {
    await writeFile(getPreconfigMdPath(id), serializePreconfigMd(updated));
  } else if (json) {
    await writeFile(
      getPreconfigJsonPath(id),
      JSON.stringify(updated, null, 2)
    );
  }

  return updated;
}

export async function deletePreconfig(id: string): Promise<boolean> {
  const { md, json } = await preconfigExists(id);

  if (md) {
    try {
      await unlink(getPreconfigMdPath(id));
      return true;
    } catch (_e) {
      return false;
    }
  }

  if (json) {
    try {
      await unlink(getPreconfigJsonPath(id));
      return true;
    } catch (_e) {
      return false;
    }
  }

  return false;
}

export async function getDefaultPreconfig(): Promise<Preconfig | null> {
  const preconfigs = await listPreconfigs();
  return preconfigs.find(p => p.isDefault) || preconfigs[0] || null;
}

/**
 * List preconfigs filtered by mode
 */
export async function listPreconfigsByMode(mode?: PreconfigMode): Promise<Preconfig[]> {
  const preconfigs = await listPreconfigs();

  if (!mode) return preconfigs;

  return preconfigs.filter(p => {
    const preconfigMode = p.mode ?? 'primary';
    return preconfigMode === mode;
  });
}

/**
 * List only subagent preconfigs (includes 'both' mode agents)
 */
export async function listSubagentPreconfigs(): Promise<Preconfig[]> {
  const preconfigs = await listPreconfigs();
  return preconfigs.filter(p => {
    const mode = p.mode ?? 'primary';
    return mode === 'subagent' || mode === 'both';
  });
}

/**
 * List only primary preconfigs - user-facing (includes 'both' mode agents)
 */
export async function listPrimaryPreconfigs(): Promise<Preconfig[]> {
  const preconfigs = await listPreconfigs();
  return preconfigs.filter(p => {
    const mode = p.mode ?? 'primary';
    return mode === 'primary' || mode === 'both';
  });
}

/**
 * Get available subagent types for Task tool
 */
export async function getAvailableSubagentTypes(): Promise<string[]> {
  const subagents = await listSubagentPreconfigs();
  return subagents.map(s => s.id);
}
