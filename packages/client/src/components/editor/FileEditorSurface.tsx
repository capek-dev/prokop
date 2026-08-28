import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Loader2, AlertCircle, X, Save, RotateCcw, Eye, Code2, RefreshCw, GitBranch, EyeOff } from 'lucide-react';
import { toast } from 'sonner';
import type { ProkopaiClient, FileRevisionConflictDetails } from '@prokopai/sdk';
import { ApiError } from '@prokopai/sdk';
import {
  useFileEditorStore,
  isDocDirty,
  buildDocId,
  normalizePath,
  type FileDocState,
} from '@/stores/fileEditorStore';
import { queryClient } from '@/components/providers/QueryProvider';
import { queryKeys } from '@/lib/queryKeys';
import { useUIStore } from '@/stores/uiStore';
import { useEditorGitDiffQuery } from '@/hooks/queries';
import { PierreCodeEditor, type PierreEditorGitDiff } from './PierreCodeEditor';
import { MarkdownRenderer } from '@/components/shared/MarkdownRenderer';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { cn } from '@/lib/utils';

interface FileEditorSurfaceProps {
  sdkClient: ProkopaiClient | null;
  serverId: string;
  workspaceId: string | undefined;
}

const MARKDOWN_EXTS = new Set(['md', 'markdown', 'mdx']);

function isMarkdownFile(path: string, language?: string): boolean {
  if (language && language.toLowerCase() === 'markdown') return true;
  const ext = path.split('.').pop()?.toLowerCase() ?? '';
  return MARKDOWN_EXTS.has(ext);
}

/**
 * Determine whether a value looks like a FileRevisionConflictDetails payload.
 * Used to guard the untyped error.details before casting.
 */
function isConflictDetails(details: unknown): details is FileRevisionConflictDetails {
  if (typeof details !== 'object' || details === null) return false;
  const d = details as Record<string, unknown>;
  return (
    typeof d.path === 'string' &&
    typeof d.expectedRevision === 'string' &&
    typeof d.actualRevision === 'string' &&
    typeof d.currentContent === 'string'
  );
}

