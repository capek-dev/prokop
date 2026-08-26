import { render } from '@testing-library/react';
import { beforeEach, describe, expect, test, vi } from 'vitest';
import { ServerSwitcher } from '@/components/layout/ServerSwitcher';
import { useConnectionStore } from '@/stores/connectionStore';

vi.mock('@tanstack/react-router', () => ({
  useNavigate: () => vi.fn(),
  useParams: () => ({ serverId: 'server-1' }),
}));

vi.mock('@/contexts/ServerContext', () => ({
  useServerContext: () => ({
    servers: [
      {
        id: 'server-1',
        name: 'Development',
        url: 'https://development.example.com',
        createdAt: '2026-01-01T00:00:00.000Z',
      },
    ],
    renameServer: vi.fn(),
  }),
}));

vi.mock('@/components/modals/RenameServerDialog', () => ({
  RenameServerDialog: () => null,
}));

describe('ServerSwitcher', () => {
  beforeEach(() => {
    useConnectionStore.setState({ connected: false });
  });

  test('bundles connected status into the compact icon-only trigger', () => {
    useConnectionStore.setState({ connected: true });

    const { container, getByRole, queryByText } = render(<ServerSwitcher compact />);

    expect(
      getByRole('combobox', { name: 'Select server, Development, Connected' }),
    ).toBeInTheDocument();
    expect(queryByText('Development')).not.toBeInTheDocument();
    expect(
      container.querySelector('[data-connection-status="connected"]'),
    ).toHaveClass('bg-success');
  });

  test('shows disconnected status in the same trigger', () => {
    const { container, getByRole } = render(<ServerSwitcher compact />);

    expect(
      getByRole('combobox', { name: 'Select server, Development, Disconnected' }),
    ).toBeInTheDocument();
    expect(
      container.querySelector('[data-connection-status="disconnected"]'),
    ).toHaveClass('bg-destructive');
  });
});
