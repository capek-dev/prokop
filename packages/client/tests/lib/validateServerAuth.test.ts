import { describe, expect, test } from 'vitest';

import { getDefaultServerUrl } from '@/lib/validateServerAuth';

describe('getDefaultServerUrl', () => {
  test('uses the current HTTP origin for an embedded client', () => {
    expect(getDefaultServerUrl({
      origin: 'http://example.test:8742',
      protocol: 'http:',
    })).toBe('http://example.test:8742');
  });

  test('preserves HTTPS for an embedded client', () => {
    expect(getDefaultServerUrl({
      origin: 'https://prokop.example',
      protocol: 'https:',
    })).toBe('https://prokop.example');
  });

  test('falls back to localhost for file-based clients', () => {
    expect(getDefaultServerUrl({
      origin: 'null',
      protocol: 'file:',
    })).toBe('localhost:8742');
  });
});
