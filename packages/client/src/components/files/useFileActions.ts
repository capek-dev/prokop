import { useCallback, useEffect, useRef, useState } from 'react';
import type { ProkopaiClient } from '@prokopai/sdk';
import { queryClient } from '@/components/providers/QueryProvider';
import { queryKeys } from '@/lib/queryKeys';
import { basename } from '@/lib/path';
import { useChatLayoutStore } from '@/stores/chatLayoutStore';
import { buildDocId, useFileEditorStore } from '@/stores/fileEditorStore';
import { useServerDataStore } from '@/stores/serverDataStore';
import { useUIStore } from '@/stores/uiStore';
import {
  docMatchesDeleteTarget,
  isUnderPath,
  joinCopyAbsolutePath,
  joinRootRelative,
  stripTrailingSlash,
  validateEntryName,
  validateRenameTarget,
} from './fileActionsCore';

export interface FileActionTargetInfo {
  /** Root-relative path, no trailing slash. */
  path: string;
  isDirectory: boolean;
  name: string;
  /** Additional-path root when not the main root (undefined = main). */
  root?: string;
}

export type FileActionKind = 'create' | 'rename' | 'delete';

export interface FileActionMutationInfo {
  path: string;
  isDirectory: boolean;
  /** Source path for renames. */
  from?: string;
  root?: string;
}

export type FileActionDialog =
  | { type: 'create'; parentDirPath: string; kind: 'file' | 'directory' }
  | { type: 'rename'; target: FileActionTargetInfo }
  | { type: 'delete'; target: FileActionTargetInfo }
  | null;

export interface UseFileActionsOptions {
  sdkClient: ProkopaiClient | null;
  workspaceId: string | undefined;
  serverId?: string;
  isMobile?: boolean;
  /** Selected root; undefined or '' means the workspace main path. */
  root?: string;
  onMutated?: (kind: FileActionKind, info: FileActionMutationInfo) => void;
  onOpenFileEdit?: (path: string, name: string) => void;
}

