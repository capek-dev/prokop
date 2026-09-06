import { beforeEach, expect, test, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ProkopaiClient } from '@prokopai/sdk';
import { GitChangesActions } from '@/components/files/GitChangesActions';
import { useGitCommitStore } from '@/stores/gitCommitStore';
const head = 'a'.repeat(40);
const next = 'b'.repeat(40);
const gitRepository = vi.fn();
const gitCommit = vi.fn();
const gitPush = vi.fn();
const gitPushPreview = vi.fn();
const sdk = { http: { files: { gitRepository, gitCommit, gitPush, gitPushPreview } } } as unknown as ProkopaiClient;
const preview = vi.fn();
beforeEach(() => {
  vi.resetAllMocks();
  useGitCommitStore.setState({ drafts: {} });
  gitRepository.mockResolvedValue({ branch: 'main', head, remotes: ['origin'], upstream: { remote: 'origin', branch: 'main' } });
  gitCommit.mockResolvedValue({ head: next });
  gitPush.mockResolvedValue({ head: next });
  gitPushPreview.mockResolvedValue({ remoteHead: head });
});
function setup() {
  render(<QueryClientProvider client={new QueryClient()}><GitChangesActions sdkClient={sdk} workspaceId="ws" root="/root" onPreview={preview} files={['src/a', 'src/b'].map((path) => ({ path, git: { status: 'modified', staged: true, unstaged: true } }))}><span>Existing tree</span></GitChangesActions></QueryClientProvider>);
}
async function open() {
  await waitFor(() => expect(screen.getByRole('button', { name: 'Commit…' })).toBeEnabled());
  fireEvent.click(screen.getByRole('button', { name: 'Commit…' }));
  fireEvent.click(screen.getByRole('checkbox', { name: 'Commit src/a' }));
  fireEvent.change(screen.getByLabelText('Commit message'), { target: { value: 'Selected' } });
}
async function mode(name: string) {
  fireEvent.pointerDown(screen.getByRole('button', { name: 'Commit action' }), { button: 0, ctrlKey: false });
  fireEvent.click(await screen.findByRole('menuitem', { name }));
}
test('initial render keeps tree and has no standalone push or modal', () => {
  setup();
  expect(screen.getByText('Existing tree')).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Push' })).not.toBeInTheDocument();
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
});
test('inline selection commits whole selected files and keeps preview in place', async () => {
  setup(); await open();
  expect(screen.queryByText('Existing tree')).not.toBeInTheDocument();
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  fireEvent.click(screen.getByTitle('Preview src/a'));
  expect(preview).toHaveBeenCalledWith('src/a');
  expect(screen.getByLabelText('Commit message')).toHaveValue('Selected');
  fireEvent.click(screen.getByRole('button', { name: 'Commit' }));
  await waitFor(() => expect(gitCommit).toHaveBeenCalledWith('ws', { root: '/root', paths: ['src/a'], message: 'Selected', expectedHead: head, expectedBranch: 'main' }));
  expect(gitPush).not.toHaveBeenCalled();
});
test('commit and push sends the new SHA, retry never recommits', async () => {
  gitPush.mockRejectedValueOnce(new Error('Offline'));
  setup(); await open(); await mode('Commit & push');
  fireEvent.click(screen.getByRole('button', { name: 'Commit & push' }));
  await screen.findByRole('button', { name: 'Retry push' });
  expect(gitPush).toHaveBeenCalledWith('ws', expect.objectContaining({ expectedHead: next, remote: 'origin', branch: 'main' }));
  fireEvent.click(screen.getByRole('button', { name: 'Retry push' }));
  await waitFor(() => expect(gitPush).toHaveBeenCalledTimes(2));
  expect(gitCommit).toHaveBeenCalledTimes(1);
});
test('force action confirms before committing and uses reviewed lease', async () => {
  setup(); await open(); await mode('Commit & force push');
  fireEvent.click(screen.getByRole('button', { name: 'Commit & force push' }));
  await screen.findByRole('dialog');
  expect(gitCommit).not.toHaveBeenCalled();
  fireEvent.click(screen.getAllByRole('button', { name: 'Commit & force push' }).at(-1)!);
  await waitFor(() => expect(gitPush).toHaveBeenCalledWith('ws', expect.objectContaining({ force: true, expectedRemoteHead: head, expectedHead: next })));
});