export function FileEditorSurface({ sdkClient, serverId, workspaceId }: FileEditorSurfaceProps) {
  const docs = useFileEditorStore((s) => s.docs);
  const openDocIds = useFileEditorStore((s) => s.openDocIds);
  const activeDocId = useFileEditorStore((s) => s.activeDocId);
  const setActiveDoc = useFileEditorStore((s) => s.setActiveDoc);
  const updateContent = useFileEditorStore((s) => s.updateContent);
  const markLoading = useFileEditorStore((s) => s.markLoading);
  const markSaving = useFileEditorStore((s) => s.markSaving);
  const saveSuccess = useFileEditorStore((s) => s.saveSuccess);
  const setConflict = useFileEditorStore((s) => s.setConflict);
  const clearConflict = useFileEditorStore((s) => s.clearConflict);
  const resetStatus = useFileEditorStore((s) => s.resetStatus);
  const closeDocAction = useFileEditorStore((s) => s.closeDoc);
  const reloadFromConflict = useFileEditorStore((s) => s.reloadFromConflict);

  const surfaceRef = useRef<HTMLDivElement | null>(null);
  const [closingDocId, setClosingDocId] = useState<string | null>(null);
  const [mdView, setMdView] = useState<'source' | 'preview'>('source');

  // Only surface docs for the active server/workspace.
  const scopedOpenDocIds = workspaceId
    ? openDocIds.filter((id) => {
        const doc = docs[id];
        return (
          doc &&
          doc.identity.serverId === serverId &&
          doc.identity.workspaceId === workspaceId
        );
      })
    : [];

  const activeDoc = activeDocId ? docs[activeDocId] : undefined;
  const isScopedActive =
    !!activeDoc &&
    activeDoc.identity.serverId === serverId &&
    activeDoc.identity.workspaceId === (workspaceId ?? '');

  const scopedActiveDocId = isScopedActive ? activeDocId : (scopedOpenDocIds[0] ?? null);
  const scopedActiveDoc = scopedActiveDocId ? docs[scopedActiveDocId] : undefined;

  // Narrow load-effect dependencies to primitives so typing in another doc
  // does not re-run this effect. The identity object fields are captured
  // individually.
  const activeStatus = scopedActiveDoc?.status;
  const activeRevision = scopedActiveDoc?.revision;
  const activeContent = scopedActiveDoc?.content;
  const activePath = scopedActiveDoc?.identity.path;
  const activeRoot = scopedActiveDoc?.identity.root;
  const activeWsId = scopedActiveDoc?.identity.workspaceId;
  useEffect(() => {
    if (!sdkClient || !workspaceId || !scopedActiveDocId || !activePath) return;
    if (activeStatus !== 'loading') return;
    if (activeContent !== '' && activeRevision !== '') return;

    const docId = scopedActiveDocId;
    const root = activeRoot || undefined;
    const controller = new AbortController();
    let cancelled = false;

    sdkClient.http.files
      .readEditable(activeWsId ?? workspaceId, normalizePath(activePath), {
        root,
        signal: controller.signal,
      })
      .then((data) => {
        if (cancelled) return;
        useFileEditorStore.getState().hydrateSuccess(docId, data);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        const message = err instanceof Error ? err.message : String(err);
        console.error('[FileEditor] Failed to load file:', {
          workspaceId: activeWsId ?? workspaceId,
          path: activePath,
          message,
        });
        useFileEditorStore.getState().hydrateFailure(docId, message);
        toast.error('Failed to load file', { description: message });
      });

    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [
    sdkClient,
    workspaceId,
    scopedActiveDocId,
    activeStatus,
    activeRevision,
    activeContent,
    activePath,
    activeRoot,
    activeWsId,
  ]);

  // --- Save ---
  const handleSave = useCallback(
    async (docId: string, opts?: { force?: boolean; actualRevision?: string }) => {
      const store = useFileEditorStore.getState();
      const doc = store.docs[docId];
      if (!doc || !sdkClient || !workspaceId || doc.status === 'saving') return;
      const identity = doc.identity;

      markSaving(docId);

      const request: Parameters<typeof sdkClient.http.files.save>[1] = {
        path: normalizePath(identity.path),
        content: doc.content,
        expectedRevision: opts?.force ? opts.actualRevision ?? doc.revision : doc.revision,
        root: identity.root || undefined,
        force: opts?.force,
      };

      try {
        const result = await sdkClient.http.files.save(workspaceId, request);
        saveSuccess(docId, result);

        // Invalidate Git status, Git diff for the path, and browse queries so
        // other surfaces reflect the saved file.
        queryClient.invalidateQueries({ queryKey: queryKeys.files.gitStatusPrefix });
        queryClient.invalidateQueries({
          queryKey: queryKeys.files.gitDiff(workspaceId, normalizePath(identity.path), identity.root || undefined),
        });
        queryClient.invalidateQueries({ queryKey: queryKeys.files.browsePrefix });
        queryClient.invalidateQueries({
          queryKey: queryKeys.files.preview(
            workspaceId,
            identity.path,
            identity.root || undefined,
          ),
          refetchType: 'all',
        });
      } catch (err: unknown) {
        if (err instanceof ApiError && err.statusCode === 409 && isConflictDetails(err.details)) {
          setConflict(docId, err.details);
          return;
        }
        const message = err instanceof Error ? err.message : String(err);
        console.error('[FileEditor] Failed to save file:', {
          workspaceId: identity.workspaceId,
          path: identity.path,
          message,
        });
        // Reset status so the user can retry, via the dedicated store action.
        resetStatus(docId);
        toast.error('Failed to save file', { description: message });
      }
    },
    [sdkClient, workspaceId, markSaving, saveSuccess, setConflict, resetStatus],
  );

  // --- Close with dirty guard ---
  const requestClose = useCallback(
    (docId: string) => {
      const doc = docs[docId];
      if (doc && isDocDirty(doc)) {
        setClosingDocId(docId);
      } else {
        closeDocAction(docId);
      }
    },
    [docs, closeDocAction],
  );

  // Single refresh entry point: re-read the doc from disk and invalidate its
  // Git diff so both reflect external writes (LLM edits, other editors).
  const invalidateDocDiff = useCallback((docId: string) => {
    const doc = useFileEditorStore.getState().docs[docId];
    if (!doc) return;
    queryClient.invalidateQueries({
      queryKey: queryKeys.files.gitDiff(
        doc.identity.workspaceId,
        normalizePath(doc.identity.path),
        doc.identity.root || undefined,
      ),
    });
  }, []);

  // Reload from disk: reset the doc to loading so the load effect re-fetches.
  // Dirty docs require confirmation, since reload discards local edits.
  const [reloadingDocId, setReloadingDocId] = useState<string | null>(null);
  const reloadDoc = useFileEditorStore((s) => s.reloadDoc);
  const reloadFromDisk = useCallback(
    (docId: string) => {
      invalidateDocDiff(docId);
      reloadDoc(docId);
    },
    [invalidateDocDiff, reloadDoc],
  );
  const requestReload = useCallback(
    (docId: string) => {
      const doc = useFileEditorStore.getState().docs[docId];
      if (!doc) return;
      if (isDocDirty(doc)) {
        setReloadingDocId(docId);
      } else {
        reloadFromDisk(docId);
      }
    },
    [reloadFromDisk],
  );

  const handleConfirmCloseSave = useCallback(async () => {
    if (!closingDocId) return;
    const docId = closingDocId;
    const doc = docs[docId];
    if (!doc || !isDocDirty(doc)) {
      closeDocAction(docId);
      setClosingDocId(null);
      return;
    }
    // Save then close only on success.
    const before = doc.content;
    await handleSave(docId);
    const after = useFileEditorStore.getState().docs[docId];
    // If save succeeded (content unchanged and no conflict), close.
    if (after && !after.conflict && after.baseContent === before) {
      closeDocAction(docId);
      setClosingDocId(null);
    } else {
      // Save failed or conflicted; keep the doc open.
      setClosingDocId(null);
    }
  }, [closingDocId, docs, handleSave, closeDocAction]);

  const handleConfirmCloseDiscard = useCallback(() => {
    if (!closingDocId) return;
    closeDocAction(closingDocId);
    setClosingDocId(null);
  }, [closingDocId, closeDocAction]);

  const handleConfirmReload = useCallback(() => {
    if (!reloadingDocId) return;
    reloadFromDisk(reloadingDocId);
    setReloadingDocId(null);
  }, [reloadingDocId, reloadFromDisk]);

  // --- Conflict actions ---
  const handleConflictCancel = useCallback(
    (docId: string) => {
      clearConflict(docId);
    },
    [clearConflict],
  );

  const handleConflictOverwrite = useCallback(
    (docId: string) => {
      const doc = docs[docId];
      if (!doc || !doc.conflict) return;
      void handleSave(docId, {
        force: true,
        actualRevision: doc.conflict.actualRevision,
      });
    },
    [docs, handleSave],
  );

  const handleConflictReload = useCallback(
    (docId: string) => {
      reloadFromConflict(docId);
    },
    [reloadFromConflict],
  );

  // --- Keyboard shortcuts (Cmd/Ctrl+S, Cmd/Ctrl+W) scoped to the surface ---
  useEffect(() => {
    const surface = surfaceRef.current;
    if (!surface) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      const mod = e.metaKey || e.ctrlKey;
      if (!mod) return;
      if (e.key === 's' || e.key === 'S') {
        if (scopedActiveDocId) {
          e.preventDefault();
          e.stopPropagation();
          void handleSave(scopedActiveDocId);
        }
      } else if (e.key === 'w' || e.key === 'W') {
        if (scopedActiveDocId) {
          e.preventDefault();
          e.stopPropagation();
          requestClose(scopedActiveDocId);
        }
      }
    };
    surface.addEventListener('keydown', handleKeyDown, true);
    return () => surface.removeEventListener('keydown', handleKeyDown, true);
  }, [scopedActiveDocId, handleSave, requestClose]);

  const closingDoc = closingDocId ? docs[closingDocId] : undefined;

  if (scopedOpenDocIds.length === 0) {
    return null;
  }

  return (
    <div
      ref={surfaceRef}
      className="flex h-full min-h-0 flex-col overflow-hidden"
      data-editor-surface
    >
      {/* Tabs */}
      <div className="flex shrink-0 items-center gap-0.5 overflow-x-auto border-b border-border bg-muted/30 px-1">
        {scopedOpenDocIds.map((id) => {
          const doc = docs[id];
          if (!doc) return null;
          const dirty = isDocDirty(doc);
          const isActive = id === scopedActiveDocId;
          return (
            <div
              key={id}
              className={cn(
                'group/tab flex shrink-0 items-center gap-1.5 border-b-2 px-3 py-1.5 text-xs transition-colors',
                isActive
                  ? 'border-primary text-foreground'
                  : 'border-transparent text-muted-foreground hover:text-foreground',
              )}
              title={doc.identity.path}
            >
              <button
                type="button"
                onClick={() => setActiveDoc(id)}
                className="max-w-[140px] truncate outline-none"
              >
                {doc.name}
              </button>
              {dirty && <span className="size-1.5 rounded-full bg-primary" />}
              <button
                type="button"
                onClick={() => requestClose(id)}
                className="ml-0.5 flex size-4 items-center justify-center rounded hover:bg-muted outline-none"
                aria-label={`Close ${doc.name}`}
              >
                <X className="size-3" />
              </button>
            </div>
          );
        })}
      </div>

      {/* All open docs stay mounted in the DOM; only the active one is shown.
          This preserves CodeMirror cursor position, scroll, and undo history
          across tab switches. Inactive loading docs remain unloaded until
          activated by the load effect above. */}
      {scopedOpenDocIds.map((id) => {
        const doc = docs[id];
        if (!doc) return null;
        const isActive = id === scopedActiveDocId;
        return (
          <div
            key={id}
            className={cn(
              'min-h-0 flex-1 flex-col overflow-hidden',
              isActive ? 'flex' : 'hidden',
            )}
          >
            <ActiveFileBody
              doc={doc}
              isActive={isActive}
              mdView={mdView}
              setMdView={setMdView}
              onChange={(content) => updateContent(id, content)}
              onSave={() => handleSave(id)}
              onOverwrite={() => handleConflictOverwrite(id)}
              onReload={() => handleConflictReload(id)}
              onCancelConflict={() => handleConflictCancel(id)}
              onRetry={() => markLoading(id)}
              onRequestReload={() => requestReload(id)}
              sdkClient={sdkClient}
            />
          </div>
        );
      })}

      {/* Unsaved close dialog */}
      <Dialog open={!!closingDoc} onOpenChange={(open) => !open && setClosingDocId(null)}>
        <DialogContent showCloseButton={false}>
          <DialogHeader>
            <DialogTitle>Unsaved changes</DialogTitle>
            <DialogDescription>
              {closingDoc?.name ?? 'This file'} has unsaved changes. Do you want to save before closing?
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setClosingDocId(null)}>
              Cancel
            </Button>
            <Button variant="ghost" onClick={handleConfirmCloseDiscard}>
              Discard
            </Button>
            <Button onClick={handleConfirmCloseSave} disabled={closingDoc?.status === 'saving'}>
              <Save className="size-4" />
              Save
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Reload discards local edits: confirm when dirty */}
      <Dialog open={!!reloadingDocId} onOpenChange={(open) => !open && setReloadingDocId(null)}>
        <DialogContent showCloseButton={false}>
          <DialogHeader>
            <DialogTitle>Refresh from disk</DialogTitle>
            <DialogDescription>
              {docs[reloadingDocId ?? '']?.name ?? 'This file'} has unsaved changes. Reloading replaces them with the version on disk.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setReloadingDocId(null)}>
              Cancel
            </Button>
            <Button onClick={handleConfirmReload}>
              <RotateCcw className="size-4" />
              Reload
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

