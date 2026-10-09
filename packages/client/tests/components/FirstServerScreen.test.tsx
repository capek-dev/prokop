import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, test, vi } from 'vitest';

const navigate = vi.hoisted(() => vi.fn());
vi.mock('@tanstack/react-router', () => ({
  useNavigate: () => navigate,
  useRouter: () => ({ history: { length: 1, back: vi.fn() } }),
}));

const addServer = vi.hoisted(() => vi.fn((name: string, url: string) => ({ id: 'new', name, url })));
vi.mock('@/contexts/ServerContext', () => ({ useServerContext: () => ({ addServer, servers: [] }) }));

import FirstServerScreen from '@/components/FirstServerScreen';

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  vi.unstubAllGlobals();
});

function submit(name: string, url: string) {
  fireEvent.change(screen.getByLabelText('Server Name'), { target: { value: name } });
  fireEvent.change(screen.getByLabelText('Server URL'), { target: { value: url } });
  fireEvent.click(screen.getByRole('button', { name: 'Add Server' }));
}

describe('FirstServerScreen', () => {
  test('saves a machine that requires pairing without asking for a token', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => Response.json({ features: { authentication: true } })));
    render(<FirstServerScreen />);
    expect(screen.queryByText(/api token/i)).toBeNull();

    submit('Studio', 'studio.ts.net');

    await vi.waitFor(() => expect(navigate).toHaveBeenCalledWith({ to: '/server/$serverId', params: { serverId: 'new' } }));
    expect(addServer).toHaveBeenCalledWith('Studio', expect.stringContaining('studio.ts.net'));
  });

  test('reports a machine that does not answer', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new TypeError('Failed to fetch'); }));
    render(<FirstServerScreen />);

    submit('Studio', 'studio.ts.net');

    expect(await screen.findByText('Could not reach server: Failed to fetch')).toBeTruthy();
    expect(addServer).not.toHaveBeenCalled();
  });
});
