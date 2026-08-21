import type { ClientDescriptor } from '@prokopai/sdk';
import { storage, STORAGE_KEYS } from '@/lib/storage';
import { getPlatform } from '@/lib/platform';

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

function clientTypeForPlatform(): ClientDescriptor['clientType'] {
  const platform = getPlatform();
  switch (platform) {
    case 'electron':
      return 'desktop';
    case 'web':
    case 'unknown':
    default:
      return 'web';
  }
}

export function getDisplayName(): string {
  const platform = getPlatform();
  switch (platform) {
    case 'electron':
      return 'Prokopai Desktop';
    case 'web':
    default:
      return 'Prokopai Web';
  }
}

export async function resolveClientDescriptor(): Promise<ClientDescriptor> {
  const clientId = await getOrCreateClientId();

  return {
    clientId,
    clientType: clientTypeForPlatform(),
    displayName: getDisplayName(),
    interactionMode: 'human',
    capabilities: [],
  };
}
