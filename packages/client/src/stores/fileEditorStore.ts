import { create } from 'zustand';
import type {
  EditableFileResponse,
  FileRevisionConflictDetails,
  SaveFileResponse,
} from '@prokopai/sdk';

/**
 * A single open document is uniquely identified by the combination of
 * serverId + workspaceId + root + normalized relative path. Two documents
 * are the same file only when all four match.
 */
export interface FileDocIdentity {
  serverId: string;
  workspaceId: string;
  /** Root directory, or '' for the workspace main path. */
  root: string;
  /** Normalized relative path (no leading/trailing slashes). */
  path: string;
}

export type FileDocId = string;

export interface FileDocState {
  identity: FileDocIdentity;
  name: string;
  /** Server-assigned revision token from the last load or save. */
  revision: string;
  /** Content as last loaded/saved (clean baseline). */
  baseContent: string;
  /** Current edited content. */
  content: string;
  language?: string;
  mimeType?: string;
  status: 'loading' | 'loaded' | 'error' | 'saving';
  error?: string;
  /** Pending revision conflict details (set on save failure 409). */
  conflict?: FileRevisionConflictDetails;
}

interface FileEditorState {
  docs: Record<FileDocId, FileDocState>;
  /** Ordered list of open document IDs. */
  openDocIds: FileDocId[];
  /** Currently active document ID (may be null). */
  activeDocId: FileDocId | null;
  /**
   * Primitive scope summary: whether ANY open doc is dirty.
   * Maintained by store actions so layout-level consumers can select a
   * stable boolean instead of the full docs record (avoids rerender on
   * every keystroke).
   */
  anyDirty: boolean;
}

interface FileEditorActions {
  /** Open (or focus) a document. If it already exists it is focused. */
  openDoc: (identity: FileDocIdentity, name: string) => FileDocId;
  /** Mark an existing doc as loading. */
  markLoading: (docId: FileDocId) => void;
  /**
   * Reset a doc to the loading state so the load effect re-fetches it from
   * disk (manual reload). Equivalent to close+reopen, but keeps the tab.
   */
  reloadDoc: (docId: FileDocId) => void;
  /** Hydrate a doc after a successful editable read. */
  hydrateSuccess: (docId: FileDocId, data: EditableFileResponse) => void;
  /** Mark a doc as failed to load. */
  hydrateFailure: (docId: FileDocId, error: string) => void;
  /** Update the current edited content (marks dirty). */
  updateContent: (docId: FileDocId, content: string) => void;
  /** Mark a doc as saving. */
  markSaving: (docId: FileDocId) => void;
  /** Apply a successful save result (clears dirty, updates revision). */
  saveSuccess: (docId: FileDocId, result: SaveFileResponse) => void;
  /** Set conflict details on a doc. */
  setConflict: (docId: FileDocId, conflict: FileRevisionConflictDetails) => void;
  /** Clear conflict details (preserves local dirty content). */
  clearConflict: (docId: FileDocId) => void;
  /** Reload doc content from conflict details (accept disk version). */
  reloadFromConflict: (docId: FileDocId) => void;
  /** Reset a saving doc back to the loaded status (used on save failure). */
  resetStatus: (docId: FileDocId) => void;
  /** Set the active document. */
  setActiveDoc: (docId: FileDocId | null) => void;
  /** Close a document. Returns the next active doc id (or null). */
  closeDoc: (docId: FileDocId) => FileDocId | null;
  /** Discard unsaved changes for a doc (revert to base content). */
  discardChanges: (docId: FileDocId) => void;
}

type FileEditorStore = FileEditorState & FileEditorActions;

/** Normalize a relative path: trim slashes and collapse repeats. */
export function normalizePath(path: string): string {
  return path
    .replace(/\/+/g, '/')
    .replace(/^\/+/, '')
    .replace(/\/+$/, '');
}

/** Build a stable document id from its identity. */
export function buildDocId(identity: FileDocIdentity): FileDocId {
  const root = identity.root ?? '';
  const path = normalizePath(identity.path);
  return `${identity.serverId}\u0001${identity.workspaceId}\u0001${root}\u0001${path}`;
}

/** Whether a document has unsaved changes. */
export function isDocDirty(doc: FileDocState | undefined): boolean {
  if (!doc) return false;
  return doc.content !== doc.baseContent;
}

/**
 * Recompute the anyDirty summary from the docs record. Called after every
 * mutation so layout-level consumers can subscribe to a stable boolean.
 */
function computeAnyDirty(docs: Record<FileDocId, FileDocState>, openDocIds: FileDocId[]): boolean {
  for (const id of openDocIds) {
    const doc = docs[id];
    if (doc && doc.content !== doc.baseContent) return true;
  }
  return false;
}

