import { describe, expect, test } from 'bun:test';
import { createServer } from '../src/server';

describe('GET /:slug', () => {
  test('redirects to the target url', async () => {
    const server = createServer();
    server.store.create('docs123', 'https://example.com/docs', null);

    const response = await server.fetch(new Request('http://localhost/docs123'));
    expect(response.status).toBe(302);
    expect(response.headers.get('location')).toBe('https://example.com/docs');
  });

  test('counts clicks', async () => {
    const server = createServer();
    server.store.create('docs123', 'https://example.com/docs', null);

    await server.fetch(new Request('http://localhost/docs123'));
    await server.fetch(new Request('http://localhost/docs123'));
    expect(server.store.get('docs123')?.clicks).toBe(2);
  });

  test('returns 404 for unknown slugs', async () => {
    const response = await createServer().fetch(new Request('http://localhost/missing'));
    expect(response.status).toBe(404);
  });
});
