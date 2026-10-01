import { expect, test } from 'bun:test';
import { checkHarnessCreate, prokopFeatureError, unknownHarnessError } from '@/application/sessions/harness-policy';

const policy = {
  codexAvailable: () => true,
  codexWorkspaceAvailable: (workspaceId: string) => workspaceId === 'physical',
  workspaceRoots: { isAvailable: (workspaceId: string, rootId: string) =>
    workspaceId === 'physical' && rootId === 'owned' },
};

test('one creation policy preserves Prokop default and rejects malformed harnesses', () => {
  expect(checkHarnessCreate({}, policy)).toEqual({ ok: true, harness: 'prokop' });
  expect(checkHarnessCreate({ harness: 'prokop' }, policy)).toEqual({ ok: true, harness: 'prokop' });
  for (const harness of ['invalid', null, '', 12, {}, '__proto__']) {
    expect(checkHarnessCreate({ harness }, policy)).toEqual({
      ok: false, code: 'invalid_session', message: 'Unknown session harness',
    });
  }
});

test('Codex availability and physical workspace fail closed while preconfigs are allowed', () => {
  const request = { harness: 'codex-cli', workspaceId: 'physical' };
  expect(checkHarnessCreate(request, { ...policy, codexAvailable: () => false })).toMatchObject({
    ok: false, message: 'Codex CLI 0.156.x is unavailable on this host',
  });
  expect(checkHarnessCreate({ ...request, workspaceId: 'virtual' }, policy)).toMatchObject({
    ok: false, message: 'Codex CLI requires a physical workspace',
  });
  expect(checkHarnessCreate(request, policy)).toMatchObject({ ok: false, message: 'Codex CLI requires a preconfig' });
  expect(checkHarnessCreate({ ...request, preconfigId: ' ' }, policy)).toMatchObject({ ok: false });
  expect(checkHarnessCreate({ ...request, preconfigId: 'agent' }, policy))
    .toEqual({ ok: true, harness: 'codex-cli' });
  expect(checkHarnessCreate({ ...request, preconfigId: 'agent', workspaceRootId: 'other' }, policy)).toMatchObject({
    ok: false, code: 'invalid_workspace_root',
  });
  expect(checkHarnessCreate({ ...request, preconfigId: 'agent', workspaceRootId: 'owned' }, policy)).toEqual({ ok: true, harness: 'codex-cli' });
  expect(checkHarnessCreate({ harness: 'prokop', workspaceRootId: 'other' }, policy)).toMatchObject({
    ok: false, code: 'invalid_workspace_root',
  });
});

test('Claude creation requires the local CLI and a physical workspace', () => {
  const request = { harness: 'claude-cli', workspaceId: 'physical' };
  expect(checkHarnessCreate(request, policy)).toMatchObject({ ok: false, message: 'Claude CLI is unavailable on this host' });
  const available = { ...policy, claudeAvailable: () => true,
    claudeWorkspaceAvailable: (id: string) => id === 'physical' };
  expect(checkHarnessCreate({ ...request, workspaceId: 'virtual' }, available))
    .toMatchObject({ ok: false, message: 'Claude CLI requires a physical workspace' });
  expect(checkHarnessCreate(request, available)).toEqual({ ok: true, harness: 'claude-cli' });
});

test('disabled harnesses reject creation even when the CLI is available', () => {
  const disabled = (harness: string) => harness === 'codex-cli' || harness === 'claude-cli';
  const codexPolicy = { ...policy, isHarnessDisabled: disabled };
  expect(checkHarnessCreate({ harness: 'codex-cli', workspaceId: 'physical', preconfigId: 'agent' }, codexPolicy))
    .toMatchObject({ ok: false, code: 'invalid_session', message: 'Codex CLI sessions are disabled on this server' });
  const claudePolicy = { ...policy, claudeAvailable: () => true,
    claudeWorkspaceAvailable: () => true, isHarnessDisabled: disabled };
  expect(checkHarnessCreate({ harness: 'claude-cli', workspaceId: 'physical' }, claudePolicy))
    .toMatchObject({ ok: false, message: 'Claude CLI sessions are disabled on this server' });
  expect(checkHarnessCreate({ harness: 'prokop' }, codexPolicy)).toEqual({ ok: true, harness: 'prokop' });
  expect(checkHarnessCreate({}, codexPolicy)).toEqual({ ok: true, harness: 'prokop' });
});

test('Čapek-only operations deny unknown owners and retain Codex refusal messages', () => {
  for (const owner of [undefined, 'prokop', 'codex-cli']) expect(unknownHarnessError(owner)).toBeNull();
  for (const owner of [null, '', 'other', 12, '__proto__']) {
    expect(unknownHarnessError(owner)).toBe('Unknown session harness');
  }
  for (const feature of ['queue', 'modelSelection'] as const) {
    expect(prokopFeatureError('prokop', feature)).toBeNull();
    expect(prokopFeatureError(undefined, feature)).toBeNull();
    expect(prokopFeatureError('other', feature)).toBe('Unknown session harness');
    expect(prokopFeatureError('codex-cli', feature)).toBeTruthy();
  }
});
