import { useState, useEffect } from 'react';
import { Folder, Plus, X, FolderSymlink } from 'lucide-react';
import type { Workspace } from '@prokopai/sdk';
import { cn } from '@/lib/utils';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import { FolderPickerDialog } from './FolderPickerDialog';
import { FOLDER_ICON_COLOR } from '@/components/files/fileIcons';

interface WorkspaceAdditionalPathsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  workspace: Workspace;
  onSave: (workspaceId: string, additionalPaths: string[]) => void;
  isSaving?: boolean;
  sdkClient: import('@prokopai/sdk').ProkopaiClient | null;
}

export function WorkspaceAdditionalPathsDialog({
  open,
  onOpenChange,
  workspace,
  onSave,
  isSaving = false,
  sdkClient,
}: WorkspaceAdditionalPathsDialogProps) {
  const [paths, setPaths] = useState<string[]>([]);
  const [folderPickerOpen, setFolderPickerOpen] = useState(false);

  useEffect(() => {
    if (open) {
      setPaths(workspace.additionalPaths ?? []);
    }
  }, [open, workspace.additionalPaths]);

  const handleRemove = (pathToRemove: string) => {
    setPaths(prev => prev.filter(p => p !== pathToRemove));
  };

  const handleAddFolder = (folderPath: string) => {
    if (!paths.includes(folderPath)) {
      setPaths(prev => [...prev, folderPath]);
    }
  };

  const handleSave = () => {
    onSave(workspace.id, paths);
    onOpenChange(false);
  };

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <FolderSymlink className="size-5" />
              Additional Paths
            </DialogTitle>
            <DialogDescription>
              Add directories the agent can access alongside {workspace.name}. The agent will use absolute paths for these directories.
            </DialogDescription>
          </DialogHeader>

          <div className="mt-4 space-y-3">

            {paths.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-6 text-muted-foreground text-sm border rounded-md">
                <Folder className="w-8 h-8 mb-2 opacity-50" />
                No additional paths configured
              </div>
            ) : (
              <ScrollArea className="max-h-64 border rounded-md">
                <div className="p-2 space-y-1">
                  {paths.map((path) => (
                    <div
                      key={path}
                      className="flex items-center gap-2 px-2 py-1.5 rounded text-sm hover:bg-muted group"
                    >
                      <Folder className={cn('w-4 h-4 flex-shrink-0', FOLDER_ICON_COLOR)} />
                      <span className="font-mono text-xs truncate flex-1" title={path}>{path}</span>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-6 w-6 opacity-0 group-hover:opacity-100"
                        onClick={() => handleRemove(path)}
                      >
                        <X className="w-3 h-3" />
                      </Button>
                    </div>
                  ))}
                </div>
              </ScrollArea>
            )}

            <Button
              variant="outline"
              size="sm"
              className="w-full"
              onClick={() => setFolderPickerOpen(true)}
            >
              <Plus className="w-4 h-4 mr-2" />
              Add Path
            </Button>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button onClick={handleSave} disabled={isSaving}>
              {isSaving ? 'Saving...' : 'Save'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <FolderPickerDialog
        open={folderPickerOpen}
        onOpenChange={setFolderPickerOpen}
        onSelect={handleAddFolder}
        title="Select Additional Path"
        sdkClient={sdkClient}
      />
    </>
  );
}
