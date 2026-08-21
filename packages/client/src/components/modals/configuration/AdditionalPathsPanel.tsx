import { useState, useEffect } from 'react';
import { Folder, Plus, X, FolderSymlink } from 'lucide-react';
import type { Workspace } from '@prokopai/sdk';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import { FolderPickerDialog } from '../FolderPickerDialog';
import { FOLDER_ICON_COLOR } from '@/components/files/fileIcons';

interface AdditionalPathsPanelProps {
  workspace: Workspace;
  onSave: (workspaceId: string, additionalPaths: string[]) => void;
  sdkClient: import('@prokopai/sdk').ProkopaiClient | null;
}

export function AdditionalPathsPanel({
  workspace,
  onSave,
  sdkClient,
}: AdditionalPathsPanelProps) {
  const [paths, setPaths] = useState<string[]>([]);
  const [folderPickerOpen, setFolderPickerOpen] = useState(false);

  useEffect(() => {
    setPaths(workspace.additionalPaths ?? []);
  }, [workspace.additionalPaths]);

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
  };

  return (
    <div className="p-3 sm:p-4 space-y-3">
      <p className="text-sm text-muted-foreground">
        Add directories the agent can access alongside {workspace.name}. The agent will use absolute paths for these directories.
      </p>

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

      <div className="flex items-center gap-2">
        <Button
          variant="outline"
          size="sm"
          onClick={() => setFolderPickerOpen(true)}
        >
          <Plus className="w-4 h-4 mr-2" />
          Add Path
        </Button>
        <Button
          size="sm"
          onClick={handleSave}
        >
          <FolderSymlink className="w-4 h-4 mr-2" />
          Save
        </Button>
      </div>

      <FolderPickerDialog
        open={folderPickerOpen}
        onOpenChange={setFolderPickerOpen}
        onSelect={handleAddFolder}
        title="Select Additional Path"
        sdkClient={sdkClient}
      />
    </div>
  );
}