export interface UseFileActionsResult {
  dialog: FileActionDialog;
  mutating: boolean;
  error: string | null;
  overwrite: boolean;
  renameConflict: boolean;
  openCreate: (parentDirPath: string, kind: 'file' | 'directory') => void;
  openRename: (target: FileActionTargetInfo) => void;
  openDelete: (target: FileActionTargetInfo) => void;
  closeDialog: () => void;
  submitCreate: (name: string) => void;
  submitRename: (to: string) => void;
  submitDelete: () => void;
  setOverwrite: (checked: boolean) => void;
  copyPath: (rel: string, absolute?: boolean) => void;
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function errorStatusCode(err: unknown): number | undefined {
  if (typeof err === 'object' && err !== null && 'statusCode' in err) {
    const code = (err as { statusCode?: unknown }).statusCode;
    if (typeof code === 'number') return code;
  }
  return undefined;
}

function invalidateFileQueries(): void {
  void queryClient.invalidateQueries({ queryKey: queryKeys.files.treePrefix });
  void queryClient.invalidateQueries({ queryKey: queryKeys.files.searchPrefix });
  void queryClient.invalidateQueries({ queryKey: queryKeys.files.gitStatusPrefix });
}

/** Close every open doc under a deleted path (exact for files, prefix for dirs). */
function closeDocsForDelete(
  options: UseFileActionsOptions,
  path: string,
  isDirectory: boolean,
): void {
  if (!options.serverId || !options.workspaceId) return;
  const store = useFileEditorStore.getState();
  for (const docId of [...store.openDocIds]) {
    const doc = store.docs[docId];
    if (!doc) continue;
    if (
      docMatchesDeleteTarget(doc.identity, {
        serverId: options.serverId,
        workspaceId: options.workspaceId,
        root: options.root,
        path,
        isDirectory,
      })
    ) {
      store.closeDoc(docId);
    }
  }
}

/** Close a renamed file's doc and reopen it at the new path. */
function reopenDocAfterRename(
  options: UseFileActionsOptions,
  from: string,
  to: string,
): void {
  if (!options.serverId || !options.workspaceId) return;
  const store = useFileEditorStore.getState();
  const fromId = buildDocId({
    serverId: options.serverId,
    workspaceId: options.workspaceId,
    root: options.root ?? '',
    path: from,
  });
  if (!store.docs[fromId]) return;
  store.closeDoc(fromId);
  store.openDoc(
    {
      serverId: options.serverId,
      workspaceId: options.workspaceId,
      root: options.root ?? '',
      path: to,
    },
    basename(to) || to,
  );
}

/** Close the preview overlay when it points at (or under) the affected path. */
function closePreviewForTarget(
  options: UseFileActionsOptions,
  path: string,
  isDirectory: boolean,
): void {
  const preview = useUIStore.getState().filePreviewTarget;
  if (!preview) return;
  if (preview.workspaceId !== options.workspaceId) return;
  if ((preview.root ?? '') !== (options.root ?? '')) return;
  const previewPath = stripTrailingSlash(preview.path);
  const matches = isDirectory ? isUnderPath(path, previewPath) : previewPath === path;
  if (matches) useUIStore.getState().closeFilePreview();
}

/** Fallback create opener replicating FilesPanel edit-mode behavior. */
function openFileInEditor(options: UseFileActionsOptions, path: string, name: string): void {
  if (!options.serverId || !options.workspaceId) return;
  useFileEditorStore
    .getState()
    .openDoc(
      { serverId: options.serverId, workspaceId: options.workspaceId, root: options.root ?? '', path },
      name,
    );
  const layout = useChatLayoutStore.getState();
  if (options.isMobile) {
    layout.setMobileSurface('editor');
  } else {
    layout.setWorkbenchSurface('editor');
    layout.setShowFilesPanel(true);
  }
}

export function useFileActions(options: UseFileActionsOptions): UseFileActionsResult {
  const optionsRef = useRef(options);
  useEffect(() => {
    optionsRef.current = options;
  });

  const [dialog, setDialog] = useState<FileActionDialog>(null);
  const [mutating, setMutating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [overwrite, setOverwriteState] = useState(false);
  const [renameConflict, setRenameConflict] = useState(false);

  const resetTransientState = useCallback(() => {
    setMutating(false);
    setError(null);
    setOverwriteState(false);
    setRenameConflict(false);
  }, []);

  const openCreate = useCallback(
    (parentDirPath: string, kind: 'file' | 'directory') => {
      resetTransientState();
      setDialog({ type: 'create', parentDirPath, kind });
    },
    [resetTransientState],
  );

  const openRename = useCallback(
    (target: FileActionTargetInfo) => {
      resetTransientState();
      setDialog({ type: 'rename', target });
    },
    [resetTransientState],
  );

  const openDelete = useCallback(
    (target: FileActionTargetInfo) => {
      resetTransientState();
      setDialog({ type: 'delete', target });
    },
    [resetTransientState],
  );

  const closeDialog = useCallback(() => {
    setDialog(null);
    resetTransientState();
  }, [resetTransientState]);

  const setOverwrite = useCallback((checked: boolean) => {
    setOverwriteState(checked);
  }, []);

  const submitCreate = useCallback(
    async (name: string) => {
      const current = dialog;
      if (!current || current.type !== 'create') return;
      const opts = optionsRef.current;
      const trimmed = name.trim();
      const validationError = validateEntryName(trimmed);
      if (validationError) {
        setError(validationError);
        return;
      }
      if (!opts.sdkClient || !opts.workspaceId) {
        setError('File service is not available');
        return;
      }
      const fullPath = joinRootRelative(current.parentDirPath, trimmed);
      setMutating(true);
      setError(null);
      try {
        await opts.sdkClient.http.files.createFile(opts.workspaceId, {
          path: fullPath,
          kind: current.kind,
          root: opts.root,
          createParents: true,
        });
        invalidateFileQueries();
        opts.onMutated?.('create', { path: fullPath, isDirectory: current.kind === 'directory', root: opts.root });
        setDialog(null);
        resetTransientState();
        if (current.kind === 'file') {
          const entryName = basename(fullPath) || trimmed;
          if (opts.onOpenFileEdit) {
            opts.onOpenFileEdit(fullPath, entryName);
          } else {
            openFileInEditor(opts, fullPath, entryName);
          }
        }
      } catch (err) {
        setError(errorMessage(err));
      } finally {
        setMutating(false);
      }
    },
    [dialog, resetTransientState],
  );

  const submitRename = useCallback(
    async (to: string) => {
      const current = dialog;
      if (!current || current.type !== 'rename') return;
      const opts = optionsRef.current;
      const target = current.target;
      const trimmed = to.trim();
      const validationError = validateRenameTarget(trimmed, target.path);
      if (validationError) {
        setError(validationError);
        return;
      }
      if (!opts.sdkClient || !opts.workspaceId) {
        setError('File service is not available');
        return;
      }
      setMutating(true);
      setError(null);
      try {
        await opts.sdkClient.http.files.renameFile(opts.workspaceId, {
          from: target.path,
          to: trimmed,
          root: target.root ?? opts.root,
          overwrite: overwrite || undefined,
        });
        invalidateFileQueries();
        opts.onMutated?.('rename', {
          path: trimmed,
          isDirectory: target.isDirectory,
          from: target.path,
          root: target.root ?? opts.root,
        });
        if (!target.isDirectory) {
          reopenDocAfterRename(opts, target.path, trimmed);
        } else {
          // A directory rename moves every file under it; open docs at the
          // old prefix are stale (paths no longer exist), so close them like
          // a delete does. Repathing is not possible without losing unsaved
          // content, which is stale here anyway.
          closeDocsForDelete(opts, target.path, true);
        }
        closePreviewForTarget(opts, target.path, target.isDirectory);
        setDialog(null);
        resetTransientState();
      } catch (err) {
        const message = errorMessage(err);
        setError(message);
        if (
          !target.isDirectory &&
          errorStatusCode(err) === 409 &&
          message.includes('Destination already exists')
        ) {
          setRenameConflict(true);
          setOverwriteState(false);
        }
      } finally {
        setMutating(false);
      }
    },
    [dialog, overwrite, resetTransientState],
  );

  const submitDelete = useCallback(
    async () => {
      const current = dialog;
      if (!current || current.type !== 'delete') return;
      const opts = optionsRef.current;
      const target = current.target;
      if (!opts.sdkClient || !opts.workspaceId) {
        setError('File service is not available');
        return;
      }
      setMutating(true);
      setError(null);
      try {
        await opts.sdkClient.http.files.deleteFile(opts.workspaceId, {
          path: target.path,
          root: target.root ?? opts.root,
          recursive: target.isDirectory ? true : undefined,
        });
        invalidateFileQueries();
        opts.onMutated?.('delete', {
          path: target.path,
          isDirectory: target.isDirectory,
          root: target.root ?? opts.root,
        });
        closeDocsForDelete(opts, target.path, target.isDirectory);
        closePreviewForTarget(opts, target.path, target.isDirectory);
        setDialog(null);
        resetTransientState();
      } catch (err) {
        setError(errorMessage(err));
      } finally {
        setMutating(false);
      }
    },
    [dialog, resetTransientState],
  );

  const copyPath = useCallback((rel: string, absolute?: boolean) => {
    const workspacePath = useServerDataStore.getState().activeWorkspace?.path;
    const text = absolute ? joinCopyAbsolutePath(workspacePath, rel) : rel;
    if (typeof navigator !== 'undefined' && navigator.clipboard) {
      void navigator.clipboard.writeText(text).catch(() => {});
    }
  }, []);

  return {
    dialog,
    mutating,
    error,
    overwrite,
    renameConflict,
    openCreate,
    openRename,
    openDelete,
    closeDialog,
    submitCreate,
    submitRename,
    submitDelete,
    setOverwrite,
    copyPath,
  };
}
