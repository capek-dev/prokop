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

vi.mock('@/components/editor/PierreCodeEditor', () => ({
  PierreCodeEditor: ({ docId }: { docId: string }) => <div data-testid={docId} />,
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

  test('re-fetches a loaded doc after reloadDoc resets it to loading', async () => {
    const identity: FileDocIdentity = {
      serverId: 'server-1',
      workspaceId: 'workspace-1',
      root: '',
      path: 'src/refresh.ts',
    };
    const docId = openLoadedDoc(identity, 'refresh.ts');
    expect(useFileEditorStore.getState().docs[docId]?.status).toBe('loaded');

    const readEditable = vi.fn().mockResolvedValue({
      path: 'src/refresh.ts',
      name: 'refresh.ts',
      size: 2,
      content: 'new content from disk',
      revision: 'rev-2',
      readOnly: false,
      encoding: 'utf-8',
    });
    const sdkClient = {
      http: { files: { readEditable } },
    } as unknown as ProkopaiClient;

    render(
      <FileEditorSurface
        sdkClient={sdkClient}
        serverId="server-1"
        workspaceId="workspace-1"
      />,
    );

    // Loaded doc: the load effect must not re-fetch on mount.
    await act(async () => {});
    expect(readEditable).not.toHaveBeenCalled();

    // Reload resets the doc; the effect re-fetches and hydrates disk content.
    act(() => {
      useFileEditorStore.getState().reloadDoc(docId);
    });
    await act(async () => {});

    expect(readEditable).toHaveBeenCalledTimes(1);
    const doc = useFileEditorStore.getState().docs[docId];
    expect(doc?.status).toBe('loaded');
    expect(doc?.content).toBe('new content from disk');
    expect(doc?.revision).toBe('rev-2');
  });

  test('reloadDoc is a no-op while a doc is loading or saving', () => {
    const identity: FileDocIdentity = {
      serverId: 'server-1',
      workspaceId: 'workspace-1',
      root: '',
      path: 'src/midflight.ts',
    };
    const docId = openLoadedDoc(identity, 'midflight.ts');
    const before = useFileEditorStore.getState().docs[docId];

    useFileEditorStore.getState().markSaving(docId);
    useFileEditorStore.getState().reloadDoc(docId);
    expect(useFileEditorStore.getState().docs[docId]?.status).toBe('saving');
    expect(useFileEditorStore.getState().docs[docId]?.content).toBe(before?.content);
  });
});
