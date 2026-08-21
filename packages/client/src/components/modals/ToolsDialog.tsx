import type { ProkopaiClient } from '@prokopai/sdk';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { ToolsPanel } from './tools/ToolsPanel';

interface ToolsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  sdkClient: ProkopaiClient | null;
}

export function ToolsDialog({
  open,
  onOpenChange,
  sdkClient,
}: ToolsDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex flex-col overflow-hidden p-3 sm:p-4 gap-3 sm:gap-4 max-w-[calc(100vw-0.5rem)] sm:max-w-[800px] sm:max-h-[85vh]">
        <DialogHeader className="shrink-0">
          <DialogTitle>Tools</DialogTitle>
          <DialogDescription>
            View loaded tools and manage their environment variables
          </DialogDescription>
        </DialogHeader>

        <div className="dialog-scrollbar flex-1 min-h-0 overflow-y-auto overscroll-contain rounded-lg border">
          <ToolsPanel sdkClient={sdkClient} />
        </div>
      </DialogContent>
    </Dialog>
  );
}
