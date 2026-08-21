import { describe, test, expect, beforeEach } from 'vitest';
import {
  useFileEditorStore,
  buildDocId,
  normalizePath,
  isDocDirty,
  type FileDocIdentity,
} from '@/stores/fileEditorStore';
import type { EditableFileResponse, SaveFileResponse, FileRevisionConflictDetails } from '@prokopai/sdk';

const baseIdentity: FileDocIdentity = {
  serverId: 'server-1',
  workspaceId: 'ws-1',
  root: '',
  path: 'src/index.ts',
};

function makeEditable(overrides: Partial<EditableFileResponse> = {}): EditableFileResponse {
  return {
    path: 'src/index.ts',
    name: 'index.ts',
    extension: '.ts',
    size: 10,
    content: 'const a = 1;\n',
    revision: 'rev-1',
    readOnly: false,
    encoding: 'utf-8',
    ...overrides,
  };
}

function makeSaveResult(overrides: Partial<SaveFileResponse> = {}): SaveFileResponse {
  return {
    path: 'src/index.ts',
    revision: 'rev-2',
    size: 12,
    modifiedAt: '2024-01-01T00:00:00Z',
    ...overrides,
  };
}

function makeConflict(overrides: Partial<FileRevisionConflictDetails> = {}): FileRevisionConflictDetails {
  return {
    path: 'src/index.ts',
    expectedRevision: 'rev-1',
    actualRevision: 'rev-9',
    currentContent: 'const a = 999;\n',
    ...overrides,
  };
}

