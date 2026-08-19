import type { PromptInfo, CreatePromptRequest, UpdatePromptRequest } from '@jean2/sdk';
import { join } from 'path';
import { unlink } from 'fs/promises';
import { listPrompts, getPrompt, clearPromptsCache, parsePromptFile } from '@/config/prompts-registry';
import { atomicWriteFile } from './files';
import {
  ConfigurationValidationError,
  ConfigurationNotFoundError,
  ConfigurationConflictError,
  ConfigurationPersistenceError,
} from './errors';
import { getPromptsDir } from '@/infrastructure/runtime/paths';

function getPromptsDirPath(): string {
  return getPromptsDir();
}

const PROMPT_NAME_PATTERN = /^[a-z0-9][a-z0-9-]*[a-z0-9]$|^[a-z0-9]$/;

function isValidPromptName(name: string): boolean {
  if (!name || typeof name !== 'string') return false;
  if (name.length > 100) return false;
  if (!PROMPT_NAME_PATTERN.test(name)) return false;
  if (name.includes('..')) return false;
  if (name.includes('/') || name.includes('\\')) return false;
  return true;
}

export async function listPromptConfigs(): Promise<PromptInfo[]> {
  return listPrompts();
}

export async function getPromptConfig(name: string): Promise<PromptInfo> {
  const prompt = await getPrompt(name);
  if (!prompt) {
    throw new ConfigurationNotFoundError('Prompt', name);
  }
  return prompt;
}

export async function createPromptConfig(data: CreatePromptRequest): Promise<PromptInfo> {
  if (!isValidPromptName(data.name)) {
    throw new ConfigurationValidationError(`Invalid prompt name: ${data.name}`);
  }

  if (!data.content || typeof data.content !== 'string' || data.content.trim() === '') {
    throw new ConfigurationValidationError('Prompt content is required');
  }

  const existing = await listPrompts();
  if (existing.some(p => p.name === data.name)) {
    throw new ConfigurationConflictError(`Prompt already exists: ${data.name}`);
  }

  const filePath = join(getPromptsDirPath(), `${data.name}.md`);

  try {
    await atomicWriteFile(filePath, data.content);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    throw new ConfigurationPersistenceError(`Failed to create prompt: ${message}`);
  }

  clearPromptsCache();
  return parsePromptFile(data.content, data.name);
}

export async function updatePromptConfig(name: string, data: UpdatePromptRequest): Promise<PromptInfo> {
  if (!isValidPromptName(name)) {
    throw new ConfigurationValidationError(`Invalid prompt name: ${name}`);
  }

  if (!data.content || typeof data.content !== 'string' || data.content.trim() === '') {
    throw new ConfigurationValidationError('Prompt content is required');
  }

  const existing = await getPrompt(name);
  if (!existing) {
    throw new ConfigurationNotFoundError('Prompt', name);
  }

  const filePath = join(getPromptsDirPath(), `${name}.md`);

  try {
    await atomicWriteFile(filePath, data.content);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    throw new ConfigurationPersistenceError(`Failed to update prompt: ${message}`);
  }

  clearPromptsCache();
  return parsePromptFile(data.content, name);
}

export async function deletePromptConfig(name: string): Promise<void> {
  if (!isValidPromptName(name)) {
    throw new ConfigurationValidationError(`Invalid prompt name: ${name}`);
  }

  const existing = await getPrompt(name);
  if (!existing) {
    throw new ConfigurationNotFoundError('Prompt', name);
  }

  const filePath = join(getPromptsDirPath(), `${name}.md`);

  try {
    await unlink(filePath);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    throw new ConfigurationPersistenceError(`Failed to delete prompt: ${message}`);
  }

  clearPromptsCache();
}
