import { useState } from 'react';
import { Zap, Server, Trash2 } from 'lucide-react';
import { useNavigate } from '@tanstack/react-router';
import { Button } from '@/components/ui/button';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover';
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from '@/components/ui/sheet';
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandItem,
  CommandList,
} from '@/components/ui/command';
import { useServerContext } from '@/contexts/ServerContext';
import { useIsMobile } from '@/hooks/use-mobile';
import type { QuickConnection } from '@prokopai/sdk';

interface QuickSwitcherProps {
  onSelectWorkspace?: (workspaceId: string) => void;
}

export function QuickSwitcher({ onSelectWorkspace }: QuickSwitcherProps) {
  const [open, setOpen] = useState(false);
  const navigate = useNavigate();
  const isMobile = useIsMobile();
  const {
    quickConnections,
    removeFromQuickConnections,
  } = useServerContext();

  const handleSelectConnection = (conn: QuickConnection) => {
    setOpen(false);
    // Navigate to the server first, then optionally select workspace
    navigate({ to: '/server/$serverId', params: { serverId: conn.serverId } });
    if (conn.workspaceId && onSelectWorkspace) {
      // Small delay to let the navigation settle
      setTimeout(() => {
        onSelectWorkspace(conn.workspaceId!);
      }, 50);
    }
  };

  const handleRemoveQuickConnection = (
    e: React.MouseEvent,
    connectionId: string,
  ) => {
    e.stopPropagation();
    removeFromQuickConnections(connectionId);
  };

  const renderContent = () => (
    <Command>
      <CommandList className="max-h-[50vh] overflow-y-auto">
        {quickConnections.length > 0 ? (
          <CommandGroup heading="Quick Switch">
            {quickConnections.map((conn) => (
              <CommandItem
                key={conn.id}
                onSelect={() => handleSelectConnection(conn)}
                className="justify-between"
              >
                <div className="flex items-center gap-2">
                  <Server className="size-4 text-muted-foreground" />
                  <span>
                    {conn.serverName}
                    {conn.workspaceName && (
                      <span className="text-muted-foreground">
                        {' / '}
                        {conn.workspaceName}
                      </span>
                    )}
                  </span>
                </div>
                <button
                  className="opacity-0 group-hover:opacity-100 hover:opacity-100 transition-opacity p-1 rounded hover:bg-destructive/10"
                  onClick={(e) => handleRemoveQuickConnection(e, conn.id)}
                >
                  <Trash2 className="size-3 text-destructive" />
                </button>
              </CommandItem>
            ))}
          </CommandGroup>
        ) : (
          <CommandEmpty className="py-6">
            <div className="flex flex-col items-center gap-2 text-muted-foreground">
              <Zap className="size-8" />
              <p className="text-sm font-medium">No favorites yet</p>
              <p className="text-xs">Star a workspace to add it here</p>
            </div>
          </CommandEmpty>
        )}
      </CommandList>
    </Command>
  );

  if (isMobile) {
    return (
      <Sheet open={open} onOpenChange={setOpen}>
        <SheetTrigger asChild>
          <Button variant="ghost" size="icon-sm" aria-label="Quick switch">
            <Zap className="size-4" />
          </Button>
        </SheetTrigger>
        <SheetContent side="bottom" className="max-h-[80vh]">
          <SheetHeader>
            <SheetTitle>Quick Switch</SheetTitle>
          </SheetHeader>
          <div className="mt-4">{renderContent()}</div>
        </SheetContent>
      </Sheet>
    );
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button variant="ghost" size="icon-sm" aria-label="Quick switch">
          <Zap className="size-4" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-[300px] p-0" align="start">
        {renderContent()}
      </PopoverContent>
    </Popover>
  );
}
