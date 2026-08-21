import { act, render } from '@testing-library/react';
import { beforeEach, describe, expect, test, vi } from 'vitest';
import type { EditableFileResponse, ProkopaiClient } from '@prokopai/sdk';
import { FileEditorSurface } from '@/components/editor/FileEditorSurface';
import {
  useFileEditorStore,
  type FileDocIdentity,
} from '@/stores/fileEditorStore';

const mockUseEditorGitDiffQuery = vi.fn((..._args: unknown[]) => ({
  data: undefined,
  isFetching: false,
}));

vi.mock('@/hooks/queries', () => ({
  useEditorGitDiffQuery: (...args: unknown[]) => mockUseEditorGitDiffQuery(...args),
}));

vi.mock('@/components/editor/CodeMirrorEditor', () => ({
  CodeMirrorEditor: ({ docId }: { docId: string }) => <div data-testid={docId} />,
}));

function openLoadedDoc(identity: FileDocIdentity, name: string): string {
  const docId = useFileEditorStore.getState().openDoc(identity, name);
  const response: EditableFileResponse = {
    path: identity.path,
    name,
    size: 1,
    content: name,
    revision: `revision-${name}`,
    readOnly: false,
    encoding: 'utf-8',
  };
  useFileEditorStore.getState().hydrateSuccess(docId, response);
  return docId;
}

describe('FileEditorSurface Git diff query lifecycle', () => {
  beforeEach(() => {
    mockUseEditorGitDiffQuery.mockClear();
    useFileEditorStore.setState({
      docs: {},
      openDocIds: [],
      activeDocId: null,
      anyDirty: false,
    });
  });

  test('enables the query only for the active loaded document and normalizes its identity', () => {
    const firstIdentity: FileDocIdentity = {
      serverId: 'server-1',
      workspaceId: 'workspace-1',
      root: '',
      path: '/src//first.ts',
    };
    const secondIdentity: FileDocIdentity = {
      serverId: 'server-1',
      workspaceId: 'workspace-1',
      root: '/extra/root',
      path: '/src//second.ts',
    };
    const firstId = openLoadedDoc(firstIdentity, 'first.ts');
    const secondId = openLoadedDoc(secondIdentity, 'second.ts');
    useFileEditorStore.getState().setActiveDoc(firstId);

    const sdkClient = {} as ProkopaiClient;
    render(
      <FileEditorSurface
        sdkClient={sdkClient}
        serverId="server-1"
        workspaceId="workspace-1"
      />,
    );

    expect(mockUseEditorGitDiffQuery).toHaveBeenCalledWith(
      sdkClient,
      'workspace-1',
      'src/first.ts',
      undefined,
      true,
    );
    expect(mockUseEditorGitDiffQuery).toHaveBeenCalledWith(
      sdkClient,
      'workspace-1',
      'src/second.ts',
      '/extra/root',
      false,
    );

    mockUseEditorGitDiffQuery.mockClear();
    act(() => {
      useFileEditorStore.getState().setActiveDoc(secondId);
    });

    expect(mockUseEditorGitDiffQuery).toHaveBeenCalledWith(
      sdkClient,
      'workspace-1',
      'src/first.ts',
      undefined,
      false,
    );
    expect(mockUseEditorGitDiffQuery).toHaveBeenCalledWith(
      sdkClient,
      'workspace-1',
      'src/second.ts',
      '/extra/root',
      true,
    );

  });
});