export const useFileEditorStore = create<FileEditorStore>((baseSet) => {
  /**
   * Wrap set so anyDirty is always recomputed from the resulting state,
   * keeping the primitive summary in sync without each action repeating logic.
   */
  const set = (
    partial:
      | Partial<FileEditorStore>
      | ((state: FileEditorStore) => Partial<FileEditorStore>),
  ) => {
    baseSet((state) => {
      const next = typeof partial === 'function' ? partial(state) : partial;
      const docs = next.docs ?? state.docs;
      const openDocIds = next.openDocIds ?? state.openDocIds;
      return { ...next, anyDirty: computeAnyDirty(docs, openDocIds) };
    });
  };

  return {
    docs: {},
    openDocIds: [],
    activeDocId: null,
    anyDirty: false,

    openDoc: (identity, name) => {
      const docId = buildDocId(identity);
      set((state) => {
        const existing = state.docs[docId];
        if (existing) {
          // Focus existing tab without reordering openDocIds.
          return { activeDocId: docId };
        }
        const doc: FileDocState = {
          identity,
          name,
          revision: '',
          baseContent: '',
          content: '',
          status: 'loading',
        };
        return {
          docs: { ...state.docs, [docId]: doc },
          openDocIds: [...state.openDocIds, docId],
          activeDocId: docId,
        };
      });
      return docId;
    },

    markLoading: (docId) => {
      set((state) => {
        const doc = state.docs[docId];
        if (!doc) return {};
        return {
          docs: {
            ...state.docs,
            [docId]: { ...doc, status: 'loading', error: undefined },
          },
        };
      });
    },

    reloadDoc: (docId) => {
      set((state) => {
        const doc = state.docs[docId];
        // A doc already loading or saving must not be reset mid-flight.
        if (!doc || doc.status === 'loading' || doc.status === 'saving') return {};
        return {
          docs: {
            ...state.docs,
            [docId]: {
              ...doc,
              revision: '',
              baseContent: '',
              content: '',
              status: 'loading',
              error: undefined,
              conflict: undefined,
            },
          },
        };
      });
    },

    hydrateSuccess: (docId, data) => {
      set((state) => {
        const doc = state.docs[docId];
        if (!doc) return {};
        return {
          docs: {
            ...state.docs,
            [docId]: {
              ...doc,
              name: data.name || doc.name,
              revision: data.revision,
              baseContent: data.content,
              content: data.content,
              language: data.language,
              mimeType: data.mimeType,
              status: 'loaded',
              error: undefined,
              conflict: undefined,
            },
          },
        };
      });
    },

    hydrateFailure: (docId, error) => {
      set((state) => {
        const doc = state.docs[docId];
        if (!doc) return {};
        return {
          docs: {
            ...state.docs,
            [docId]: { ...doc, status: 'error', error },
          },
        };
      });
    },

    updateContent: (docId, content) => {
      set((state) => {
        const doc = state.docs[docId];
        if (!doc) return {};
        return {
          docs: {
            ...state.docs,
            [docId]: { ...doc, content },
          },
        };
      });
    },

    markSaving: (docId) => {
      set((state) => {
        const doc = state.docs[docId];
        if (!doc || doc.status === 'saving') return {};
        return {
          docs: {
            ...state.docs,
            [docId]: { ...doc, status: 'saving' },
          },
        };
      });
    },

    saveSuccess: (docId, result) => {
      set((state) => {
        const doc = state.docs[docId];
        if (!doc) return {};
        return {
          docs: {
            ...state.docs,
            [docId]: {
              ...doc,
              revision: result.revision,
              baseContent: doc.content,
              status: 'loaded',
              conflict: undefined,
            },
          },
        };
      });
    },

    setConflict: (docId, conflict) => {
      set((state) => {
        const doc = state.docs[docId];
        if (!doc) return {};
        return {
          docs: {
            ...state.docs,
            [docId]: { ...doc, status: 'loaded', conflict },
          },
        };
      });
    },

    clearConflict: (docId) => {
      set((state) => {
        const doc = state.docs[docId];
        if (!doc || !doc.conflict) return {};
        return {
          docs: {
            ...state.docs,
            [docId]: { ...doc, conflict: undefined },
          },
        };
      });
    },

    reloadFromConflict: (docId) => {
      set((state) => {
        const doc = state.docs[docId];
        if (!doc || !doc.conflict) return {};
        const { actualRevision, currentContent } = doc.conflict;
        return {
          docs: {
            ...state.docs,
            [docId]: {
              ...doc,
              revision: actualRevision,
              baseContent: currentContent,
              content: currentContent,
              conflict: undefined,
              status: 'loaded',
            },
          },
        };
      });
    },

    resetStatus: (docId) => {
      set((state) => {
        const doc = state.docs[docId];
        if (!doc || doc.status === 'loaded') return {};
        return {
          docs: {
            ...state.docs,
            [docId]: { ...doc, status: 'loaded' },
          },
        };
      });
    },

    setActiveDoc: (docId) => set({ activeDocId: docId }),

    closeDoc: (docId) => {
      let nextActive: FileDocId | null = null;
      set((state) => {
        if (!state.docs[docId]) return {};
        const docs = { ...state.docs };
        delete docs[docId];
        const openDocIds = state.openDocIds.filter((id) => id !== docId);
        let activeDocId = state.activeDocId;
        if (activeDocId === docId) {
          const removedIndex = state.openDocIds.indexOf(docId);
          activeDocId = openDocIds[Math.min(removedIndex, openDocIds.length - 1)] ?? null;
        }
        nextActive = activeDocId;
        return { docs, openDocIds, activeDocId };
      });
      return nextActive;
    },

    discardChanges: (docId) => {
      set((state) => {
        const doc = state.docs[docId];
        if (!doc) return {};
        return {
          docs: {
            ...state.docs,
            [docId]: {
              ...doc,
              content: doc.baseContent,
              conflict: undefined,
            },
          },
        };
      });
    },
  };
});

/**
 * Whether any open doc for the given server/workspace exists.
 * Uses getState() so callers can check without subscribing to the docs record.
 */
export function hasOpenDocsForScope(serverId: string, workspaceId: string): boolean {
  const { docs, openDocIds } = useFileEditorStore.getState();
  return openDocIds.some((id) => {
    const doc = docs[id];
    return (
      !!doc &&
      doc.identity.serverId === serverId &&
      doc.identity.workspaceId === workspaceId
    );
  });
}
