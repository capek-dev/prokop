import { useState } from 'react';
import {
  Loader2,
  AlertCircle,
  RefreshCw,
  FileX,
  FilePenLine,
  FileIcon,
  Eye,
  Code2,
} from 'lucide-react';
import type { ProkopaiClient } from '@prokopai/sdk';
import type { FilePreviewTarget } from '@/stores/uiStore';
import {
  Dialog,
  DialogContent,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { MarkdownRenderer } from '@/components/shared/MarkdownRenderer';
import { FileCodeView } from './FileCodeView';
import FilePreviewContent from './FilePreviewContent';
import { fileIconColor } from './fileIcons';
import { useFilePreview } from '@/hooks/useFilePreview';
import { useFileGitDiffQuery } from '@/hooks/queries';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

interface FilePreviewOverlayProps {
  workspaceId: string | undefined;
  target: FilePreviewTarget | null;
  sdkClient: ProkopaiClient | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onOpenEdit?: () => void;
}

function hasContent(preview: { kind: string }): preview is { kind: 'code' | 'text' | 'markdown'; content: string } {
  return preview.kind === 'code' || preview.kind === 'text' || preview.kind === 'markdown';
}

function isFileNotFoundError(error: unknown): boolean {
  if (typeof error !== 'object' || error === null) return false;
  return 'statusCode' in error && error.statusCode === 404;
}

export default function FilePreviewOverlay({
  workspaceId,
  target,
  sdkClient,
  open,
  onOpenChange,
  onOpenEdit,
}: FilePreviewOverlayProps) {
  const [mdView, setMdView] = useState<'preview' | 'source'>('preview');

  const { data, loading, refreshing, error, errorCause, reload } = useFilePreview({
    workspaceId,
    path: target?.path,
    root: target?.root,
    sdkClient,
    enabled: open && !!target && !!workspaceId,
  });

  const diffQuery = useFileGitDiffQuery(
    sdkClient,
    workspaceId,
    target?.path,
    target?.root,
    open && !!target && !!workspaceId,
  );

  const diffRefreshing = diffQuery.isFetching && !diffQuery.isLoading;
  const isRefreshing = refreshing || diffRefreshing;

  const diffData = diffQuery.data?.diffAvailable ? diffQuery.data : undefined;

  const isDeletedFile =
    !!error &&
    !!diffData &&
    (
      diffData.status?.status === 'deleted' ||
      (isFileNotFoundError(errorCause) && diffData.deletions > 0)
    );

  const handleRefresh = () => {
    reload();
    void diffQuery.refetch();
  };

  if (!target) return null;

  const isMarkdown = data?.kind === 'markdown';

  const formatSize = (bytes: number): string => {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  };

  const diffProp = diffData
    ? { hunks: diffData.hunks, additions: diffData.additions, deletions: diffData.deletions }
    : undefined;

  const renderBody = () => {
    if (loading) {
      return (
        <div
          role="status"
          aria-label="Loading file preview"
          className="flex items-center justify-center h-full"
        >
          <Loader2 className="size-5 animate-spin text-muted-foreground" />
        </div>
      );
    }

    // Deleted-file diff-only state: the file no longer exists on disk but
    // the Git diff shows the removal. Render the diff instead of the error.
    if (isDeletedFile && diffData) {
      return (
        <div className="flex flex-col h-full">
          <div className="flex items-center gap-2 px-3 py-2 border-b border-border shrink-0">
            <FileX className="size-4 text-muted-foreground" />
            <span className="text-xs text-muted-foreground">
              This file was deleted. Showing the deletion diff.
            </span>
          </div>
          <div className="flex-1 min-h-0 overflow-hidden">
            <FileCodeView
              name={target.name}
              content=""
              diff={diffProp}
            />
          </div>
        </div>
      );
    }

    if (error) {
      return (
        <div className="flex flex-col items-center justify-center h-full text-center p-8">
          <AlertCircle className="size-8 text-muted-foreground mb-3" />
          <p className="text-sm text-muted-foreground mb-3">{error}</p>
          <Button variant="outline" size="sm" onClick={reload}>
            <RefreshCw className="size-3.5" />
            Retry
          </Button>
        </div>
      );
    }

    if (!data) return null;

    // Markdown: Preview / Source tabs (TabsContent pair rendered by the caller
    // so the TabsList can live in the header toolbar).
    if (isMarkdown && data.kind === 'markdown') {
      return (
        <>
          <TabsContent
            value="preview"
            className="mt-0 h-full overflow-y-auto overscroll-contain p-4 sm:p-6 chat-transcript-scrollbar"
          >
            <MarkdownRenderer>{data.content}</MarkdownRenderer>
          </TabsContent>
          <TabsContent value="source" className="mt-0 h-full">
            <FileCodeView
              name={target.name}
              content={data.content}
              language={data.language}
              diff={diffProp}
            />
          </TabsContent>
        </>
      );
    }

    // Code / text: unified code view with diff highlights
    if (hasContent(data)) {
      return (
        <FileCodeView
          name={target.name}
          content={data.content}
          language={data.language}
          diff={diffProp}
        />
      );
    }

    // Binary, too large, unsupported — keep existing status panels
    return <FilePreviewContent preview={data} />;
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        showCloseButton={true}
        className="flex w-[min(92vw,1100px)] sm:max-w-5xl h-[85dvh] sm:h-[85vh] flex-col overflow-hidden p-0 gap-0"
      >
        <Tabs
          value={mdView}
          onValueChange={(v) => setMdView(v as 'preview' | 'source')}
          className="flex-1 min-h-0 gap-0"
        >
          {/* Toolbar: icon, name, diff stats, markdown toggle, actions.
              pr-12 keeps the cluster clear of the dialog close button. */}
          <div className="flex shrink-0 items-center gap-2 border-b border-border px-3 py-2 pr-12">
            <FileIcon className={cn('size-4 shrink-0', fileIconColor(target.path))} />
            <DialogTitle
              className="min-w-0 flex-1 truncate text-sm font-medium"
              title={target.path}
            >
              {target.name}
            </DialogTitle>

            <div className="ml-auto flex shrink-0 items-center gap-1.5">
              {isDeletedFile && (
                <span className="rounded bg-destructive/10 px-1.5 py-0.5 text-xs text-destructive">
                  deleted
                </span>
              )}
              {diffData && (diffData.additions > 0 || diffData.deletions > 0) && (
                <span className="flex items-center gap-1 text-[10px] font-medium">
                  {diffData.additions > 0 && (
                    <span className="text-green-600 dark:text-green-400">+{diffData.additions}</span>
                  )}
                  {diffData.deletions > 0 && (
                    <span className="text-red-600 dark:text-red-400">-{diffData.deletions}</span>
                  )}
                </span>
              )}
              {isMarkdown && (
                <TabsList className="h-7">
                  <TabsTrigger value="preview" className="px-2 text-xs">
                    <Eye className="size-3" />
                    Preview
                  </TabsTrigger>
                  <TabsTrigger value="source" className="px-2 text-xs">
                    <Code2 className="size-3" />
                    Source
                  </TabsTrigger>
                </TabsList>
              )}
              <Button
                variant="ghost"
                size="icon-sm"
                onClick={handleRefresh}
                disabled={isRefreshing}
                title="Refresh file"
              >
                <RefreshCw className={cn('size-3.5', isRefreshing && 'animate-spin')} />
              </Button>
              <Button
                size="sm"
                onClick={onOpenEdit}
                disabled={!onOpenEdit || isDeletedFile}
                className="shrink-0"
              >
                <FilePenLine data-icon="inline-start" />
                Edit
              </Button>
            </div>
          </div>

          {/* Meta line: path, size, language, rename. Stable two-row header
              (path is always known) so loading does not shift layout. */}
          <DialogDescription className="flex shrink-0 items-center gap-2 border-b border-border bg-muted/30 px-3 py-1.5 pr-12 text-xs text-muted-foreground">
            <span className="min-w-0 flex-1 truncate font-mono" title={target.path}>
              {target.path}
            </span>
            {data && (
              <span className="shrink-0">{formatSize(data.size)}</span>
            )}
            {data?.language && (
              <span className="shrink-0 capitalize">{data.language}</span>
            )}
            {diffData?.status?.oldPath && (
              <span
                className="shrink-0 truncate max-w-40"
                title={`Renamed from ${diffData.status.oldPath}`}
              >
                from {diffData.status.oldPath}
              </span>
            )}
          </DialogDescription>

          <div className="min-h-0 flex-1 overflow-hidden">
            {renderBody()}
          </div>
        </Tabs>
      </DialogContent>
    </Dialog>
  );
}
