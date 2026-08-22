import { describe, expect, it } from 'vitest';
import {
  NOTIFICATION_COPY,
  parsePushData,
  isProkopaiPushPayload,
  isSameOriginRoute,
  normalizeRoute,
  hasVisibleFocusedClient,
  type ProkopaiPushPayloadV1,
} from '@/pwa/sw-logic';

const ORIGIN = 'https://jean2.example.com';

function makeValidPayload(overrides?: Partial<ProkopaiPushPayloadV1>): ProkopaiPushPayloadV1 {
  return {
    version: 1,
    eventId: 'message:msg1:completed',
    type: 'session_completed',
    serverId: 'srv-1',
    sessionId: 'session-1',
    createdAt: 1700000000000,
    route: '/server/srv-1/workspace/session/session-1',
    ...overrides,
  };
}

describe('sw-logic: notification copy', () => {
  it('produces generic copy for each event type', () => {
    expect(NOTIFICATION_COPY.session_completed.body).toBe('Prokopai finished a session');
    expect(NOTIFICATION_COPY.session_failed.body).toBe('Prokopai session failed');
    expect(NOTIFICATION_COPY.permission_required.body).toBe('Prokopai needs your approval');
  });

  it('uses Prokopai as the title for all types', () => {
    for (const copy of Object.values(NOTIFICATION_COPY)) {
      expect(copy.title).toBe('Prokopai');
    }
  });
});

describe('sw-logic: payload validation', () => {
  it('accepts a valid V1 payload', () => {
    const payload = makeValidPayload();
    expect(isProkopaiPushPayload(payload)).toBe(true);
  });

  it('rejects unsupported version', () => {
    expect(isProkopaiPushPayload({ ...makeValidPayload(), version: 2 })).toBe(false);
  });

  it('rejects unknown event type', () => {
    expect(isProkopaiPushPayload({ ...makeValidPayload(), type: 'unknown_event' })).toBe(false);
  });

  it('rejects missing fields', () => {
    expect(isProkopaiPushPayload(null)).toBe(false);
    expect(isProkopaiPushPayload({ version: 1 })).toBe(false);
    expect(isProkopaiPushPayload({ ...makeValidPayload(), eventId: undefined })).toBe(false);
    expect(isProkopaiPushPayload({ ...makeValidPayload(), route: undefined })).toBe(false);
  });
});

describe('sw-logic: parsePushData', () => {
  it('parses valid JSON object', () => {
    const payload = makeValidPayload();
    expect(parsePushData(payload)).toEqual(payload);
  });

  it('parses valid JSON string', () => {
    const payload = makeValidPayload();
    expect(parsePushData(JSON.stringify(payload))).toEqual(payload);
  });

  it('returns null for missing data', () => {
    expect(parsePushData(null)).toBeNull();
    expect(parsePushData(undefined)).toBeNull();
    expect(parsePushData('')).toBeNull();
  });

  it('returns null for malformed JSON string', () => {
    expect(parsePushData('{not json')).toBeNull();
  });

  it('returns null for unsupported version', () => {
    expect(parsePushData({ ...makeValidPayload(), version: 99 })).toBeNull();
  });

  it('returns null for unknown type', () => {
    expect(parsePushData({ ...makeValidPayload(), type: 'something_else' })).toBeNull();
  });
});

describe('sw-logic: route validation', () => {
  it('accepts same-origin relative routes', () => {
    expect(isSameOriginRoute('/server/srv-1/workspace/session/sess1', ORIGIN)).toBe(true);
  });

  it('accepts same-origin absolute URLs', () => {
    expect(
      isSameOriginRoute(`${ORIGIN}/server/srv-1/workspace/session/sess1`, ORIGIN),
    ).toBe(true);
  });

  it('rejects external origins', () => {
    expect(
      isSameOriginRoute('https://evil.com/server/srv-1/workspace/session/sess1', ORIGIN),
    ).toBe(false);
  });

  it('rejects malformed routes', () => {
    // URL constructor is lenient; use a scheme-relative external route that resolves
    expect(isSameOriginRoute('//evil.com/path', ORIGIN)).toBe(false);
  });
});

describe('sw-logic: route normalization', () => {
  it('normalizes a relative route to pathname+search+hash', () => {
    expect(normalizeRoute('/server/srv-1/workspace/session/sess1', ORIGIN)).toBe(
      '/server/srv-1/workspace/session/sess1',
    );
  });

  it('normalizes an absolute URL to pathname+search+hash', () => {
    expect(
      normalizeRoute(`${ORIGIN}/server/srv-1/workspace/session/sess1?tab=1#foo`, ORIGIN),
    ).toBe('/server/srv-1/workspace/session/sess1?tab=1#foo');
  });
});

describe('sw-logic: visibility suppression', () => {
  it('returns true when a visible and focused client exists', () => {
    expect(
      hasVisibleFocusedClient([
        { visibilityState: 'hidden', focused: false },
        { visibilityState: 'visible', focused: true },
      ]),
    ).toBe(true);
  });

  it('returns false when no client is both visible and focused', () => {
    expect(
      hasVisibleFocusedClient([
        { visibilityState: 'visible', focused: false },
        { visibilityState: 'hidden', focused: true },
      ]),
    ).toBe(false);
  });

  it('returns false for empty clients list', () => {
    expect(hasVisibleFocusedClient([])).toBe(false);
  });
});
