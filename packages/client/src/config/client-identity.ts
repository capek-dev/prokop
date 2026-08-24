import type { ClientDescriptor } from '@prokopai/sdk';
import { storage, STORAGE_KEYS } from '@/lib/storage';

function generateClientId(): string {
  return crypto.randomUUID();
}

async function getOrCreateClientId(): Promise<string> {
  const existing = await storage.get<string>(STORAGE_KEYS.CLIENT_ID);
  if (existing) return existing;

  const newId = generateClientId();
  await storage.set(STORAGE_KEYS.CLIENT_ID, newId);
  return newId;
}

export function getDisplayName(): string {
  return 'Prokopai Web';
}

export async function resolveClientDescriptor(): Promise<ClientDescriptor> {
  const clientId = await getOrCreateClientId();

  return {
    clientId,
    clientType: 'web',
    displayName: getDisplayName(),
    interactionMode: 'human',
    capabilities: [],
  };
}
