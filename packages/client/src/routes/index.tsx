import { createFileRoute, useNavigate } from '@tanstack/react-router';
import type { SavedServer } from '@prokopai/sdk';
import { Plus, RefreshCw, Server, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { useServerContext } from '@/contexts/ServerContext';
import { ConfirmationDialog } from '@/components/ui/confirmation-dialog';
import { useServerStatus, type ServerStatus } from '@/hooks/useServerStatus';

function StatusDot({ status }: { status: ServerStatus }) {
  if (status === 'checking') {
    return (
      <span className="inline-block h-2 w-2 rounded-full bg-muted-foreground/40 animate-pulse" />
    );
  }
  if (status === 'online') {
    return (
      <span className="inline-block h-2 w-2 rounded-full bg-green-500" />
    );
  }
  return (
    <span className="inline-block h-2 w-2 rounded-full bg-destructive" />
  );
}

function LandingPage() {
  const navigate = useNavigate();
  const { servers, removeServer } = useServerContext();
  const [deleteTarget, setDeleteTarget] = useState<SavedServer | null>(null);
  const { statuses, isChecking, refresh } = useServerStatus(servers);

  const handleSelectServer = (server: SavedServer) => {
    navigate({ to: '/server/$serverId', params: { serverId: server.id } });
  };

  const handleDeleteServer = () => {
    if (deleteTarget) {
      removeServer(deleteTarget.id);
      setDeleteTarget(null);
    }
  };

  return (
    <div className="w-full h-full flex items-center justify-center bg-background dark:bg-gradient-to-br dark:from-muted dark:via-background dark:to-muted p-4">
      <div className="w-full max-w-2xl">
        <div className="bg-card border border-border rounded-xl shadow-2xl overflow-hidden">
          <div className="px-6 pt-6 pb-4 text-center border-b border-border">
            <div className="flex items-center justify-center gap-2">
              <h1 className="text-2xl font-bold text-foreground">Select a Server</h1>
              <button
                onClick={refresh}
                disabled={isChecking}
                className="p-1 rounded-md text-muted-foreground hover:text-foreground hover:bg-accent disabled:opacity-50 transition-colors"
                title="Refresh server status"
              >
                <RefreshCw className={`w-4 h-4 ${isChecking ? 'animate-spin' : ''}`} />
              </button>
            </div>
            <p className="text-muted-foreground mt-1">Choose a saved server or add a new one</p>
          </div>

          <div className="p-6 space-y-4">
            {servers.map((server) => (
              <div
                key={server.id}
                className="group w-full flex items-center gap-4 p-4 bg-background border border-input rounded-lg hover:bg-accent hover:border-ring transition-colors"
              >
                <button
                  onClick={() => handleSelectServer(server)}
                  className="flex items-center gap-4 flex-1 min-w-0 text-left"
                >
                  <div className="p-2 bg-primary/10 rounded-lg shrink-0">
                    <Server className="w-5 h-5 text-primary" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <p className="font-medium text-foreground truncate">{server.name}</p>
                      <StatusDot status={statuses[server.id] ?? 'checking'} />
                    </div>
                    <p className="text-sm text-muted-foreground truncate">{server.url}</p>
                  </div>
                </button>
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    setDeleteTarget(server);
                  }}
                  className="p-2 rounded-md opacity-0 group-hover:opacity-100 hover:bg-destructive/10 text-muted-foreground hover:text-destructive transition-all shrink-0"
                  title="Remove server"
                >
                  <Trash2 className="w-4 h-4" />
                </button>
              </div>
            ))}

            <button
              onClick={() => navigate({ to: '/add-server' })}
              className="w-full flex items-center gap-4 p-4 bg-background border border-dashed border-input rounded-lg hover:bg-accent hover:border-ring transition-colors text-left"
            >
              <div className="p-2 bg-primary/10 rounded-lg">
                <Plus className="w-5 h-5 text-primary" />
              </div>
              <div className="flex-1 min-w-0">
                <p className="font-medium text-muted-foreground">Add a Server</p>
              </div>
            </button>
          </div>
        </div>

        <ConfirmationDialog
          open={deleteTarget !== null}
          onOpenChange={(open) => { if (!open) setDeleteTarget(null); }}
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
  component: LandingPage,
});
