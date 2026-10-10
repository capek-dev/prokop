import { describe, expect, test } from 'bun:test';
import { createServer } from '../src/server';

function post(body: unknown) {
  return new Request('http://localhost/api/links', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

describe('POST /api/links', () => {
  test('creates a link with a 7 character slug', async () => {
    const response = await createServer().fetch(post({ url: 'https://example.com/docs' }));
    expect(response.status).toBe(201);
    const link = await response.json();
    expect(link.slug).toHaveLength(7);
    expect(link.expiresAt).toBeNull();
  });

  test('rejects non-http urls', async () => {
    const response = await createServer().fetch(post({ url: 'javascript:alert(1)' }));
    expect(response.status).toBe(400);
  });

  test('stores an expiry when ttlDays is set', async () => {
    const response = await createServer().fetch(post({ url: 'https://example.com', ttlDays: 7 }));
    const link = await response.json();
    expect(link.expiresAt).toBeGreaterThan(Date.now());
  });
});