interface ActiveFileBodyProps {
  doc: FileDocState;
  isActive: boolean;
  mdView: 'source' | 'preview';
  setMdView: (v: 'source' | 'preview') => void;
  onChange: (content: string) => void;
  onSave: () => void;
  onOverwrite: () => void;
  onReload: () => void;
  onCancelConflict: () => void;
  onRetry: () => void;
  /** Re-fetch the file from disk (dirty-guarded by the surface). */
  onRequestReload: () => void;
  sdkClient: ProkopaiClient | null;
}

function ActiveFileBody({
  doc,
  isActive,
  mdView,
  setMdView,
  onChange,
  onSave,
  onOverwrite,
  onReload,
  onCancelConflict,
  onRetry,
  onRequestReload,
  sdkClient,
}: ActiveFileBodyProps) {
  const docId = buildDocId(doc.identity);
  const isMd = isMarkdownFile(doc.identity.path, doc.language);
  const dirty = isDocDirty(doc);
  const saving = doc.status === 'saving';
  const [showGitDiff, setShowGitDiff] = useState(true);

  const normalizedPath = normalizePath(doc.identity.path);
  const normalizedRoot = doc.identity.root || undefined;

  // Only the active hydrated document owns a live Git diff observer.
  const diffEnabled = isActive && doc.status === 'loaded';
  const { data: diffData, isFetching: diffFetching } = useEditorGitDiffQuery(
    sdkClient,
    doc.identity.workspaceId,
    normalizedPath,
    normalizedRoot,
    diffEnabled,
  );

  const gitDiff = useMemo<PierreEditorGitDiff | null>(() => {
    if (!diffData?.diffAvailable || diffData.hunks.length === 0) return null;
    return {
      hunks: diffData.hunks,
      additions: diffData.additions,
      deletions: diffData.deletions,
    };
  }, [diffData]);

  if (doc.status === 'loading') {
    return (
      <div className="flex flex-1 items-center justify-center">
        <Loader2 className="size-5 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (doc.status === 'error') {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-3 p-8 text-center">
        <AlertCircle className="size-8 text-muted-foreground" />
        <p className="text-sm text-muted-foreground">{doc.error ?? 'Failed to load file'}</p>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={onRetry}>
            Retry
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() =>
              useUIStore.getState().openFilePreview({
                workspaceId: doc.identity.workspaceId,
                path: doc.identity.path,
                name: doc.name,
                root: doc.identity.root || undefined,
              })
            }
          >
            <Eye className="size-3.5" />
            Open Preview
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {/* Toolbar: path, git diff controls, markdown toggle, save */}
      <div className="flex shrink-0 items-center gap-2 border-b border-border px-2 py-1">
        <span className="truncate text-xs text-muted-foreground" title={doc.identity.path}>
          {doc.identity.path}
        </span>
        <div className="ml-auto flex items-center gap-1">
          {/* Git diff controls */}
          {(gitDiff || diffFetching || diffData) && (
            <>
              {gitDiff && (
                <span className="flex items-center gap-1 text-[10px] font-medium shrink-0">
                  {gitDiff.additions > 0 && (
                    <span className="text-green-600 dark:text-green-400">+{gitDiff.additions}</span>
                  )}
                  {gitDiff.deletions > 0 && (
                    <span className="text-red-600 dark:text-red-400">-{gitDiff.deletions}</span>
                  )}
                </span>
              )}
              {diffFetching && (
                <RefreshCw className="size-3 animate-spin text-muted-foreground" />
              )}
              {gitDiff && (
                <Button
                  size="icon-sm"
                  variant="ghost"
                  onClick={() => setShowGitDiff((v) => !v)}
                  title={showGitDiff ? 'Hide Git diff' : 'Show Git diff'}
                  className="shrink-0"
                >
                  {showGitDiff ? <EyeOff className="size-3" /> : <GitBranch className="size-3" />}
                </Button>
              )}
            </>
          )}
          {isMd && (
            <Tabs value={mdView} onValueChange={(v) => setMdView(v as 'source' | 'preview')}>
              <TabsList className="h-7">
                <TabsTrigger value="source" className="px-2 text-xs">
                  <Code2 className="size-3" />
                  Source
                </TabsTrigger>
                <TabsTrigger value="preview" className="px-2 text-xs">
                  <Eye className="size-3" />
                  Preview
                </TabsTrigger>
              </TabsList>
            </Tabs>
          )}
          {/* Single refresh: re-reads the file from disk (picks up external
              changes like LLM writes, other editors) and refreshes its Git
              diff. The surface dirty-guards this and asks for confirmation. */}
          <Button
            size="icon-sm"
            variant="ghost"
            onClick={onRequestReload}
            title="Refresh from disk"
            disabled={saving}
            className="shrink-0"
          >
            <RotateCcw className="size-3" />
          </Button>
          {dirty && !doc.conflict && (
            <Button size="xs" onClick={onSave} disabled={saving}>
              {saving ? <Loader2 className="size-3 animate-spin" /> : <Save className="size-3" />}
              Save
            </Button>
          )}
        </div>
      </div>

      {/* Conflict banner */}
      {doc.conflict && (
        <ConflictBanner
          conflict={doc.conflict}
          onOverwrite={onOverwrite}
          onReload={onReload}
          onCancel={onCancelConflict}
          localContent={doc.content}
          saving={saving}
        />
      )}

      {/* Editor or markdown preview */}
      <div className="min-h-0 flex-1 overflow-hidden">
        {isMd && mdView === 'preview' ? (
          <div className="h-full overflow-auto p-4 chat-transcript-scrollbar">
            <MarkdownRenderer>{doc.content}</MarkdownRenderer>
          </div>
        ) : (
          <PierreCodeEditor
            docId={docId}
            fileName={doc.name}
            value={doc.content}
            onChange={onChange}
            saving={saving}
            gitDiff={gitDiff}
            showGitDiff={showGitDiff}
          />
        )}
      </div>
    </div>
  );
}

