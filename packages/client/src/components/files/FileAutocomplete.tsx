import { useState, useEffect, useRef } from 'react';
import { File, Folder, Loader2 } from 'lucide-react';
import type { FileEntry } from '@prokopai/sdk';
import type { ProkopaiClient } from '@prokopai/sdk';
import { cn } from '@/lib/utils';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { FOLDER_ICON_COLOR } from './fileIcons';

interface FileAutocompleteProps {
  workspaceId: string;
  searchQuery: string;
  selectedIndex: number;
  tooltipIndex: number | null;
  onTooltipIndexChange: (index: number | null) => void;
  onSelect: (file: FileEntry) => void;
  onFilesChange: (files: FileEntry[]) => void;
  showHidden?: boolean;
  sdkClient?: ProkopaiClient | null;
}

function splitPath(filePath: string): { fileName: string; dirPath: string } {
  const lastSlash = filePath.lastIndexOf('/');
  if (lastSlash === -1) {
    return { fileName: filePath, dirPath: '' };
  }
  return {
    fileName: filePath.slice(lastSlash + 1),
    dirPath: filePath.slice(0, lastSlash + 1),
  };
}

export function FileAutocomplete({
  workspaceId,
  searchQuery,
  selectedIndex,
  tooltipIndex,
  onTooltipIndexChange,
  onSelect,
  onFilesChange,
  showHidden = true,
  sdkClient,
}: FileAutocompleteProps) {
  const [files, setFiles] = useState<FileEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [debouncedQuery, setDebouncedQuery] = useState(searchQuery);
  const queryIdRef = useRef(0);

  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedQuery(searchQuery);
    }, 300);

    return () => clearTimeout(timer);
  }, [searchQuery]);

  useEffect(() => {
    if (!debouncedQuery || debouncedQuery.length < 2 || !sdkClient) {
      setFiles([]);
      onFilesChange([]);
      return;
    }

    const queryId = ++queryIdRef.current;
    setLoading(true);
    setError(null);

    const controller = new AbortController();

    sdkClient?.httpClient
      .get<{ files: FileEntry[] }>(`/workspaces/${workspaceId}/files`, {
        params: { search: debouncedQuery, showHidden: String(showHidden) },
        signal: controller.signal,
      })
      .then(data => {
        if (queryId !== queryIdRef.current) return;
        const newFiles = data.files || [];
        setFiles(newFiles);
        onFilesChange(newFiles);
      })
      .catch(err => {
        if (err instanceof Error && err.name !== 'AbortError') {
          // Transient network failures (e.g. a superseded search aborting a
          // mid-flight glob on the server) must not wedge the popover. Record
          // the error so the next keystroke can recover instead of leaving the
          // component in a loading state with no results and no way forward.
          if (queryId === queryIdRef.current) {
            setError(err.message || 'Search failed');
            setLoading(false);
          }
          console.error('File search failed:', err);
        }
      })
      .finally(() => {
        if (queryId === queryIdRef.current) setLoading(false);
      });

    return () => controller.abort();
  }, [workspaceId, debouncedQuery, onFilesChange, showHidden, sdkClient]);

  if (!searchQuery || searchQuery.length < 2) {
    return (
      <div className="p-2 text-xs text-muted-foreground">
        Type at least 2 characters to search files...
      </div>
    );
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center p-4 text-muted-foreground">
        <Loader2 className="w-4 h-4 animate-spin mr-2" />
        Searching...
      </div>
    );
  }

  if (error && files.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center gap-2 p-4 text-muted-foreground">
        <span className="text-xs">Search failed.</span>
        <span className="text-[11px]">Keep typing to retry.</span>
      </div>
    );
  }

  if (files.length === 0) {
    return (
      <div className="p-2 text-xs text-muted-foreground">
        No files found matching &quot;{searchQuery}&quot;
      </div>
    );
  }

  return (
    <div className="p-1">
      {files.map((file, index) => {
        const { fileName, dirPath } = splitPath(file.path);

        return (
          <Tooltip
            key={file.path}
            open={tooltipIndex === index ? true : undefined}
            onOpenChange={(open) => {
              if (!open) onTooltipIndexChange(null);
            }}
          >
            <TooltipTrigger asChild>
              <button
                onClick={() => onSelect(file)}
                className={cn(
                  'flex items-center gap-2 w-full px-2 py-1.5 rounded text-sm text-left',
                  'hover:bg-muted',
                  index === selectedIndex && 'bg-primary/20 text-primary font-medium ring-1 ring-primary/50'
                )}
              >
                {file.type === 'directory' ? (
                  <Folder className={cn('w-4 h-4 flex-shrink-0', FOLDER_ICON_COLOR)} />
                ) : (
                  <File className="w-4 h-4 text-muted-foreground flex-shrink-0" />
                )}
                <span className="truncate flex-1 min-w-0">
                  {dirPath && (
                    <span className="text-muted-foreground">{dirPath}</span>
                  )}
                  <span>{fileName}</span>
                </span>
                {file.extension && (
                  <span className="text-xs text-muted-foreground flex-shrink-0">{file.extension}</span>
                )}
              </button>
            </TooltipTrigger>
            <TooltipContent side="right" sideOffset={8} showArrow={false} className="max-w-md bg-popover text-popover-foreground shadow-md ring-1 ring-foreground/10">
              <span className="font-mono text-xs break-all">{file.path}</span>
            </TooltipContent>
          </Tooltip>
        );
      })}
      <div className="mt-1 pt-1 border-t text-xs text-muted-foreground px-2">
        {files.length} result{files.length !== 1 ? 's' : ''} &bull;
        <kbd className="ml-1 px-1 py-0.5 bg-muted rounded text-[10px]">↑↓</kbd> navigate
        <kbd className="ml-1 px-1 py-0.5 bg-muted rounded text-[10px]">↵</kbd> select
        <kbd className="ml-1 px-1 py-0.5 bg-muted rounded text-[10px]">esc</kbd> close
        <kbd className="ml-1 px-1 py-0.5 bg-muted rounded text-[10px]">→</kbd> preview path
      </div>
    </div>
  );
}
