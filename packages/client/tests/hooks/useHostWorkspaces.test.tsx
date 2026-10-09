import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { afterEach, describe, expect, test, vi } from 'vitest';
import type { SavedServer } from '@prokopai/sdk';
import { useHostWorkspaces } from '@/hooks/useHostWorkspaces';

const servers: SavedServer[] = [
  { id: 'here', name: 'Studio', url: 'studio:8742', createdAt: '' },
  { id: 'laptop', name: 'Laptop', url: 'laptop:8742', token: 'pkd_l', createdAt: '' },
  { id: 'nas', name: 'NAS', url: 'nas:8742', createdAt: '' },
  { id: 'office', name: 'Office', url: 'office:8742', createdAt: '' },
];

function wrapper({ children }: { children: ReactNode }) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('useHostWorkspaces', () => {
  test('fetches only while enabled and reports each machine\'s state', async () => {
    const authHeaders: Array<string | null> = [];
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.startsWith('http://laptop:8742/api/workspaces')) {
        authHeaders.push(new Headers(init?.headers).get('Authorization'));
        return Response.json({ workspaces: [
          { id: 'w1', name: 'website', path: '/w', isVirtual: false, settings: {} },
          { id: 'home', name: 'Coder home', path: '/h', isVirtual: false, settings: { isAgentHome: true } },
        ] });
      }
      if (url.startsWith('http://office:8742/api/workspaces')) return Response.json({ error: 'Unauthorized' }, { status: 401 });
      throw new TypeError('Failed to fetch');
    });
    vi.stubGlobal('fetch', fetchMock);

    const { result, rerender } = renderHook(({ enabled }) => useHostWorkspaces(servers, 'here', enabled), {
      wrapper, initialProps: { enabled: false },
    });
    expect(result.current.map((host) => host.state)).toEqual(['loading', 'loading', 'loading']);
    expect(fetchMock).not.toHaveBeenCalled();

    rerender({ enabled: true });
    await waitFor(() => expect(result.current.map((host) => host.state)).toEqual(['ready', 'offline', 'unpaired']));
    expect(result.current[0]!.server.id).toBe('laptop');
    expect(result.current[0]!.workspaces.map((workspace) => workspace.name)).toEqual(['website']);
    expect(authHeaders).toEqual(['Bearer pkd_l']);
  });
});
