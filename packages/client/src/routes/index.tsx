import { createFileRoute, useNavigate } from '@tanstack/react-router';
import type { SavedServer } from '@prokopai/sdk';
import {
  LoaderCircle,
  MoreHorizontal,
  Pencil,
  Plus,
  RefreshCw,
  Server,
  Trash2,
} from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { RenameServerDialog } from '@/components/modals/RenameServerDialog';
import { Button } from '@/components/ui/button';
import { ConfirmationDialog } from '@/components/ui/confirmation-dialog';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { getLastSelectedServerId } from '@/config/servers';
import { useServerContext } from '@/contexts/ServerContext';
import { useServerStatus, type ServerStatus } from '@/hooks/useServerStatus';
import { resolveStartup } from '@/lib/serverStartup';

function StatusDot({ status }: { status: ServerStatus }) {
  if (status === 'checking') {
    return (
      <span className="inline-block size-2 rounded-full bg-muted-foreground/40 animate-pulse" />
    );
  }
  if (status === 'online') {
    return <span className="inline-block size-2 rounded-full bg-green-500" />;
  }
  return <span className="inline-block size-2 rounded-full bg-destructive" />;
}

function LandingPage() {
  const navigate = useNavigate();
  const { select } = Route.useSearch();
  const {
    servers,
    isHydrated,
    isDiscovering,
    removeServer,
    renameServer,
  } = useServerContext();
  const [deleteTarget, setDeleteTarget] = useState<SavedServer | null>(null);
  const [renameTarget, setRenameTarget] = useState<SavedServer | null>(null);
  const redirectStarted = useRef(false);
  const { statuses, isChecking, refresh } = useServerStatus(servers);
  const { destination: startupServer, showStartup } = resolveStartup(
    servers,
    getLastSelectedServerId(),
    select,
    isHydrated,
    isDiscovering,
  );

  useEffect(() => {
    if (!startupServer || redirectStarted.current) return;

    redirectStarted.current = true;
    void navigate({
      to: '/server/$serverId',
      params: { serverId: startupServer.id },
      replace: true,
    });
  }, [navigate, startupServer]);

  const handleSelectServer = (server: SavedServer) => {
    void navigate({
      to: '/server/$serverId',
      params: { serverId: server.id },
    });
  };

  const handleDeleteServer = () => {
    if (!deleteTarget) return;
    removeServer(deleteTarget.id);
    setDeleteTarget(null);
  };

  if (showStartup) {
    return (
      <div className="flex size-full items-center justify-center bg-background">
        <div className="flex flex-col items-center gap-3 text-center">
          <LoaderCircle className="size-7 animate-spin text-muted-foreground" />
          <div>
            <p className="font-medium text-foreground">Opening Prokop</p>
            <p className="text-sm text-muted-foreground">
              Looking for your home server…
            </p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex size-full items-center justify-center bg-background p-4">
      <div className="w-full max-w-2xl">
        <div className="overflow-hidden rounded-xl border border-border bg-card shadow-2xl">
          <div className="border-b border-border px-6 pt-6 pb-4 text-center">
            <div className="flex items-center justify-center gap-2">
              <h1 className="text-2xl font-bold text-foreground">Select a Server</h1>
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                onClick={refresh}
                disabled={isChecking}
                title="Refresh server status"
              >
                <RefreshCw className={isChecking ? 'animate-spin' : undefined} />
                <span className="sr-only">Refresh server status</span>
              </Button>
            </div>
            <p className="mt-1 text-muted-foreground">
              Choose a saved server or add a new one
            </p>
          </div>

          <div className="flex flex-col gap-4 p-6">
            {servers.map((server) => (
              <div
                key={server.id}
                className="group flex w-full items-center gap-4 rounded-lg border border-input bg-background p-4 transition-colors hover:border-ring hover:bg-accent"
              >
                <button
                  type="button"
                  onClick={() => handleSelectServer(server)}
                  className="flex min-w-0 flex-1 items-center gap-4 text-left"
                >
                  <div className="shrink-0 rounded-lg bg-primary/10 p-2">
                    <Server className="size-5 text-primary" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <p className="truncate font-medium text-foreground">{server.name}</p>
                      <StatusDot status={statuses[server.id] ?? 'checking'} />
                    </div>
                    <p className="truncate text-sm text-muted-foreground">{server.url}</p>
                  </div>
                </button>
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon-sm"
                      className="sm:opacity-0 sm:group-hover:opacity-100 sm:group-focus-within:opacity-100"
                      onClick={(event) => event.stopPropagation()}
                    >
                      <MoreHorizontal />
                      <span className="sr-only">Server actions</span>
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end">
                    <DropdownMenuGroup>
                      <DropdownMenuItem onSelect={() => setRenameTarget(server)}>
                        <Pencil />
                        Rename
                      </DropdownMenuItem>
                      <DropdownMenuItem
                        variant="destructive"
                        onSelect={() => setDeleteTarget(server)}
                      >
                        <Trash2 />
                        Remove
                      </DropdownMenuItem>
                    </DropdownMenuGroup>
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>
            ))}

            <button
              type="button"
              onClick={() => navigate({ to: '/add-server' })}
              className="flex w-full items-center gap-4 rounded-lg border border-dashed border-input bg-background p-4 text-left transition-colors hover:border-ring hover:bg-accent"
            >
              <div className="rounded-lg bg-primary/10 p-2">
                <Plus className="size-5 text-primary" />
              </div>
              <p className="min-w-0 flex-1 font-medium text-muted-foreground">Add a Server</p>
            </button>
          </div>
        </div>

        <RenameServerDialog
          server={renameTarget}
          open={renameTarget !== null}
          onOpenChange={(open) => {
            if (!open) setRenameTarget(null);
          }}
          onRename={renameServer}
        />
        <ConfirmationDialog
          open={deleteTarget !== null}
          onOpenChange={(open) => {
            if (!open) setDeleteTarget(null);
          }}
          title="Remove Server"
          description={`Remove "${deleteTarget?.name ?? ''}" from your saved servers?`}
          confirmLabel="Remove"
          onConfirm={handleDeleteServer}
          variant="destructive"
        />
      </div>
    </div>
  );
}

export const Route = createFileRoute('/')({
  validateSearch: (search: Record<string, unknown>) => ({
    select: search.select === true || search.select === 'true',
  }),
  component: LandingPage,
});
