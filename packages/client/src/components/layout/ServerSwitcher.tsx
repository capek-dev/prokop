import { useState } from 'react';
import type { SavedServer } from '@prokopai/sdk';
import {
  Check,
  ChevronsUpDown,
  Home,
  MoreHorizontal,
  Pencil,
  Plus,
  Server,
} from 'lucide-react';
import { useNavigate, useParams } from '@tanstack/react-router';
import { RenameServerDialog } from '@/components/modals/RenameServerDialog';
import { Button } from '@/components/ui/button';
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
} from '@/components/ui/command';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover';
import { useServerContext } from '@/contexts/ServerContext';
import { cn } from '@/lib/utils';

interface ServerSwitcherProps {
  compact?: boolean;
}

export function ServerSwitcher({ compact }: ServerSwitcherProps) {
  const [open, setOpen] = useState(false);
  const [renameTarget, setRenameTarget] = useState<SavedServer | null>(null);
  const navigate = useNavigate();
  const { servers, renameServer } = useServerContext();

  const params = useParams({ from: '/server/$serverId' });
  const currentServerId = params.serverId ?? null;
  const currentServerName = servers.find(
    (server) => server.id === currentServerId,
  )?.name ?? 'Select server';

  const handleSelectServer = (serverId: string) => {
    void navigate({ to: '/server/$serverId', params: { serverId } });
    setOpen(false);
  };

  const handleAddServer = () => {
    void navigate({ to: '/add-server' });
    setOpen(false);
  };

  const handleGoHome = () => {
    void navigate({ to: '/', search: { select: true } });
    setOpen(false);
  };

  const handleRename = (server: SavedServer) => {
    setOpen(false);
    setRenameTarget(server);
  };

  const serverList = (
    <>
      <CommandGroup heading="Servers">
        {servers.map((server) => (
          <CommandItem
            key={server.id}
            showCheck={false}
            onSelect={() => handleSelectServer(server.id)}
            className="justify-between"
          >
            <div className="flex min-w-0 items-center gap-2">
              <Server className="size-4 shrink-0 text-muted-foreground" />
              <span className="truncate">{server.name}</span>
            </div>
            <div className="ml-auto flex items-center gap-1">
              <Check
                className={cn(
                  'size-4',
                  currentServerId === server.id ? 'opacity-100' : 'opacity-0',
                )}
              />
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <button
                    type="button"
                    className="rounded p-1 transition-colors hover:bg-secondary"
                    onClick={(event) => event.stopPropagation()}
                  >
                    <MoreHorizontal className="size-4" />
                    <span className="sr-only">Server actions</span>
                  </button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  <DropdownMenuGroup>
                    <DropdownMenuItem
                      onSelect={(event) => {
                        event.stopPropagation();
                        handleRename(server);
                      }}
                    >
                      <Pencil />
                      Rename
                    </DropdownMenuItem>
                  </DropdownMenuGroup>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          </CommandItem>
        ))}
      </CommandGroup>
      <CommandSeparator />
      <CommandGroup>
        <CommandItem onSelect={handleGoHome}>
          <Home className="size-4" data-icon="inline-start" />
          Server Selection
        </CommandItem>
        <CommandItem onSelect={handleAddServer}>
          <Plus className="size-4" data-icon="inline-start" />
          Add Server...
        </CommandItem>
      </CommandGroup>
    </>
  );

  const switcher = compact ? (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="ghost"
          size="sm"
          role="combobox"
          aria-expanded={open}
          aria-label="Select server"
          className="h-8 gap-1.5 px-2 font-semibold hover:bg-accent"
        >
          <Server className="size-4 shrink-0 text-muted-foreground" />
          <span className="truncate">{currentServerName}</span>
          <ChevronsUpDown className="size-3 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="max-h-[80vh] w-[240px] p-0">
        <Command>
          <CommandInput placeholder="Search server..." />
          <CommandList className="max-h-[50vh] overflow-y-auto">
            <CommandEmpty>No server found.</CommandEmpty>
            {serverList}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  ) : (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          role="combobox"
          aria-expanded={open}
          aria-label="Select server"
          className="h-9 w-full justify-between"
        >
          <div className="flex items-center gap-2 overflow-hidden">
            <Server className="size-4 shrink-0 text-muted-foreground" />
            <span className="truncate">{currentServerName}</span>
          </div>
          <ChevronsUpDown className="ml-auto size-4 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="max-h-[80vh] w-[240px] p-0">
        <Command>
          <CommandInput placeholder="Search server..." />
          <CommandList className="max-h-[50vh] overflow-y-auto">
            <CommandEmpty>No server found.</CommandEmpty>
            {serverList}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );

  return (
    <>
      {switcher}
      <RenameServerDialog
        server={renameTarget}
        open={renameTarget !== null}
        onOpenChange={(nextOpen) => {
          if (!nextOpen) setRenameTarget(null);
        }}
        onRename={renameServer}
      />
    </>
  );
}
