import { useNavigate } from '@tanstack/react-router';
import { toast } from 'sonner';
import type { SavedServer } from '@prokopai/sdk';
import { Badge } from '@/components/ui/badge';
import {
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
} from '@/components/ui/sidebar';
import { useServerContext } from '@/contexts/ServerContext';
import { useAttentionStore } from '@/lib/attention';
import { openSessionHere } from '@/lib/openSessionHere';

export interface OtherMachineItem {
  server: SavedServer;
  sessionId: string;
  title: string;
  workspaceName: string | null;
  status: 'approval' | 'question' | 'running';
}

const STATUS_LABELS: Record<OtherMachineItem['status'], string> = {
  approval: 'Needs approval',
  question: 'Needs answer',
  running: 'Running',
};

/** Waiting sessions first (one row per session), then running ones, per machine. */
export function otherMachineItems(
  servers: SavedServer[],
  activeServerId: string,
  hosts: ReturnType<typeof useAttentionStore.getState>['hosts'],
): OtherMachineItem[] {
  const items: OtherMachineItem[] = [];
  for (const server of servers) {
    if (server.id === activeServerId) continue;
    const snapshot = hosts[server.id]?.snapshot;
    if (!snapshot) continue;
    const seen = new Set<string>();
    for (const ask of snapshot.asks) {
      if (seen.has(ask.sessionId)) continue;
      seen.add(ask.sessionId);
      items.push({ server, sessionId: ask.sessionId, title: ask.sessionTitle ?? 'Untitled session', workspaceName: ask.workspaceName, status: ask.kind });
    }
    for (const session of snapshot.running) {
      if (seen.has(session.sessionId)) continue;
      seen.add(session.sessionId);
      items.push({ server, sessionId: session.sessionId, title: session.sessionTitle ?? 'Untitled session', workspaceName: session.workspaceName, status: 'running' });
    }
  }
  return items;
}

/**
 * Sessions on other machines that are running or need you, at the top of the
 * Overview. Opening one adds it as a tab beside this machine's sessions.
 * Hidden when nothing is happening elsewhere.
 */
export function OtherMachinesOverview({ activeServerId }: { activeServerId: string }) {
  const { servers } = useServerContext();
  const hosts = useAttentionStore((state) => state.hosts);
  const navigate = useNavigate();
  const items = otherMachineItems(servers, activeServerId, hosts);
  if (items.length === 0) return null;

  const open = (item: OtherMachineItem) => {
    void openSessionHere({
      server: item.server,
      sessionId: item.sessionId,
      activeServerId,
      viewPath: '/overview',
      navigate: (options) => void navigate(options as never),
    }).catch((error: unknown) => {
      toast.error(`Could not open the session from ${item.server.name}`, {
        description: error instanceof Error ? error.message : String(error),
      });
    });
  };

  return (
    <SidebarGroup>
      <SidebarGroupLabel>Other machines</SidebarGroupLabel>
      <SidebarGroupContent>
        <SidebarMenu>
          {items.map((item) => (
            <SidebarMenuItem key={`${item.server.id}:${item.sessionId}`}>
              <SidebarMenuButton onClick={() => open(item)} className="h-auto py-1.5" title={`Open beside your work: ${item.title}`}>
                <div className="flex min-w-0 flex-1 flex-col">
                  <span className="truncate text-sm">{item.title}</span>
                  <span className="truncate text-xs text-muted-foreground">
                    {[item.server.name, item.workspaceName].filter(Boolean).join(' · ')}
                  </span>
                </div>
                <Badge variant={item.status === 'running' ? 'outline' : 'secondary'} className="shrink-0">
                  {STATUS_LABELS[item.status]}
                </Badge>
              </SidebarMenuButton>
            </SidebarMenuItem>
          ))}
        </SidebarMenu>
      </SidebarGroupContent>
    </SidebarGroup>
  );
}
