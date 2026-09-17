import { expect, spyOn, test } from 'bun:test';
import { HttpClient } from '../src/transport/http';
import { ProvidersRestNamespace } from '../src/rest/providers';

test('context selection settings preserve explicit boolean and abort signal', async () => {
  const http = new HttpClient({ url: 'https://example.test' });
  const get = spyOn(http, 'get').mockResolvedValue({ enabled: false, configured: true });
  const put = spyOn(http, 'put').mockResolvedValue({ enabled: true, configured: true });
  try {
    const api = new ProvidersRestNamespace(http);
    const signal = new AbortController().signal;
    expect(await api.getContextSelection({ signal })).toEqual({ enabled: false, configured: true });
    expect(await api.setContextSelection(true, { signal })).toEqual({ enabled: true, configured: true });
    expect(get).toHaveBeenCalledWith('/config/experimental/context-selection', { signal });
    expect(put).toHaveBeenCalledWith('/config/experimental/context-selection', { enabled: true }, { signal });
  } finally { get.mockRestore(); put.mockRestore(); }
});