describe('fileEditorStore', () => {
  beforeEach(() => {
    useFileEditorStore.setState({ docs: {}, openDocIds: [], activeDocId: null, anyDirty: false });
  });

  // --- Identity ---
  describe('identity / buildDocId', () => {
    test('buildDocId is stable for the same identity', () => {
      expect(buildDocId(baseIdentity)).toBe(buildDocId({ ...baseIdentity }));
    });

    test('buildDocId differs across server/workspace/root/path', () => {
      const a = buildDocId(baseIdentity);
      const diffServer = buildDocId({ ...baseIdentity, serverId: 'server-2' });
      const diffWs = buildDocId({ ...baseIdentity, workspaceId: 'ws-2' });
      const diffRoot = buildDocId({ ...baseIdentity, root: 'packages' });
      const diffPath = buildDocId({ ...baseIdentity, path: 'src/other.ts' });
      expect(new Set([a, diffServer, diffWs, diffRoot, diffPath]).size).toBe(5);
    });

    test('normalizePath trims and collapses slashes', () => {
      expect(normalizePath('/src//index.ts/')).toBe('src/index.ts');
      expect(normalizePath('src/index.ts')).toBe('src/index.ts');
    });

    test('buildDocId normalizes path before composing', () => {
      const clean = buildDocId({ ...baseIdentity, path: 'src/index.ts' });
      const messy = buildDocId({ ...baseIdentity, path: '//src///index.ts//' });
      expect(clean).toBe(messy);
    });
  });

  // --- Open / focus ---
  describe('openDoc', () => {
    test('creates a new doc and sets it active', () => {
      const id = useFileEditorStore.getState().openDoc(baseIdentity, 'index.ts');
      const state = useFileEditorStore.getState();
      expect(state.docs[id]).toBeDefined();
      expect(state.openDocIds).toEqual([id]);
      expect(state.activeDocId).toBe(id);
      expect(state.docs[id].status).toBe('loading');
    });

    test('duplicate open focuses existing tab without creating a new one', () => {
      const { openDoc } = useFileEditorStore.getState();
      const id1 = openDoc(baseIdentity, 'index.ts');
      const id2 = openDoc({ ...baseIdentity }, 'index.ts');
      expect(id1).toBe(id2);
      const state = useFileEditorStore.getState();
      expect(state.openDocIds).toEqual([id1]);
      expect(Object.keys(state.docs)).toHaveLength(1);
    });

    test('reopening an existing tab does not reorder openDocIds', () => {
      const { openDoc } = useFileEditorStore.getState();
      const id1 = openDoc({ ...baseIdentity, path: 'a.ts' }, 'a.ts');
      const id2 = openDoc({ ...baseIdentity, path: 'b.ts' }, 'b.ts');
      const id3 = openDoc({ ...baseIdentity, path: 'c.ts' }, 'c.ts');
      // Reopen id1: it should stay in its original position.
      openDoc({ ...baseIdentity, path: 'a.ts' }, 'a.ts');
      const state = useFileEditorStore.getState();
      expect(state.openDocIds).toEqual([id1, id2, id3]);
      expect(state.activeDocId).toBe(id1);
    });
  });

  // --- Dirty calculation ---
  describe('isDocDirty', () => {
    test('returns false for undefined doc', () => {
      expect(isDocDirty(undefined)).toBe(false);
    });

    test('returns false when content equals base', () => {
      const id = useFileEditorStore.getState().openDoc(baseIdentity, 'index.ts');
      useFileEditorStore.getState().hydrateSuccess(id, makeEditable({ content: 'x', revision: 'r' }));
      expect(isDocDirty(useFileEditorStore.getState().docs[id])).toBe(false);
    });

    test('returns true after editing content', () => {
      const id = useFileEditorStore.getState().openDoc(baseIdentity, 'index.ts');
      useFileEditorStore.getState().hydrateSuccess(id, makeEditable({ content: 'x', revision: 'r' }));
      useFileEditorStore.getState().updateContent(id, 'y');
      expect(isDocDirty(useFileEditorStore.getState().docs[id])).toBe(true);
    });
  });

  // --- Save success ---
  describe('saveSuccess', () => {
    test('updates revision and clears dirty (base = content)', () => {
      const { openDoc, hydrateSuccess, updateContent, markSaving, saveSuccess } = useFileEditorStore.getState();
      const id = openDoc(baseIdentity, 'index.ts');
      hydrateSuccess(id, makeEditable({ content: 'orig', revision: 'r1' }));
      updateContent(id, 'edited');
      markSaving(id);
      saveSuccess(id, makeSaveResult({ revision: 'r2' }));

      const doc = useFileEditorStore.getState().docs[id];
      expect(doc.revision).toBe('r2');
      expect(doc.baseContent).toBe('edited');
      expect(doc.content).toBe('edited');
      expect(isDocDirty(doc)).toBe(false);
      expect(doc.status).toBe('loaded');
      expect(doc.conflict).toBeUndefined();
    });
  });

  // --- Conflict reload ---
  describe('conflict / reloadFromConflict', () => {
    test('setConflict stores details; reloadFromConflict accepts disk version', () => {
      const { openDoc, hydrateSuccess, updateContent, setConflict, reloadFromConflict } = useFileEditorStore.getState();
      const id = openDoc(baseIdentity, 'index.ts');
      hydrateSuccess(id, makeEditable({ content: 'orig', revision: 'r1' }));
      updateContent(id, 'my edits');

      const conflict = makeConflict();
      setConflict(id, conflict);
      expect(useFileEditorStore.getState().docs[id].conflict).toEqual(conflict);

      reloadFromConflict(id);
      const doc = useFileEditorStore.getState().docs[id];
      expect(doc.conflict).toBeUndefined();
      expect(doc.revision).toBe('rev-9');
      expect(doc.baseContent).toBe('const a = 999;\n');
      expect(doc.content).toBe('const a = 999;\n');
      expect(isDocDirty(doc)).toBe(false);
    });
  });

  // --- Close fallback ---
  describe('closeDoc', () => {
    test('closing the only doc clears active to null', () => {
      const { openDoc, closeDoc } = useFileEditorStore.getState();
      const id = openDoc(baseIdentity, 'index.ts');
      const next = closeDoc(id);
      expect(next).toBeNull();
      expect(useFileEditorStore.getState().activeDocId).toBeNull();
      expect(useFileEditorStore.getState().openDocIds).toEqual([]);
    });

    test('closing the active doc falls back to a sibling', () => {
      const { openDoc, closeDoc } = useFileEditorStore.getState();
      const id1 = openDoc({ ...baseIdentity, path: 'a.ts' }, 'a.ts');
      const id2 = openDoc({ ...baseIdentity, path: 'b.ts' }, 'b.ts');
      // active is id2 now; closing it falls back to id1
      const next = closeDoc(id2);
      expect(next).toBe(id1);
      expect(useFileEditorStore.getState().activeDocId).toBe(id1);
    });

    test('closing a non-active doc keeps active unchanged', () => {
      const { openDoc, closeDoc, setActiveDoc } = useFileEditorStore.getState();
      const id1 = openDoc({ ...baseIdentity, path: 'a.ts' }, 'a.ts');
      const id2 = openDoc({ ...baseIdentity, path: 'b.ts' }, 'b.ts');
      setActiveDoc(id1);
      const next = closeDoc(id2);
      expect(next).toBe(id1);
      expect(useFileEditorStore.getState().activeDocId).toBe(id1);
    });
  });

  // --- Discard ---
  describe('discardChanges', () => {
    test('reverts content to base and clears conflict', () => {
      const { openDoc, hydrateSuccess, updateContent, discardChanges } = useFileEditorStore.getState();
      const id = openDoc(baseIdentity, 'index.ts');
      hydrateSuccess(id, makeEditable({ content: 'orig', revision: 'r1' }));
      updateContent(id, 'changed');
      discardChanges(id);
      const doc = useFileEditorStore.getState().docs[id];
      expect(doc.content).toBe('orig');
      expect(isDocDirty(doc)).toBe(false);
    });
  });

  // --- clearConflict ---
  describe('clearConflict', () => {
    test('clears conflict while preserving local dirty content', () => {
      const { openDoc, hydrateSuccess, updateContent, setConflict, clearConflict } = useFileEditorStore.getState();
      const id = openDoc(baseIdentity, 'index.ts');
      hydrateSuccess(id, makeEditable({ content: 'orig', revision: 'r1' }));
      updateContent(id, 'my edits');
      setConflict(id, makeConflict());
      expect(useFileEditorStore.getState().docs[id].conflict).toBeDefined();

      clearConflict(id);
      const doc = useFileEditorStore.getState().docs[id];
      expect(doc.conflict).toBeUndefined();
      // Local dirty content is preserved.
      expect(doc.content).toBe('my edits');
      expect(isDocDirty(doc)).toBe(true);
    });
  });

  // --- resetStatus ---
  describe('resetStatus', () => {
    test('resets a saving doc back to loaded', () => {
      const { openDoc, hydrateSuccess, updateContent, markSaving, resetStatus } = useFileEditorStore.getState();
      const id = openDoc(baseIdentity, 'index.ts');
      hydrateSuccess(id, makeEditable({ content: 'orig', revision: 'r1' }));
      updateContent(id, 'edited');
      markSaving(id);
      expect(useFileEditorStore.getState().docs[id].status).toBe('saving');

      resetStatus(id);
      const doc = useFileEditorStore.getState().docs[id];
      expect(doc.status).toBe('loaded');
      // Content is preserved through the reset.
      expect(doc.content).toBe('edited');
    });

    test('no-op when already loaded', () => {
      const { openDoc, hydrateSuccess, resetStatus } = useFileEditorStore.getState();
      const id = openDoc(baseIdentity, 'index.ts');
      hydrateSuccess(id, makeEditable({ content: 'orig', revision: 'r1' }));
      resetStatus(id);
      expect(useFileEditorStore.getState().docs[id].status).toBe('loaded');
    });
  });

  // --- anyDirty summary ---
  describe('anyDirty', () => {
    test('is false when no docs are dirty', () => {
      const { openDoc, hydrateSuccess } = useFileEditorStore.getState();
      const id = openDoc(baseIdentity, 'index.ts');
      hydrateSuccess(id, makeEditable({ content: 'x', revision: 'r' }));
      expect(useFileEditorStore.getState().anyDirty).toBe(false);
    });

    test('is true when a doc has unsaved changes', () => {
      const { openDoc, hydrateSuccess, updateContent } = useFileEditorStore.getState();
      const id = openDoc(baseIdentity, 'index.ts');
      hydrateSuccess(id, makeEditable({ content: 'x', revision: 'r' }));
      updateContent(id, 'y');
      expect(useFileEditorStore.getState().anyDirty).toBe(true);
    });

    test('returns to false after save', () => {
      const { openDoc, hydrateSuccess, updateContent, markSaving, saveSuccess } = useFileEditorStore.getState();
      const id = openDoc(baseIdentity, 'index.ts');
      hydrateSuccess(id, makeEditable({ content: 'x', revision: 'r1' }));
      updateContent(id, 'y');
      markSaving(id);
      saveSuccess(id, makeSaveResult({ revision: 'r2' }));
      expect(useFileEditorStore.getState().anyDirty).toBe(false);
    });
  });
});
