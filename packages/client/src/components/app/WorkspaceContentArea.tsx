import { useCallback, useEffect, useRef, useState } from 'react';
import { useParams } from '@tanstack/react-router';
import { ArrowLeft } from 'lucide-react';
import type { ProkopaiClient } from '@prokopai/sdk';
import { SessionBoard } from '@/components/board/SessionBoard';
import { FileEditorSurface } from '@/components/editor/FileEditorSurface';
import { Button } from '@/components/ui/button';
import { useIsMobile } from '@/hooks/use-mobile';
import { useServerDataStore } from '@/stores/serverDataStore';
import { useFileEditorStore, hasOpenDocsForScope } from '@/stores/fileEditorStore';
import { cn } from '@/lib/utils';

const EDITOR_WIDTH_STORAGE_KEY = 'prokopai_editor_width_pct';
const EDITOR_MIN_PCT = 25;
const EDITOR_MAX_PCT = 80;
const EDITOR_DEFAULT_PCT = 50;

function loadEditorWidthPct(): number {
  if (typeof window === 'undefined') return EDITOR_DEFAULT_PCT;
  const stored = localStorage.getItem(EDITOR_WIDTH_STORAGE_KEY);
  if (stored === null) return EDITOR_DEFAULT_PCT;
  const parsed = Number(stored);
  if (!Number.isFinite(parsed)) return EDITOR_DEFAULT_PCT;
  return Math.min(EDITOR_MAX_PCT, Math.max(EDITOR_MIN_PCT, parsed));
}

function saveEditorWidthPct(pct: number): void {
  if (typeof window === 'undefined') return;
  try {
    localStorage.setItem(EDITOR_WIDTH_STORAGE_KEY, String(pct));
  } catch {
    // Ignore persistence errors.
  }
}

interface WorkspaceContentAreaProps {
  sdkClient: ProkopaiClient | null;
  serverUrl: string | null;
}

/**
 * Combined content row containing the SessionBoard and the FileEditorSurface
 * with a simple pointer-resizable divider. On mobile, the editor becomes the
 * central surface when a file is selected, with a back button to return to chat.
 */
