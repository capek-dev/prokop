import { describe, expect, test } from 'vitest';
import { describeThisDevice } from '@/lib/deviceIdentity';

describe('describeThisDevice', () => {
  test.each([
    ['Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Version/17.0 Mobile/15E148 Safari/604.1',
      { label: 'iPhone (Safari)', deviceKind: 'mobile' }],
    ['Mozilla/5.0 (iPad; CPU OS 17_0 like Mac OS X) AppleWebKit/605.1.15 CriOS/120.0 Mobile/15E148 Safari/604.1',
      { label: 'iPad (Chrome)', deviceKind: 'tablet' }],
    ['Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 Chrome/120.0 Mobile Safari/537.36',
      { label: 'Android (Chrome)', deviceKind: 'mobile' }],
    ['Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/120.0 Safari/537.36 Edg/120.0',
      { label: 'Mac (Edge)', deviceKind: 'desktop' }],
    ['Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:121.0) Gecko/20100101 Firefox/121.0',
      { label: 'Windows PC (Firefox)', deviceKind: 'desktop' }],
    ['curl/8.0', { label: 'Browser', deviceKind: 'unknown' }],
  ])('%s', (userAgent, expected) => {
    expect(describeThisDevice(userAgent)).toEqual(expected);
  });
});
