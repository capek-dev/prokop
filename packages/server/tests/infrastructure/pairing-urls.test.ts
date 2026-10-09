import { describe, expect, test } from 'bun:test';
import { buildPairingUrl } from '@/infrastructure/runtime/pairing-urls';

describe('buildPairingUrl', () => {
  test('puts the code in the fragment, never the query', () => {
    const url = buildPairingUrl('http://192.168.1.5:8742', 'ABCD-EFGH-2345');
    expect(url).toBe('http://192.168.1.5:8742/pair#code=ABCD-EFGH-2345');
    expect(new URL(url).search).toBe('');
  });
});
