import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import type { AddressInfo } from 'node:net';
import { afterEach, beforeEach, describe, expect, test } from 'bun:test';

import { createStaticRequestHandler } from '@/infrastructure/runtime/client-static-server';

let distPath: string;
let server: http.Server;
let baseUrl: string;

beforeEach(async () => {
  distPath = fs.mkdtempSync(path.join(os.tmpdir(), 'jean2-server-static-'));
  fs.mkdirSync(path.join(distPath, 'assets'));
  fs.writeFileSync(path.join(distPath, 'index.html'), '<html>Jean2</html>');
  fs.writeFileSync(path.join(distPath, 'sw.js'), 'self.skipWaiting()');
  fs.writeFileSync(path.join(distPath, 'manifest.webmanifest'), '{}');
  fs.writeFileSync(path.join(distPath, 'assets', 'app-12345678.js'), 'export {};');

  server = http.createServer(createStaticRequestHandler(distPath));
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address() as AddressInfo;
  baseUrl = `http://127.0.0.1:${address.port}`;
});

afterEach(async () => {
  await new Promise<void>((resolve, reject) => {
    server.close((err) => err ? reject(err) : resolve());
  });
  fs.rmSync(distPath, { recursive: true, force: true });
});

describe('internal client static server', () => {
  test('serves hashed assets with immutable caching', async () => {
    const response = await fetch(`${baseUrl}/assets/app-12345678.js`);

    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toBe('application/javascript');
    expect(response.headers.get('cache-control')).toContain('immutable');
  });

  test('returns 404 for missing scripts and styles', async () => {
    const script = await fetch(`${baseUrl}/assets/missing.js`);
    const style = await fetch(`${baseUrl}/assets/missing.css`);

    expect(script.status).toBe(404);
    expect(style.status).toBe(404);
    expect(await script.text()).toBe('Not Found');
  });

  test('serves index.html for extensionless SPA routes', async () => {
    const response = await fetch(`${baseUrl}/sessions/example`, {
      headers: { Accept: 'text/html' },
    });

    expect(response.status).toBe(200);
    expect(await response.text()).toBe('<html>Jean2</html>');
  });

  test('recovers nested relative asset requests', async () => {
    const response = await fetch(`${baseUrl}/sessions/assets/app-12345678.js`);

    expect(response.status).toBe(200);
    expect(await response.text()).toBe('export {};');
  });

  test('requires revalidation for the application shell and worker files', async () => {
    const index = await fetch(`${baseUrl}/index.html`);
    const worker = await fetch(`${baseUrl}/sw.js`);
    const manifest = await fetch(`${baseUrl}/manifest.webmanifest`);

    expect(index.headers.get('cache-control')).toBe('no-cache');
    expect(worker.headers.get('cache-control')).toBe('no-cache');
    expect(manifest.headers.get('cache-control')).toBe('no-cache');
  });
});
