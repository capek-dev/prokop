import { useState, useEffect, useCallback, useRef } from 'react';
import { ChevronLeft, Folder, Loader2, Check, Search, HardDrive } from 'lucide-react';
import type { FileEntry } from '@prokopai/sdk';
import type { ProkopaiClient } from '@prokopai/sdk';
import { join } from '@/lib/path';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { ScrollArea } from '@/components/ui/scroll-area';
import { cn } from '@/lib/utils';
import { FOLDER_ICON_COLOR } from '@/components/files/fileIcons';
import { useFileBrowseFsQuery, useFileDrivesQuery, useFileParentQuery } from '@/hooks/queries';

interface FolderPickerDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSelect: (path: string) => void;
  initialPath?: string;
  title?: string;
  sdkClient: ProkopaiClient | null;
}

export function FolderPickerDialog({
  open,
  onOpenChange,
  onSelect,
  initialPath,
  title = 'Select Folder',
  sdkClient,
}: FolderPickerDialogProps) {
  const [currentPath, setCurrentPath] = useState(initialPath || '');
  const [navigatingPath, setNavigatingPath] = useState(initialPath || '');
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [searchQuery, setSearchQuery] = useState('');
  const [showDrives, setShowDrives] = useState(false);
  const [navigatingUp, setNavigatingUp] = useState(false);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  const { data: directoryData, isLoading: directoryLoading, error: directoryError, refetch: refetchDirectory } = useFileBrowseFsQuery(
    sdkClient,
    navigatingPath,
    open,
  );

  const { data: drivesData } = useFileDrivesQuery(sdkClient);

  const { error: parentError, refetch: refetchParent } = useFileParentQuery(
    sdkClient,
    currentPath,
    false,
  );

  const drives = drivesData?.drives ?? [];

  const directories = directoryData?.files?.filter((f: FileEntry) => f.type === 'directory') ?? [];
  const isRoot = directoryData?.isRoot ?? false;

  const loading = directoryLoading || navigatingUp;
  const error = directoryError || parentError;

  const filteredFiles = directories.filter(file => 
    file.name.toLowerCase().includes(searchQuery.toLowerCase())
  );

  const selectedFolder = filteredFiles[selectedIndex] ?? null;

  const getFullPath = useCallback((folder: FileEntry): string => {
    return join(currentPath, folder.name);
  }, [currentPath]);

  const targetPath = selectedFolder ? getFullPath(selectedFolder) : currentPath;
  const isUsingCurrentFolder = !selectedFolder;

  const handleNavigateUp = useCallback(() => {
    if (!sdkClient || isRoot) return;
    setNavigatingUp(true);
    refetchParent().then((result) => {
      if (result.data) {
        setCurrentPath(result.data.currentPath);
        setNavigatingPath(result.data.currentPath);
        setSelectedIndex(0);
        setSearchQuery('');
      }
      setNavigatingUp(false);
    }).catch(() => {
      setNavigatingUp(false);
    });
  }, [sdkClient, isRoot, refetchParent]);

  const handleNavigateInto = useCallback((folder: FileEntry) => {
    const newPath = getFullPath(folder);
    setCurrentPath(newPath);
    setNavigatingPath(newPath);
    setSelectedIndex(0);
    setSearchQuery('');
    setShowDrives(false);
  }, [getFullPath]);

  const handleSelectCurrent = () => {
    if (targetPath) {
      onSelect(targetPath);
      onOpenChange(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (filteredFiles.length === 0) return;

    switch (e.key) {
      case 'ArrowDown':
        e.preventDefault();
        setSelectedIndex(i => Math.min(i + 1, filteredFiles.length - 1));
        break;
      case 'ArrowRight':
        if (filteredFiles[selectedIndex]) {
          e.preventDefault();
          handleNavigateInto(filteredFiles[selectedIndex]);
        }
        break;
      case 'ArrowUp':
        e.preventDefault();
        setSelectedIndex(i => Math.max(i - 1, 0));
        break;
      case 'Enter':
        e.preventDefault();
        handleSelectCurrent();
        break;
      case 'Escape':
        if (searchQuery) {
          e.preventDefault();
          setSearchQuery('');
        }
        break;
    }
  };

  useEffect(() => {
    if (open) {
      const startPath = initialPath || '';
      setCurrentPath(startPath);
      setNavigatingPath(startPath);
      setSelectedIndex(0);
      setSearchQuery('');
    }
  }, [open, initialPath]);

  // Sync with the server's resolved path. The server may resolve our requested
  // path differently (e.g., '' → homedir()), so we adopt the server's
  // authoritative currentPath to prevent relative paths from leaking into
  // join() calls during navigation.
  const serverCurrentPath = directoryData?.currentPath;
  useEffect(() => {
    if (serverCurrentPath && serverCurrentPath !== navigatingPath) {
      setCurrentPath(serverCurrentPath);
      setNavigatingPath(serverCurrentPath);
    }
  }, [serverCurrentPath, navigatingPath]);

  useEffect(() => {
    setSelectedIndex(0);
  }, [searchQuery]);

  useEffect(() => {
    if (listRef.current && filteredFiles.length > 0) {
      const selectedElement = listRef.current.children[selectedIndex] as HTMLElement;
      if (selectedElement) {
        selectedElement.scrollIntoView({ block: 'nearest' });
      }
    }
  }, [selectedIndex, filteredFiles.length]);

  useEffect(() => {
    if (open) {
      setTimeout(() => searchInputRef.current?.focus(), 100);
    }
  }, [open]);

  useEffect(() => {
    setShowDrives(false);
  }, [currentPath]);

  const truncatePath = (path: string, maxLength: number = 50) => {
    if (path.length <= maxLength) return path;
    const parts = path.split(/[/\\]/);
    if (parts.length <= 2) return path;
    return '.../' + parts.slice(-2).join('/');
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg" onKeyDown={handleKeyDown}>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
        </DialogHeader>
        
        <div className="space-y-3">
          <div className="flex items-center gap-2 p-2 bg-muted rounded-md">
            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7 flex-shrink-0"
              onClick={handleNavigateUp}
              disabled={loading || !currentPath || isRoot}
            >
              <ChevronLeft className="w-4 h-4" />
            </Button>
            {drives.length > 1 && (
              <div className="relative">
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-7 w-7 flex-shrink-0"
                  onClick={() => setShowDrives(prev => !prev)}
                  disabled={loading}
                >
                  <HardDrive className="w-4 h-4" />
                </Button>
                {showDrives && (
                  <div className="absolute top-full left-0 mt-1 bg-popover border rounded-md shadow-md z-50 min-w-[120px]">
                    {drives.map(drive => (
                      <button
                        key={drive}
                        onClick={() => {
                          setCurrentPath(drive);
                          setNavigatingPath(drive);
                          setShowDrives(false);
                          setSelectedIndex(0);
                          setSearchQuery('');
                        }}
                        className={cn(
                          'flex items-center gap-2 w-full px-3 py-1.5 text-sm text-left hover:bg-muted',
                          currentPath === drive && 'bg-primary/20 text-primary font-medium'
                        )}
                      >
                        <Folder className={cn('w-3.5 h-3.5', FOLDER_ICON_COLOR)} />
                        {drive}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}
            <span className="flex-1 text-sm font-mono truncate" title={targetPath}>
              {selectedFolder ? (
                <span className="text-primary">
                  {truncatePath(getFullPath(selectedFolder), 45)}
                </span>
              ) : (
                truncatePath(currentPath) || 'Home'
              )}
            </span>
          </div>
          
          <div className="relative">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
            <Input
              ref={searchInputRef}
              placeholder="Filter folders..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="pl-8"
            />
          </div>
          
          <ScrollArea className="h-64 border rounded-md">
            {loading ? (
              <div className="flex items-center justify-center h-full text-muted-foreground">
                <Loader2 className="w-4 h-4 animate-spin mr-2" />
                Loading...
              </div>
            ) : error ? (
              <div className="flex flex-col items-center justify-center h-full text-muted-foreground">
                <span className="text-destructive">{error.message}</span>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => { setNavigatingPath(currentPath); refetchDirectory(); }}
                  className="mt-2"
                >
                  Retry
                </Button>
              </div>
            ) : filteredFiles.length === 0 ? (
              <div className="flex flex-col items-center justify-center h-full text-muted-foreground text-sm">
                <Folder className="w-8 h-8 mb-2 opacity-50" />
                {searchQuery ? 'No matching folders' : 'No folders in this directory'}
              </div>
            ) : (
              <div className="p-1" ref={listRef}>
                {filteredFiles.map((file, index) => (
                  <button
                    key={file.path}
                    onClick={() => setSelectedIndex(index)}
                    onDoubleClick={() => handleNavigateInto(file)}
                    className={cn(
                      'flex items-center gap-2 w-full px-2 py-1.5 rounded text-sm text-left',
                      'hover:bg-muted',
                      index === selectedIndex && 'bg-primary/20 text-primary font-medium ring-1 ring-primary/50'
                    )}
                  >
                    <Folder className={cn('w-4 h-4 flex-shrink-0', FOLDER_ICON_COLOR)} />
                    <span className="truncate flex-1">{file.name}</span>
                    {index === selectedIndex && (
                      <Check className="w-4 h-4 text-primary" />
                    )}
                  </button>
                ))}
              </div>
            )}
          </ScrollArea>
          
          {error && (
            <p className="text-xs text-destructive">{error.message}</p>
          )}
        </div>
        
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={handleSelectCurrent} disabled={!targetPath || loading}>
            {isUsingCurrentFolder ? 'Use This Folder' : 'Add Selected Folder'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
