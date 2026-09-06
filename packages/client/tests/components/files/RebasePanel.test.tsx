import { beforeEach, expect, test, vi } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ProkopaiClient } from '@prokopai/sdk';
import { RebasePanel } from '@/components/files/RebasePanel';
import { BranchesPanel } from '@/components/files/BranchesPanel';
vi.mock('@/components/editor/PierreCodeEditor', () => ({ PierreCodeEditor: ({ value, onChange, saving }: { value: string; onChange: (text: string) => void; saving: boolean }) => <textarea aria-label={saving ? 'Input code' : 'Result code'} readOnly={saving} value={value} onChange={(e) => onChange(e.target.value)} /> }));
const head = 'a'.repeat(40);
const token = 'b'.repeat(64);
const idle = { active: false, token: null, branch: null, originalHead: null, onto: null, conflicts: [] };
const active = { active: true, token, branch: 'feature/1232', originalHead: head, onto: head, conflicts: ['file'] };
const files = { gitRebaseState: vi.fn(), gitRebaseStart: vi.fn(), gitRebaseControl: vi.fn(), gitRebaseResolve: vi.fn(), gitRebaseConflict: vi.fn(), gitBranches: vi.fn(), gitHistory: vi.fn() };
const client = { http: { files } } as unknown as ProkopaiClient;
const branch = (name: string, current = false) => ({ ref: `refs/heads/${name}`, name, head, kind: 'local' as const, current, checkedOut: current, upstream: null, ahead: null, behind: null });
const branches = { repository: { branch: 'feature/1232', head, upstream: null, remotes: [] }, branches: [branch('feature/1232', true), branch('main'), { ...branch('origin/main'), kind: 'remote' as const }] };
beforeEach(() => {
  Object.values(files).forEach((fn) => fn.mockReset());
  files.gitRebaseState.mockResolvedValue(idle);
  files.gitRebaseStart.mockResolvedValue(active);
  files.gitRebaseControl.mockImplementation(async () => { files.gitRebaseState.mockResolvedValue(idle); return idle; });
  files.gitRebaseResolve.mockImplementation(async () => { const next = { ...active, conflicts: [], token: 'c'.repeat(64) }; files.gitRebaseState.mockResolvedValue(next); return next; });
  files.gitRebaseConflict.mockResolvedValue({ path: 'file', token, base: { text: 'base', binary: false, mode: '100644' }, feature: { text: 'feature', binary: false, mode: '100644' }, original: { text: 'ancestor', binary: false, mode: '100644' }, workingText: 'conflict markers' });
  files.gitBranches.mockResolvedValue(branches); files.gitHistory.mockResolvedValue({ commits: [], nextOffset: null });
});
function setup(integrated = false) {
  const cache = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return render(<QueryClientProvider client={cache}>{integrated ? <BranchesPanel sdkClient={client} serverId="server" workspaceId="ws" root="/tree" /> : <RebasePanel sdkClient={client} serverId="server" workspaceId="ws" root="/tree" branches={branches} onClose={() => {}} onChanged={() => {}} />}</QueryClientProvider>);
}
test('local-only base selector pins reviewed source and root', async () => {
  setup(); fireEvent.click(await screen.findByRole('button', { name: 'Local base branch' }));
  expect(screen.queryByRole('option', { name: 'origin/main' })).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('option', { name: 'main' }));
  fireEvent.click(screen.getByRole('button', { name: 'Start rebase' }));
  await waitFor(() => expect(files.gitRebaseStart).toHaveBeenCalledWith('ws', { root: '/tree', expectedBranch: 'feature/1232', expectedHead: head, baseBranch: 'main', baseHead: head }));
});
test('result save stages exact file and Continue uses refreshed token', async () => {
  files.gitRebaseState.mockResolvedValue(active); setup();
  fireEvent.change(await screen.findByRole('textbox', { name: 'Result code' }), { target: { value: 'merged text' } });
  expect(screen.getByRole('button', { name: 'Continue' })).toBeDisabled();
  fireEvent.click(screen.getByRole('button', { name: 'Save resolved file' }));
  await waitFor(() => expect(files.gitRebaseResolve).toHaveBeenCalledWith('ws', { root: '/tree', path: 'file', token, resolution: 'text', text: 'merged text' }));
  await waitFor(() => expect(screen.getByRole('button', { name: 'Continue' })).toBeEnabled());
  fireEvent.click(screen.getByRole('button', { name: 'Continue' }));
  await waitFor(() => expect(files.gitRebaseControl).toHaveBeenCalledWith('ws', { root: '/tree', action: 'continue', token: 'c'.repeat(64) }));
});
test('section choices stay visible and do not stage until every marker is resolved', async () => {
  const block = '<<<<<<< base\nbase\n=======\nfeature\n>>>>>>> feature\n';
  files.gitRebaseState.mockResolvedValue(active);
  files.gitRebaseConflict.mockResolvedValue({ path: 'file', token, base: { text: 'base', binary: false }, feature: { text: 'feature', binary: false }, workingText: `before\n${block}middle\n${block}after\n` });
  setup(); await screen.findByText('Conflict 1 of 2 · 2 unresolved');
  fireEvent.click(screen.getByRole('button', { name: 'Use incoming version ↓' }));
  expect(files.gitRebaseResolve).not.toHaveBeenCalled();
  expect(screen.getByRole('button', { name: 'Save resolved file' })).toBeDisabled();
  fireEvent.click(screen.getByRole('button', { name: 'Next' }));
  fireEvent.click(screen.getByRole('button', { name: 'Use your change ↑' }));
  fireEvent.click(screen.getByRole('button', { name: 'Save resolved file' }));
  await waitFor(() => expect(files.gitRebaseResolve).toHaveBeenCalledWith('ws', { root: '/tree', path: 'file', token, resolution: 'text', text: 'before\nbase\nmiddle\nfeature\nafter\n' }));
});
test('reload discovers rebase and Abort requires confirmation', async () => {
  files.gitRebaseState.mockResolvedValue(active); setup(true);
  fireEvent.click(await screen.findByRole('button', { name: /Rebase in progress/ }));
  fireEvent.click(await screen.findByRole('button', { name: 'Abort rebase' }));
  expect(files.gitRebaseControl).not.toHaveBeenCalled();
  fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Abort rebase' }));
  await waitFor(() => expect(files.gitRebaseControl).toHaveBeenCalledWith('ws', { root: '/tree', action: 'abort', token }));
});
test('binary deletion remains usable', async () => {
  files.gitRebaseState.mockResolvedValue(active);
  files.gitRebaseConflict.mockResolvedValue({ path: 'file', token, base: null, feature: { text: null, binary: true }, workingText: null });
  setup(); fireEvent.click(await screen.findByRole('button', { name: 'Keep base deletion' }));
  await waitFor(() => expect(files.gitRebaseResolve).toHaveBeenCalledWith('ws', { root: '/tree', path: 'file', token, resolution: 'base' }));
});
test('repository token refresh keeps unchanged conflict choices enabled', async () => {
  const block = '<<<<<<< base\nbase\n=======\nfeature\n>>>>>>> feature\n';
  const data = { path: 'file', token, base: { text: 'base', binary: false }, feature: { text: 'feature', binary: false }, workingText: block };
  files.gitRebaseState.mockResolvedValue(active);
  files.gitRebaseConflict.mockResolvedValue(data);
  setup();
  fireEvent.click(await screen.findByRole('button', { name: 'Use incoming version ↓' }));
  files.gitRebaseConflict.mockResolvedValue({ ...data, token: 'd'.repeat(64) });
  fireEvent.click(screen.getByRole('button', { name: 'Refresh' }));
  await waitFor(() => expect(screen.getByRole('button', { name: 'Use your change ↑' })).toBeEnabled());
  expect(screen.queryByText(/Conflict changed on the server/)).not.toBeInTheDocument();
  expect(screen.getByText('Conflict 1 of 1 · 0 unresolved')).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Save resolved file' }));
  await waitFor(() => expect(files.gitRebaseResolve).toHaveBeenCalledWith('ws', { root: '/tree', path: 'file', token: 'd'.repeat(64), resolution: 'text', text: 'base\n' }));
});
test('failed conflict refresh has an enabled retry and recovers without losing draft', async () => {
  const data = { path: 'file', token, base: { text: 'base', binary: false }, feature: { text: 'feature', binary: false }, workingText: 'initial' };
  files.gitRebaseState.mockResolvedValue(active);
  files.gitRebaseConflict.mockResolvedValue(data);
  setup();
  fireEvent.change(await screen.findByRole('textbox', { name: 'Result code' }), { target: { value: 'my resolution' } });
  files.gitRebaseConflict.mockRejectedValue(new Error('Temporary read failure'));
  fireEvent.click(screen.getByRole('button', { name: 'Refresh' }));
  const retry = await screen.findByRole('button', { name: 'Retry conflict read' });
  expect(retry).toBeEnabled();
  expect(screen.getByRole('button', { name: 'Save resolved file' })).toBeDisabled();
  files.gitRebaseConflict.mockResolvedValue({ ...data, token: 'd'.repeat(64) });
  fireEvent.click(retry);
  await waitFor(() => expect(screen.getByRole('button', { name: 'Save resolved file' })).toBeEnabled());
  expect(screen.getByRole('textbox', { name: 'Result code' })).toHaveValue('my resolution');
});
test('stale refresh preserves draft and exposes original comparison', async () => {
  files.gitRebaseState.mockResolvedValue(active); setup();
  fireEvent.change(await screen.findByRole('textbox', { name: 'Result code' }), { target: { value: 'my draft' } });
  expect(screen.getByText('Compare with original (common ancestor)')).toBeInTheDocument();
  files.gitRebaseConflict.mockResolvedValue({ path: 'file', token: 'd'.repeat(64), base: { text: 'new base', binary: false }, feature: { text: 'feature', binary: false }, workingText: 'external' });
  fireEvent.click(screen.getByRole('button', { name: 'Refresh' }));
  await screen.findByText(/Conflict changed on the server/);
  expect(screen.getByDisplayValue('my draft')).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Save resolved file' })).toBeDisabled();
});
