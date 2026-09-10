import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { beforeEach, expect, test, vi } from 'vitest';
import type { Session } from '@prokopai/sdk';
const mocks = vi.hoisted(() => ({ setLearning: vi.fn() }));
vi.mock('@/contexts/ServerClientContext', () => ({ useSdkClient: () => ({ http: { sessions: { setLearning: mocks.setLearning } } }) }));
vi.mock('@/components/modals/configuration/LearningHistory', () => ({ LearningHistory: () => null }));
import { SessionLearningMenu } from '@/components/layout/SessionLearningMenu';
import { DropdownMenu, DropdownMenuContent } from '@/components/ui/dropdown-menu';
import { useSessionStore } from '@/stores/sessionStore';

beforeEach(() => {
  vi.clearAllMocks();
  const session = { id: 's', workspaceId: 'w', metadata: {} } as Session;
  useSessionStore.setState({ sessions: [session] });
  mocks.setLearning.mockResolvedValue({ session: { ...session, metadata: { learning: { excluded: true, includeAutomated: false } } } });
});

test('session exclusion persists through the SDK and refreshes the menu from the mutation result', async () => {
  const user = userEvent.setup();
  const cache = new QueryClient();
  render(<QueryClientProvider client={cache}><DropdownMenu open><DropdownMenuContent><SessionLearningMenu sessionId="s" /></DropdownMenuContent></DropdownMenu></QueryClientProvider>);
  await user.click(screen.getByRole('menuitem', { name: 'Exclude from learning' }));
  await waitFor(() => expect(mocks.setLearning).toHaveBeenCalledWith('s', { excluded: true, includeAutomated: false }));
  expect(await screen.findByRole('menuitem', { name: 'Allow future learning' })).toBeInTheDocument();
});
