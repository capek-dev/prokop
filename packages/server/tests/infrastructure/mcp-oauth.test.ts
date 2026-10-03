import { afterEach, beforeEach, expect, test } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { Paths } from '@/infrastructure/runtime/paths';
import { createMcpManager } from '@/infrastructure/mcp/manager';

let root: string;
let manager: ReturnType<typeof createMcpManager> | undefined;
beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'mcp-oauth-'));
  Paths.configure({ dataDir: join(root, 'data') });
});
afterEach(async () => {
  await manager?.shutdownWorkspace(root); manager = undefined;
  Paths.reset();
  await rm(root, { recursive: true, force: true });
});

test('OAuth uses PKCE and single-use state, exchanges the code, and reconnects with a usable client', async () => {
  let expectedChallenge = '';
  let exchanges = 0;
  const registeredRedirects: string[] = [];
  const base = 'https://mcp.test';
  manager = createMcpManager(async (url, init) => {
      const request = new Request(String(url), init);
      const path = new URL(request.url).pathname;
      if (path.startsWith('/.well-known/oauth-protected-resource')) return Response.json({
        resource: base + '/mcp', authorization_servers: [base], scopes_supported: ['records'],
      });
      if (path.startsWith('/.well-known/oauth-authorization-server') || path.startsWith('/.well-known/openid-configuration')) {
        return Response.json({ issuer: base, authorization_endpoint: base + '/authorize', token_endpoint: base + '/token',
          registration_endpoint: base + '/register', response_types_supported: ['code'],
          grant_types_supported: ['authorization_code', 'refresh_token'], code_challenge_methods_supported: ['S256'] });
      }
      if (path === '/register') {
        const metadata = await request.json() as Record<string, unknown>;
        registeredRedirects.push(...metadata.redirect_uris as string[]);
        return Response.json({ ...metadata, client_id: 'fixture-client' }, { status: 201 });
      }
      if (path === '/token') {
        const body = new URLSearchParams(await request.text());
        if (body.get('code') !== 'valid-code' || createHash('sha256').update(body.get('code_verifier') ?? '').digest('base64url') !== expectedChallenge) {
          return Response.json({ error: 'invalid_grant' }, { status: 400 });
        }
        exchanges++;
        return Response.json({ access_token: 'fixture-token', token_type: 'Bearer', expires_in: 3600 });
      }
      if (path === '/mcp') {
        if (request.headers.get('authorization') !== 'Bearer fixture-token') {
          return new Response(null, { status: 401, headers: {
            'WWW-Authenticate': 'Bearer resource_metadata="' + base + '/.well-known/oauth-protected-resource", scope="records"',
          } });
        }
        if (request.method !== 'POST') return new Response(null, { status: 405 });
        const message = await request.json() as { id?: number; method: string; params?: { protocolVersion?: string } };
        if (message.id === undefined) return new Response(null, { status: 202 });
        const result = message.method === 'initialize'
          ? { protocolVersion: message.params?.protocolVersion, serverInfo: { name: 'oauth-fixture', version: '1' }, capabilities: { tools: {} } }
          : message.method === 'tools/list'
            ? { tools: [{ name: 'read_records', inputSchema: { type: 'object', properties: {} } }] }
            : { content: [{ type: 'text', text: 'Authenticated result' }] };
        return Response.json({ jsonrpc: '2.0', id: message.id, result });
      }
      return new Response(null, { status: 404 });
  });
  const { saveServer, startAuth, finishAuth, getWorkspaceTools, shutdownWorkspace } = manager;
  await saveServer(root, 'crm', { type: 'remote', url: base + '/mcp', timeout: 2000 });
  expect(registeredRedirects).toEqual([]);
  const { authorizationUrl } = await startAuth(root, 'crm', 'http://127.0.0.1:9999/api/mcp/oauth/callback');
  const authorization = new URL(authorizationUrl);
  expect(authorization.pathname).toBe('/authorize');
  expect(registeredRedirects).toEqual(['http://127.0.0.1:9999/api/mcp/oauth/callback']);
  expect(authorization.searchParams.get('redirect_uri')).toBe('http://127.0.0.1:9999/api/mcp/oauth/callback');
  expect(authorization.searchParams.get('code_challenge_method')).toBe('S256');
  expectedChallenge = authorization.searchParams.get('code_challenge')!;
  const state = authorization.searchParams.get('state')!;
  expect(state).toBeTruthy();
  await expect(finishAuth('wrong-state', 'valid-code')).rejects.toThrow('invalid');
  await expect(finishAuth(state, 'valid-code', { path: root, name: 'different-server' })).rejects.toThrow('does not belong');
  expect((await finishAuth(state, 'valid-code')).status.status).toBe('connected');
  expect(exchanges).toBe(1);
  const tools = await getWorkspaceTools(root);
  expect(tools).toHaveLength(1);
  expect((await tools[0]!.execute({})).content[0]?.text).toBe('Authenticated result');
  await expect(finishAuth(state, 'valid-code')).rejects.toThrow('invalid');
  expect(exchanges).toBe(1);
  await shutdownWorkspace(root);
  expect(await getWorkspaceTools(root)).toHaveLength(1);
  const other = join(root, 'other-workspace');
  try {
    await saveServer(other, 'crm', { type: 'remote', url: base + '/mcp', timeout: 2000 });
    expect((await manager.getAllServerStatus(other)).crm?.status.status).toBe('needs_auth');
    const pending = await startAuth(other, 'crm', 'http://127.0.0.1:9999/api/mcp/oauth/callback');
    const otherState = new URL(pending.authorizationUrl).searchParams.get('state')!;
    await saveServer(other, 'crm', { type: 'remote', url: base + '/mcp', enabled: false, timeout: 2000 });
    await expect(finishAuth(otherState, 'valid-code')).rejects.toThrow('invalid');
    expect(exchanges).toBe(1);
  } finally { await shutdownWorkspace(other); }
}, 15_000);
