import { readEnv, readEnvInt } from '@/infrastructure/runtime/env-compat';

export interface OpenClientResult {
  opened: boolean;
  url: string;
}

export function getClientUrl(): string {
  const port = readEnvInt('PORT', 8742);
  const tlsEnabled = readEnv('TLS_ENABLED') === 'true';
  const localEnabled = tlsEnabled && readEnv('LOCAL_HTTP') !== 'false';

  if (localEnabled) {
    return `http://${readEnv('LOCAL_HOST') || '127.0.0.1'}:${port}`;
  }

  return `${tlsEnabled ? 'https' : 'http'}://localhost:${port}`;
}

export async function waitForClient(url: string, timeoutMs = 10_000): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    try {
      await fetch(url, { signal: AbortSignal.timeout(500) });
      return true;
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
  }

  return false;
}

export function openClient(): OpenClientResult {
  const url = getClientUrl();
  console.log(`Opening ${url} ...`);

  try {
    const command = process.platform === 'darwin'
      ? 'open'
      : process.platform === 'win32'
        ? 'cmd'
        : 'xdg-open';
    const args = process.platform === 'win32'
      ? ['/c', 'start', url]
      : [url];
    Bun.spawn([command, ...args], { detached: true });
    return { opened: true, url };
  } catch {
    console.log(`Could not open browser. Open manually: ${url}`);
    return { opened: false, url };
  }
}
