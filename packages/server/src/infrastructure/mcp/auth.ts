import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { getMcpAuthPath, getDataDir } from '@/infrastructure/runtime/paths';

export interface McpAuthTokens { accessToken: string; refreshToken?: string; expiresAt?: number; scope?: string }
export interface McpClientInfo {
  clientId: string;
  clientSecret?: string;
  redirectUri?: string;
  tokenEndpointAuthMethod?: string;
  clientIdIssuedAt?: number;
  clientSecretExpiresAt?: number;
}
export interface McpAuthEntry { tokens?: McpAuthTokens; clientInfo?: McpClientInfo; serverUrl?: string }
let pending: Promise<unknown> = Promise.resolve();

async function read(): Promise<Record<string, McpAuthEntry>> {
  try {
    const data: unknown = JSON.parse(await readFile(getMcpAuthPath(), 'utf8'));
    if (!data || typeof data !== 'object' || Array.isArray(data)) throw new Error('Invalid credential file');
    return data as Record<string, McpAuthEntry>;
  } catch (error: unknown) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return {};
    throw new Error('Unable to read MCP credentials', { cause: error });
  }
}
async function mutate(change: (data: Record<string, McpAuthEntry>) => void): Promise<void> {
  const next = pending.catch(() => {}).then(async () => {
    const data = await read();
    change(data);
    await mkdir(getDataDir(), { recursive: true });
    const path = getMcpAuthPath();
    const temporary = path + '.' + crypto.randomUUID() + '.tmp';
    await writeFile(temporary, JSON.stringify(data), { mode: 0o600, flag: 'wx' });
    await rename(temporary, path);
  });
  pending = next;
  await next;
}
const key = (name: string, url: string): string => JSON.stringify([name, url]);
export async function getAuthForUrl(name: string, url: string): Promise<McpAuthEntry | undefined> {
  await pending.catch(() => {});
  return (await read())[key(name, url)];
}
export async function setAuth(name: string, entry: McpAuthEntry, url: string): Promise<void> {
  await mutate(data => { data[key(name, url)] = entry; });
}
export async function removeAuth(name: string): Promise<void> {
  await mutate(data => {
    for (const entry of Object.keys(data)) {
      try { if (JSON.parse(entry)[0] === name) delete data[entry]; } catch { /* Legacy entries remain isolated. */ }
    }
  });
}
export async function updateTokens(name: string, tokens: McpAuthTokens, url: string): Promise<void> {
  await mutate(data => { const id = key(name, url); data[id] = { ...data[id], tokens }; });
}
export async function updateClientInfo(name: string, clientInfo: McpClientInfo, url: string): Promise<void> {
  await mutate(data => { const id = key(name, url); data[id] = { ...data[id], clientInfo }; });
}
