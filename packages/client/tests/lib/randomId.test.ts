import { afterEach, describe, expect, test, vi } from 'vitest';
import { randomUUID } from '@/lib/randomId';

const V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('randomUUID', () => {
  test('uses crypto.randomUUID when the page is a secure context', () => {
    const native = vi.spyOn(crypto, 'randomUUID').mockReturnValue('11111111-1111-4111-8111-111111111111');
    expect(randomUUID()).toBe('11111111-1111-4111-8111-111111111111');
    expect(native).toHaveBeenCalledTimes(1);
  });

  test('falls back to getRandomValues on plain HTTP, where randomUUID is missing', () => {
    const real = globalThis.crypto;
    const getRandomValues = vi.fn((array: Uint8Array) => real.getRandomValues(array));
    vi.stubGlobal('crypto', { getRandomValues });

    const ids = new Set(Array.from({ length: 50 }, () => randomUUID()));
    expect(ids.size).toBe(50);
    for (const id of ids) expect(id).toMatch(V4);
    expect(getRandomValues).toHaveBeenCalledTimes(50);
  });
});