interface ConflictBannerProps {
  conflict: FileRevisionConflictDetails;
  localContent: string;
  saving: boolean;
  onOverwrite: () => void;
  onReload: () => void;
  onCancel: () => void;
}

function ConflictBanner({ conflict, localContent, saving, onOverwrite, onReload, onCancel }: ConflictBannerProps) {
  const [showCompare, setShowCompare] = useState(false);

  return (
    <div className="shrink-0 border-b border-amber-500/30 bg-amber-500/10 px-3 py-2">
      <div className="flex flex-wrap items-center gap-2">
        <AlertCircle className="size-4 text-amber-600" />
        <span className="text-xs text-amber-700 dark:text-amber-400">
          This file changed on disk. Your edits conflict with the saved version.
        </span>
        <div className="ml-auto flex items-center gap-1">
          <Button size="xs" variant="ghost" onClick={() => setShowCompare((v) => !v)}>
            {showCompare ? 'Hide' : 'Compare'}
          </Button>
          <Button size="xs" variant="ghost" onClick={onCancel}>
            Cancel
          </Button>
          <Button size="xs" variant="ghost" onClick={onReload} disabled={saving}>
            <RotateCcw className="size-3" />
            Reload
          </Button>
          <Button size="xs" onClick={onOverwrite} disabled={saving}>
            {saving ? <Loader2 className="size-3 animate-spin" /> : null}
            Overwrite
          </Button>
        </div>
      </div>
      {showCompare && (
        <div className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-2">
          <div className="min-h-0 overflow-hidden rounded-md border border-border">
            <div className="border-b border-border bg-muted/50 px-2 py-1 text-[10px] font-medium uppercase text-muted-foreground">
              Your changes
            </div>
            <pre className="max-h-48 overflow-auto p-2 text-xs dialog-scrollbar">{localContent}</pre>
          </div>
          <div className="min-h-0 overflow-hidden rounded-md border border-border">
            <div className="border-b border-border bg-muted/50 px-2 py-1 text-[10px] font-medium uppercase text-muted-foreground">
              On disk
            </div>
            <pre className="max-h-48 overflow-auto p-2 text-xs dialog-scrollbar">{conflict.currentContent}</pre>
          </div>
        </div>
      )}
    </div>
  );
}
