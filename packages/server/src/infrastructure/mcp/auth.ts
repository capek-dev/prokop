import { readFile, writeFile, mkdir } from 'fs/promises';
import { getMcpAuthPath, getDataDir } from '@/infrastructure/runtime/paths';

export interface McpAuthTokens {
  accessToken: string;
  refreshToken?: string;
  expiresAt?: number;
  scope?: string;
}

export interface McpClientInfo {
  clientId: string;
  clientSecret?: string;
  clientIdIssuedAt?: number;
  clientSecretExpiresAt?: number;
}

export interface McpAuthEntry {
  tokens?: McpAuthTokens;
  clientInfo?: McpClientInfo;
  codeVerifier?: string;
  oauthState?: string;
  serverUrl?: string;
}

function getAuthFile(): string {
  return getMcpAuthPath();
}

async function ensureDir(): Promise<void> {
  try {
    await mkdir(getDataDir(), { recursive: true });
  } catch (_e) {
    // Directory exists
  }
}

async function readAuthFile(): Promise<Record<string, McpAuthEntry>> {
  try {
    const content = await readFile(getAuthFile(), 'utf-8');
    return JSON.parse(content) as Record<string, McpAuthEntry>;
  } catch (_e) {
    return {};
  }
}

async function writeAuthFile(data: Record<string, McpAuthEntry>): Promise<void> {
  await ensureDir();
  await writeFile(getAuthFile(), JSON.stringify(data, null, 2), { mode: 0o600 });
}

function getEntryKey(mcpName: string, serverUrl?: string): string {
  return serverUrl ? `${mcpName}::${serverUrl}` : mcpName;
}

export async function getAuth(mcpName: string): Promise<McpAuthEntry | undefined> {
  const data = await readAuthFile();
  return data[mcpName];
}

export async function getAuthForUrl(mcpName: string, serverUrl: string): Promise<McpAuthEntry | undefined> {
  const data = await readAuthFile();
  const key = getEntryKey(mcpName, serverUrl);
  return data[key];
}

export async function getAllAuth(): Promise<Record<string, McpAuthEntry>> {
  return readAuthFile();
}

export async function setAuth(mcpName: string, entry: McpAuthEntry, serverUrl?: string): Promise<void> {
  const data = await readAuthFile();
  const key = getEntryKey(mcpName, serverUrl);
  data[key] = entry;
  await writeAuthFile(data);
}

export async function removeAuth(mcpName: string): Promise<void> {
  const data = await readAuthFile();
  delete data[mcpName];
  
  // Also remove any URL-specific entries
  const keysToRemove = Object.keys(data).filter(k => k.startsWith(`${mcpName}::`));
  for (const key of keysToRemove) {
    delete data[key];
  }
  
  await writeAuthFile(data);
}

export async function updateTokens(mcpName: string, tokens: McpAuthTokens, serverUrl?: string): Promise<void> {
  const data = await readAuthFile();
  const key = getEntryKey(mcpName, serverUrl);
  const existing = data[key] || {};
  data[key] = { ...existing, tokens };
  await writeAuthFile(data);
}

export async function updateClientInfo(mcpName: string, clientInfo: McpClientInfo, serverUrl?: string): Promise<void> {
  const data = await readAuthFile();
  const key = getEntryKey(mcpName, serverUrl);
  const existing = data[key] || {};
  data[key] = { ...existing, clientInfo };
  await writeAuthFile(data);
}

export async function updateCodeVerifier(mcpName: string, codeVerifier: string): Promise<void> {
  const data = await readAuthFile();
  const existing = data[mcpName] || {};
  data[mcpName] = { ...existing, codeVerifier };
  await writeAuthFile(data);
}

export async function clearCodeVerifier(mcpName: string): Promise<void> {
  const data = await readAuthFile();
  const existing = data[mcpName];
  if (existing) {
    const { codeVerifier: _codeVerifier, ...rest } = existing;
    data[mcpName] = rest;
    await writeAuthFile(data);
  }
}

export async function updateOAuthState(mcpName: string, oauthState: string): Promise<void> {
  const data = await readAuthFile();
  const existing = data[mcpName] || {};
  data[mcpName] = { ...existing, oauthState };
  await writeAuthFile(data);
}

export async function getOAuthState(mcpName: string): Promise<string | undefined> {
  const data = await readAuthFile();
  return data[mcpName]?.oauthState;
}

export async function clearOAuthState(mcpName: string): Promise<void> {
  const data = await readAuthFile();
  const existing = data[mcpName];
  if (existing) {
    const { oauthState: _oauthState, ...rest } = existing;
    data[mcpName] = rest;
    await writeAuthFile(data);
  }
}

export async function isTokenExpired(mcpName: string): Promise<boolean | null> {
  const data = await readAuthFile();
  const entry = data[mcpName];
  
  if (!entry?.tokens?.expiresAt) {
    return null;
  }
  
  const now = Date.now();
  return now >= entry.tokens.expiresAt;
}
