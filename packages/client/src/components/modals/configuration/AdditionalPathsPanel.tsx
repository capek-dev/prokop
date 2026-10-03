import { useState } from 'react';
import { Folder, Plus, X } from 'lucide-react';
import type { Workspace } from '@prokopai/sdk';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { FolderPickerDialog } from '../FolderPickerDialog';
import { FOLDER_ICON_COLOR } from '@/components/files/fileIcons';

interface AdditionalPathsPanelProps {
  workspace: Workspace;
  paths: string[];
  onChange: (paths: string[]) => void;
  sdkClient: import('@prokopai/sdk').ProkopaiClient | null;
}

export function AdditionalPathsPanel({
  workspace,
  paths,
  onChange,
  sdkClient,
}: AdditionalPathsPanelProps) {
  const [folderPickerOpen, setFolderPickerOpen] = useState(false);

  const handleRemove = (pathToRemove: string) => {
    onChange(paths.filter(p => p !== pathToRemove));
  };

  const handleAddFolder = (folderPath: string) => {
    if (!paths.includes(folderPath)) {
      onChange([...paths, folderPath]);
    }
  };

  return (
    <div className="flex flex-col gap-3 p-3 sm:p-4">
      <p className="text-sm text-muted-foreground">
        Add directories the agent can access alongside {workspace.name}. The agent will use absolute paths for these directories.
      </p>

      {paths.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-6 text-muted-foreground text-sm border rounded-md">
          <Folder className="w-8 h-8 mb-2 opacity-50" />
          No additional paths configured
        </div>
      ) : (
        <div className="dialog-scrollbar max-h-64 overflow-y-auto rounded-md border">
          <div className="flex flex-col gap-1 p-2">
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
                  aria-label={`Remove ${path}`}
                  className="size-6"
                  onClick={() => handleRemove(path)}
                >
                  <X className="w-3 h-3" />
                </Button>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="flex items-center gap-2">
        <Button
          variant="outline"
          size="sm"
          onClick={() => setFolderPickerOpen(true)}
        >
          <Plus data-icon="inline-start" />
          Add Path
        </Button>
      </div>

      {folderPickerOpen && <FolderPickerDialog
        open={folderPickerOpen}
        onOpenChange={setFolderPickerOpen}
        onSelect={handleAddFolder}
        title="Select Additional Path"
        sdkClient={sdkClient}
      />}
    </div>
  );
}
