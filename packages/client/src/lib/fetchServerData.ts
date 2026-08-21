import { HttpClient, HttpNamespace } from '@prokopai/sdk';
import type { CriticalServerData, SecondaryServerData } from '@prokopai/sdk';

export type { CriticalServerData, SecondaryServerData };

export async function fetchCriticalServerData(
  serverUrl: string,
  apiToken?: string,
  signal?: AbortSignal,
): Promise<CriticalServerData> {
  const httpClient = new HttpClient({ url: serverUrl, ...(apiToken ? { token: apiToken } : {}) });
  const http = new HttpNamespace(httpClient);
  return http.loadCritical({ signal });
}

export async function fetchSecondaryServerData(
  serverUrl: string,
  apiToken?: string,
  signal?: AbortSignal,
): Promise<SecondaryServerData> {
  const httpClient = new HttpClient({ url: serverUrl, ...(apiToken ? { token: apiToken } : {}) });
  const http = new HttpNamespace(httpClient);
  return http.loadSecondary({ signal });
}
