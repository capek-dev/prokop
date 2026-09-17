import { describe, expect, spyOn, test } from 'bun:test';
import { SessionsRestNamespace } from '../src/rest/sessions';
import { HttpClient } from '../src/transport/http';

describe('selected context SDK', () => {
  test('encodes exact response/session path and forwards cancellation', async () => {
    const http = new HttpClient({ url: 'https://example.test' });
    const get = spyOn(http, 'get').mockResolvedValue({ record: null });
    try {
      const signal = new AbortController().signal;
      expect(await new SessionsRestNamespace(http).getSelectedContext('session/one', 'response?two', { signal })).toEqual({ record: null });
      expect(get).toHaveBeenCalledWith('/sessions/session%2Fone/messages/response%3Ftwo/selected-context', { signal });
    } finally { get.mockRestore(); }
  });
});