export function WorkspaceContentArea({ sdkClient, serverUrl }: WorkspaceContentAreaProps) {
  const params = useParams({
    from: '/server/$serverId',
    strict: false,
  } as unknown as Parameters<typeof useParams>[0]);
  const serverId = params?.serverId as string | undefined;
  const activeWorkspace = useServerDataStore((s) => s.activeWorkspace);
  const workspaceId = activeWorkspace?.id;
  const isMobile = useIsMobile();

  const anyDirty = useFileEditorStore((s) => s.anyDirty);
  const openDocCount = useFileEditorStore((s) => s.openDocIds.length);
  const activeDocId = useFileEditorStore((s) => s.activeDocId);
  const activeDocServerId = useFileEditorStore((s) =>
    s.activeDocId ? s.docs[s.activeDocId]?.identity.serverId ?? null : null,
  );
  const activeDocWorkspaceId = useFileEditorStore((s) =>
    s.activeDocId ? s.docs[s.activeDocId]?.identity.workspaceId ?? null : null,
  );

  // Whether the editor has any open docs for the active server/workspace.
  // Derived from stable primitives + a getState check; recomputed only when
  // openDocCount changes, not on every content keystroke.
  const hasEditorDocs =
    !!serverId &&
    !!workspaceId &&
    openDocCount > 0 &&
    hasOpenDocsForScope(serverId, workspaceId);

  // On mobile, track whether we are showing the editor over chat.
  const [mobileShowEditor, setMobileShowEditor] = useState(false);

  // Show the mobile editor surface whenever an in-scope doc becomes active.
  useEffect(() => {
    if (!isMobile) return;
    if (!hasEditorDocs) {
      setMobileShowEditor(false);
      return;
    }
    const isActiveScoped =
      activeDocServerId === (serverId ?? '') &&
      activeDocWorkspaceId === (workspaceId ?? '');
    if (isActiveScoped) {
      setMobileShowEditor(true);
    }
  }, [isMobile, hasEditorDocs, activeDocId, activeDocServerId, activeDocWorkspaceId, serverId, workspaceId]);

  // --- beforeunload warning while any doc is dirty ---
  useEffect(() => {
    const handler = (e: BeforeUnloadEvent) => {
      if (anyDirty) {
        e.preventDefault();
        e.returnValue = '';
      }
    };
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, [anyDirty]);

  // --- Desktop resizable divider ---
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [editorPct, setEditorPct] = useState<number>(loadEditorWidthPct);
  const draggingRef = useRef(false);

  const handleDividerDown = useCallback((e: React.PointerEvent) => {
    e.preventDefault();
    draggingRef.current = true;
    document.body.style.cursor = 'ew-resize';
    document.body.style.userSelect = 'none';
  }, []);

  useEffect(() => {
    const handleMove = (e: PointerEvent) => {
      if (!draggingRef.current) return;
      const container = containerRef.current;
      if (!container) return;
      const rect = container.getBoundingClientRect();
      const editorLeft = rect.right - e.clientX;
      let pct = (editorLeft / rect.width) * 100;
      pct = Math.min(EDITOR_MAX_PCT, Math.max(EDITOR_MIN_PCT, pct));
      setEditorPct(pct);
    };
    const handleUp = () => {
      if (!draggingRef.current) return;
      draggingRef.current = false;
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
      setEditorPct((current) => {
        saveEditorWidthPct(current);
        return current;
      });
    };
    document.addEventListener('pointermove', handleMove);
    document.addEventListener('pointerup', handleUp);
    return () => {
      document.removeEventListener('pointermove', handleMove);
      document.removeEventListener('pointerup', handleUp);
    };
  }, []);

  if (!serverId) {
    return (
      <SessionBoard sdkClient={sdkClient} serverUrl={serverUrl} />
    );
  }

  // Mobile: editor overlays chat when active.
  if (isMobile) {
    return (
      <div ref={containerRef} className="relative flex flex-1 min-h-0">
        <div className={cn('flex flex-1 min-h-0', mobileShowEditor && 'hidden')}>
          <SessionBoard sdkClient={sdkClient} serverUrl={serverUrl} />
        </div>
        {hasEditorDocs && mobileShowEditor && (
          <div className="absolute inset-0 z-10 flex flex-col bg-background">
            <div className="flex shrink-0 items-center gap-1 border-b border-border px-2 py-1">
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setMobileShowEditor(false)}
              >
                <ArrowLeft className="size-4" />
                Chat
              </Button>
            </div>
            <div className="flex min-h-0 flex-1 flex-col">
              <FileEditorSurface
                sdkClient={sdkClient}
                serverId={serverId}
                workspaceId={workspaceId}
              />
            </div>
          </div>
        )}
      </div>
    );
  }

  // Desktop: side-by-side with resizable divider.
  // No open files means SessionBoard retains full width.
  if (!hasEditorDocs) {
    return (
      <div ref={containerRef} className="flex flex-1 min-h-0">
        <SessionBoard sdkClient={sdkClient} serverUrl={serverUrl} />
      </div>
    );
  }

  const editorWidthPct = editorPct;
  const boardWidthPct = 100 - editorWidthPct;

  return (
    <div ref={containerRef} className="flex flex-1 min-h-0">
      <div style={{ width: `${boardWidthPct}%` }} className="flex min-h-0 min-w-0">
        <SessionBoard sdkClient={sdkClient} serverUrl={serverUrl} />
      </div>
      <div
        role="separator"
        aria-orientation="vertical"
        onPointerDown={handleDividerDown}
        className="group/divider relative w-1 shrink-0 cursor-ew-resize bg-border"
      >
        <div
          className={cn(
            'absolute inset-y-0 left-1/2 w-0.5 -translate-x-1/2 rounded-full transition-colors',
            'bg-transparent group-hover/divider:bg-primary',
          )}
        />
      </div>
      <div style={{ width: `${editorWidthPct}%` }} className="min-h-0 min-w-0 border-l border-border">
        <FileEditorSurface
          sdkClient={sdkClient}
          serverId={serverId}
          workspaceId={workspaceId}
        />
      </div>
    </div>
  );
}
