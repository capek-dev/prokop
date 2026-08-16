import type { Preconfig, PreconfigMode } from '@jean2/sdk';
import {
  listPreconfigs,
  getPreconfig,
  createPreconfig,
  updatePreconfig,
  deletePreconfig,
} from '@/core/preconfig';
import {
  firstUnknownSubagentId,
  knownSubagentIds,
} from '@/domains/agents';
import { getAllModels } from '@/config';
import {
  ConfigurationNotFoundError,
  ConfigurationValidationError,
  ConfigurationPersistenceError,
  ForbiddenDeleteError,
} from './errors';

export async function listValidatedPreconfigs(): Promise<Preconfig[]> {
  return listPreconfigs();
}

export async function createValidatedPreconfig(
  data: Omit<Preconfig, 'id'> & { id?: string },
  format?: 'json' | 'md'
): Promise<Preconfig> {
  const errors = validatePreconfigData(data);
  if (errors.length > 0) {
    throw new ConfigurationValidationError('Invalid preconfig data', errors);
  }

  const preconfig = await createPreconfig(data, format);

  const allPreconfigs = await listPreconfigs();
  const subagentValidationError = validateCanSpawnSubagentsForSet(allPreconfigs, preconfig);

  if (subagentValidationError) {
    await deletePreconfig(preconfig.id);
    throw new ConfigurationValidationError(subagentValidationError, [
      `canSpawnSubagents references unknown subagent: ${subagentValidationError}`,
    ]);
  }

  return preconfig;
}

export async function updateValidatedPreconfig(
  id: string,
  updates: Partial<Omit<Preconfig, 'id'>>
): Promise<Preconfig> {
  const existing = await getPreconfig(id);
  if (!existing) {
    throw new ConfigurationNotFoundError('Preconfig', id);
  }

  const mergedData = { ...existing, ...updates };
  const errors = validatePreconfigData(mergedData);
  if (errors.length > 0) {
    throw new ConfigurationValidationError('Invalid preconfig data', errors);
  }

  if (updates.canSpawnSubagents !== undefined && Array.isArray(updates.canSpawnSubagents)) {
    const allPreconfigs = await listPreconfigs();
    const proposedPreconfig = { ...existing, ...updates };
    const subagentValidationError = validateCanSpawnSubagentsForSet(allPreconfigs, proposedPreconfig);

    if (subagentValidationError) {
      throw new ConfigurationValidationError(subagentValidationError, [
        `canSpawnSubagents references unknown subagent: ${subagentValidationError}`,
      ]);
    }
  }

  if (updates.isDefault === true && !existing.isDefault) {
    const allPreconfigs = await listPreconfigs();
    const currentDefault = allPreconfigs.find(p => p.isDefault && p.id !== id);
    if (currentDefault) {
      errors.push(`Cannot set as default: "${currentDefault.name}" is already the default. Unset it first.`);
    }
    if (errors.length > 0) {
      throw new ConfigurationValidationError('Invalid preconfig data', errors);
    }
  }

  const updated = await updatePreconfig(id, updates);
  if (!updated) {
    throw new ConfigurationPersistenceError('Failed to update preconfig');
  }

  return updated;
}

export async function deleteValidatedPreconfig(id: string): Promise<void> {
  const existing = await getPreconfig(id);
  if (!existing) {
    throw new ConfigurationNotFoundError('Preconfig', id);
  }

  if (existing.isDefault) {
    throw new ForbiddenDeleteError(`Cannot delete default preconfig: ${id}`);
  }

  await deletePreconfig(id);
}

export function validatePreconfigData(data: Record<string, unknown>): string[] {
  const errors: string[] = [];

  if (data.id !== undefined && (typeof data.id !== 'string' || data.id.trim() === '')) {
    errors.push('id must be a non-empty string');
  }

  if (!data.name || typeof data.name !== 'string' || data.name.trim() === '') {
    errors.push('name must be a non-empty string');
  }

  if (data.description !== undefined && typeof data.description !== 'string') {
    errors.push('description must be a string');
  }

  if (data.systemPrompt !== undefined && typeof data.systemPrompt !== 'string') {
    errors.push('systemPrompt must be a string');
  }

  if (data.tools !== undefined && data.tools !== null && !Array.isArray(data.tools)) {
    errors.push('tools must be an array or null');
  }
  if (Array.isArray(data.tools) && !data.tools.every(t => typeof t === 'string')) {
    errors.push('tools must be an array of strings');
  }

  if (data.variant !== undefined && data.variant !== null && typeof data.variant !== 'string') {
    errors.push('variant must be a string or null');
  }

  if (data.settings !== undefined && data.settings !== null) {
    if (typeof data.settings !== 'object' || Array.isArray(data.settings)) {
      errors.push('settings must be a plain object or null');
    }
  }

  if (data.mode !== undefined) {
    const validModes: PreconfigMode[] = ['primary', 'subagent', 'both'];
    if (!validModes.includes(data.mode as PreconfigMode)) {
      errors.push(`mode must be one of: ${validModes.join(', ')}`);
    }
  }

  if (data.provider !== undefined && data.provider !== null && typeof data.provider !== 'string') {
    errors.push('provider must be a string or null');
  }

  if (data.model !== undefined && data.model !== null) {
    const modelError = validateModelReference(data.model as string);
    if (modelError) {
      errors.push(modelError);
    }
  }

  if (data.canSpawnSubagents !== undefined) {
    if (
      data.canSpawnSubagents !== null &&
      data.canSpawnSubagents !== true &&
      data.canSpawnSubagents !== false &&
      !Array.isArray(data.canSpawnSubagents)
    ) {
      errors.push('canSpawnSubagents must be a boolean, array, or null');
    }
  }

  if (data.allowSelfAsSubagent !== undefined && typeof data.allowSelfAsSubagent !== 'boolean') {
    errors.push('allowSelfAsSubagent must be a boolean');
  }

  if (data.skills !== undefined && data.skills !== null && !Array.isArray(data.skills)) {
    errors.push('skills must be an array or null');
  }
  if (Array.isArray(data.skills) && !data.skills.every(s => typeof s === 'string')) {
    errors.push('skills must be an array of strings');
  }

  return errors;
}

export function validateModelReference(modelId: string | null): string | null {
  if (modelId === null || modelId === undefined) {
    return null;
  }

  const allModels = getAllModels();
  const modelExists = allModels.some(m => m.id === modelId);

  if (!modelExists) {
    return `model "${modelId}" does not exist in current models configuration`;
  }

  return null;
}

function validateCanSpawnSubagentsForSet(
  allPreconfigs: Preconfig[],
  targetPreconfig: Preconfig
): string | null {
  if (!Array.isArray(targetPreconfig.canSpawnSubagents)) {
    return null;
  }

  const validSubagentIds = knownSubagentIds(allPreconfigs);

  return firstUnknownSubagentId(targetPreconfig.canSpawnSubagents, validSubagentIds);
}
