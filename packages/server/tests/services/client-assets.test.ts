import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  createClientAssetResponse,
  getClientAssetCacheControl,
  getClientAssetContentType,
  isClientSpaNavigation,
  resolveClientAssetPath,
} from '@/infrastructure/runtime/client-assets';

let root: string;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'prokop-client-assets-'));
  mkdirSync(join(root, 'assets'));
  writeFileSync(join(root, 'index.html'), '<html>Prokop</html>');
  writeFileSync(join(root, 'sw.js'), 'self.skipWaiting()');
  writeFileSync(join(root, 'manifest.webmanifest'), '{}');
  writeFileSync(join(root, 'assets', 'app-12345678.js'), 'export {};');
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

describe('embedded client assets', () => {
  test('serves files with their content type and cache policy', async () => {
    const response = await createClientAssetResponse(
      new Request('http://localhost/assets/app-12345678.js'),
      root,
    );

    expect(response?.status).toBe(200);
    expect(response?.headers.get('content-type')).toBe('application/javascript');
    expect(response?.headers.get('cache-control')).toBe('public, max-age=31536000, immutable');
    expect(await response?.text()).toBe('export {};');
  });

  test('serves the application shell for SPA navigation', async () => {
    const response = await createClientAssetResponse(
      new Request('http://localhost/sessions/example', {
        headers: { Accept: 'text/html' },
      }),
      root,
    );

    expect(response?.status).toBe(200);
    expect(response?.headers.get('cache-control')).toBe('no-cache');
    expect(await response?.text()).toBe('<html>Prokop</html>');
  });

  test('supports HEAD without returning a body', async () => {
    const response = await createClientAssetResponse(
      new Request('http://localhost/index.html', { method: 'HEAD' }),
      root,
    );

    expect(response?.status).toBe(200);
    expect(await response?.text()).toBe('');
  });

  test('does not use the SPA fallback for missing assets', async () => {
    const response = await createClientAssetResponse(
      new Request('http://localhost/assets/missing.js', {
        headers: { Accept: 'text/html' },
      }),
      root,
    );

    expect(response).toBeNull();
  });

  test('recovers asset requests produced by a relative client base', async () => {
    const response = await createClientAssetResponse(
      new Request('http://localhost/sessions/assets/app-12345678.js'),
      root,
    );

    expect(response?.status).toBe(200);
    expect(await response?.text()).toBe('export {};');
  });

  test('rejects paths outside the client root', () => {
    expect(resolveClientAssetPath(root, '../secret')).toBeNull();
    expect(resolveClientAssetPath(root, 'assets/../../secret')).toBeNull();
    expect(resolveClientAssetPath(root, '/etc/passwd')).toBeNull();
  });

  test('classifies cache, MIME, and navigation behavior', () => {
    expect(getClientAssetCacheControl('index.html')).toBe('no-cache');
    expect(getClientAssetCacheControl('sw.js')).toBe('no-cache');
    expect(getClientAssetCacheControl('manifest.webmanifest')).toBe('no-cache');
    expect(getClientAssetContentType('font.woff2')).toBe('font/woff2');
    expect(getClientAssetContentType('unknown.bin')).toBe('application/octet-stream');
    expect(isClientSpaNavigation(
      new Request('http://localhost/route', { headers: { Accept: 'text/html' } }),
      '/route',
    )).toBe(true);
    expect(isClientSpaNavigation(
      new Request('http://localhost/data', { headers: { Accept: 'application/json' } }),
      '/data',
    )).toBe(false);
  });
});
