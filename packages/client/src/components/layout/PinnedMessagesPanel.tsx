import { useState } from 'react';
import { ChevronRight, PinOff, Pin, Loader2 } from 'lucide-react';
import type { ProkopaiClient, PinnedMessage } from '@prokopai/sdk';
import { Button } from '@/components/ui/button';
import { usePinnedMessagesQuery, useUnpinMessageMutation } from '@/hooks/queries';
import {
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarSeparator,
} from '@/components/ui/sidebar';
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@/components/ui/collapsible';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';

interface PinnedMessagesPanelProps {
  sdkClient: ProkopaiClient | null;
  workspaceId: string;
  currentSessionId: string | null;
  onNavigateToPinnedMessage: (sessionId: string, messageId: string) => void;
}

function formatRelativeTime(timestamp: number): string {
  const now = Date.now();
  const diff = now - timestamp;
  const seconds = Math.floor(diff / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);

  if (days > 7) return new Date(timestamp).toLocaleDateString();
  if (days > 0) return `${days}d ago`;
  if (hours > 0) return `${hours}h ago`;
  if (minutes > 0) return `${minutes}m ago`;
  return 'just now';
}

function PinnedMessageItem({
  pin,
  isCurrentSession,
  onNavigate,
  onUnpin,
}: {
  pin: PinnedMessage;
  isCurrentSession: boolean;
  onNavigate: () => void;
  onUnpin: () => void;
}) {
  return (
    <div
      className={cn(
        'group flex min-w-0 max-w-full flex-col gap-1 rounded-md p-2 cursor-pointer overflow-hidden',
        'hover:bg-sidebar-accent hover:text-sidebar-accent-foreground',
        'transition-colors',
        isCurrentSession && 'bg-sidebar-accent/60',
      )}
      onClick={onNavigate}
    >
      <div className="flex min-w-0 items-start justify-between gap-1">
        <div className="flex flex-col gap-0.5 min-w-0 flex-1">
          <span className="text-xs font-medium text-sidebar-foreground/80 truncate">
            {pin.sessionTitle || 'Untitled session'}
          </span>
          <span className="text-xs text-muted-foreground line-clamp-2 break-words [overflow-wrap:anywhere]">
            {pin.preview}
          </span>
          <span className="text-[10px] text-muted-foreground/60">
            {formatRelativeTime(pin.createdAt)}
          </span>
        </div>
        <Button
          variant="ghost"
          size="icon"
          onClick={(e) => {
            e.stopPropagation();
            onUnpin();
          }}
          className="size-6 shrink-0 text-muted-foreground hover:text-foreground opacity-0 group-hover:opacity-100 transition-opacity"
          title="Unpin message"
        >
          <PinOff className="size-3" />
        </Button>
      </div>
    </div>
  );
}

export function PinnedMessagesPanel({
  sdkClient,
  workspaceId,
  currentSessionId,
  onNavigateToPinnedMessage,
}: PinnedMessagesPanelProps) {
  const [open, setOpen] = useState(true);
  const { data: pinnedMessages, isLoading } = usePinnedMessagesQuery(sdkClient, workspaceId);
  const unpinMutation = useUnpinMessageMutation(sdkClient, workspaceId);

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-4">
        <Loader2 className="size-4 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!pinnedMessages || pinnedMessages.length === 0) {
    return null;
  }

  return (
    <>
      <SidebarSeparator />
      <Collapsible open={open} onOpenChange={setOpen} className="group/collapsible min-w-0">
        <SidebarGroup className="min-w-0 overflow-hidden">
          <SidebarGroupLabel asChild>
            <CollapsibleTrigger className="flex min-w-0 cursor-pointer items-center justify-between gap-2">
              <span className="flex min-w-0 items-center gap-2">
                <ChevronRight className="size-3 shrink-0 transition-transform duration-200 group-data-[state=open]/collapsible:rotate-90" />
                <Pin className="size-3 shrink-0" />
                <span className="truncate">Pinned</span>
              </span>
              <Badge variant="secondary" className="shrink-0">
                {pinnedMessages.length}
              </Badge>
            </CollapsibleTrigger>
          </SidebarGroupLabel>
          <CollapsibleContent>
            <SidebarGroupContent className="min-w-0 overflow-hidden">
              <div className="flex min-w-0 max-w-full flex-col gap-0.5 overflow-hidden">
                {pinnedMessages.map((pin) => (
                  <PinnedMessageItem
                    key={pin.id}
                    pin={pin}
                    isCurrentSession={pin.sessionId === currentSessionId}
                    onNavigate={() => onNavigateToPinnedMessage(pin.sessionId, pin.messageId)}
                    onUnpin={() => unpinMutation.mutate({ messageId: pin.messageId })}
                  />
                ))}
              </div>
            </SidebarGroupContent>
          </CollapsibleContent>
        </SidebarGroup>
      </Collapsible>
    </>
  );
}
