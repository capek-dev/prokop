import { existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from 'fs';
import { getProviderPath, getProvidersDir } from '@/infrastructure/runtime/paths';

function ensureProvidersDir(): string {
  const dir = getProvidersDir();
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true, mode: 0o700 });
  }
  return dir;
}

export function loadProviderConfig<T = unknown>(provider: string): T | null {
  const path = getProviderPath(provider);
  if (!existsSync(path)) return null;

  try {
    return JSON.parse(readFileSync(path, 'utf-8')) as T;
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`Failed to load provider config for ${provider}:`, message);
    return null;
  }
}

export function saveProviderConfig(provider: string, config: unknown): void {
  ensureProvidersDir();
  writeFileSync(getProviderPath(provider), JSON.stringify(config, null, 2), { mode: 0o600 });
}

export function deleteProviderConfig(provider: string): boolean {
  const path = getProviderPath(provider);
  if (!existsSync(path)) return false;

  try {
    unlinkSync(path);
    return true;
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`Failed to delete provider config for ${provider}:`, message);
    return false;
  }
}
