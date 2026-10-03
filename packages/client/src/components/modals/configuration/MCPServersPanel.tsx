import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ExternalLink, Pencil, Plus, RefreshCw, Trash2 } from 'lucide-react';
import type { McpServerConfig, McpStatus, ProkopaiClient } from '@prokopai/sdk';
import { queryKeys } from '@/lib/queryKeys';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import { Skeleton } from '@/components/ui/skeleton';
import { McpServerForm } from './McpServerForm';

interface Props { workspaceId: string | null | undefined; sdkClient: ProkopaiClient | null }
const statusLabels: Record<McpStatus['status'], string> = {
  connected: 'Connected', disabled: 'Disconnected', failed: 'Connection failed',
  needs_auth: 'Sign-in required', needs_client_registration: 'Client registration required',
};

export function MCPServersPanel({ workspaceId, sdkClient }: Props) {
  if (workspaceId === undefined || !sdkClient) return <p className="p-4 text-sm text-muted-foreground">Connect to a server to manage MCP.</p>;
  return <McpSettings key={workspaceId ?? 'global'} workspaceId={workspaceId} client={sdkClient} />;
}

function McpSettings({ workspaceId, client }: { workspaceId: string | null; client: ProkopaiClient }) {
  const cache = useQueryClient();
  const [editing, setEditing] = useState<{ name?: string; config?: McpServerConfig }>();
  const [search, setSearch] = useState('');
  const [authLink, setAuthLink] = useState<{ name: string; url: string }>();
  const status = useQuery({ queryKey: queryKeys.mcp.status(workspaceId),
    queryFn: ({ signal }) => client.http.mcp.getStatus(workspaceId, { signal }) });
  const action = useMutation({
    mutationFn: (run: () => Promise<unknown>) => run(),
    onSuccess: () => {
      void cache.invalidateQueries({ queryKey: queryKeys.mcp.status(workspaceId) });
      void cache.invalidateQueries({ queryKey: queryKeys.mcp.tools(workspaceId) });
    },
  });
  const run = (operation: () => Promise<unknown>) => { action.mutate(operation); };
  const servers = Object.entries(status.data?.status ?? {});
  const error = action.error ?? status.error;
  return <div className="flex flex-col gap-4 p-3 sm:p-4">
    <div className="flex items-start justify-between gap-3">
      <p className="text-sm text-muted-foreground">{workspaceId === null ? 'Tools available across all workspaces.' : 'Workspace connections override global connections with the same name.'}</p>
      <Button size="sm" variant="outline" disabled={!!editing || action.isPending} onClick={() => setEditing({})}>
        <Plus data-icon="inline-start" />Add server
      </Button>
    </div>
    {error && <Alert variant="destructive"><AlertDescription>{error.message}</AlertDescription></Alert>}
    {authLink && status.data?.status[authLink.name]?.status.status !== 'connected' && <p className="text-sm">
      <a className="underline" href={authLink.url} target="_blank" rel="noopener noreferrer">Continue sign-in</a>
    </p>}
    {editing && <McpServerForm key={editing.name ?? '__new__'} {...editing} names={servers.map(([name]) => name)} pending={action.isPending}
      onCancel={() => setEditing(undefined)} onSave={async (name, config) => {
        await action.mutateAsync(() => client.http.mcp.save(workspaceId, name, config)); setEditing(undefined);
      }} />}
    {status.isLoading ? <Skeleton className="h-16" /> : servers.length === 0
      ? <p className="py-4 text-sm text-muted-foreground">No MCP servers yet. Add a remote URL or a local command.</p>
      : <>
        {servers.length > 5 && <Input aria-label="Search MCP servers" placeholder="Search servers…" value={search} onChange={e => setSearch(e.target.value)} />}
        <div className="flex flex-col divide-y">
          {servers.filter(([name]) => name.toLowerCase().includes(search.toLowerCase())).map(([name, { config, status: connection }]) => config && (
            <div key={name} className="flex min-w-0 flex-col gap-3 py-3">
              <div className="flex items-center gap-3">
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">{name}</p>
                  <p className="truncate text-xs text-muted-foreground">{config.type === 'remote' ? config.url : config.command.join(' ')}</p>
                </div>
                <Switch aria-label={'Enable ' + name} checked={config.enabled !== false} disabled={action.isPending}
                  onCheckedChange={enabled => run(() => client.http.mcp.save(workspaceId, name, { ...config, enabled }))} />
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <Badge variant={connection.status === 'failed' ? 'destructive' : 'secondary'}>
                  {config.enabled === false ? 'Disabled' : statusLabels[connection.status]}
                </Badge>
                {config.enabled !== false && connection.status !== 'connected' && <Button size="sm" variant="ghost" disabled={action.isPending}
                  onClick={() => run(() => client.http.mcp.connect(workspaceId, name))}><RefreshCw data-icon="inline-start" />Connect</Button>}
                {config.type === 'remote' && config.oauth !== false && config.enabled !== false && connection.status !== 'connected' && <Button size="sm" variant="ghost"
                  disabled={action.isPending} onClick={() => {
                    // Open during the click so the browser does not block the asynchronous OAuth redirect.
                    const popup = window.open('about:blank', '_blank');
                    if (popup) popup.opener = null;
                    run(async () => {
                      try {
                        const { authorizationUrl } = await client.http.mcp.startAuth(workspaceId, name);
                        setAuthLink({ name, url: authorizationUrl });
                        if (popup) popup.location.href = authorizationUrl;
                      } catch (error: unknown) { popup?.close(); throw error; }
                    });
                  }}><ExternalLink data-icon="inline-start" />Sign in</Button>}
                <Button size="icon-sm" variant="ghost" aria-label={'Edit ' + name} disabled={action.isPending}
                  onClick={() => setEditing({ name, config })}><Pencil /></Button>
                <Button size="icon-sm" variant="ghost" aria-label={'Remove ' + name} disabled={action.isPending}
                  onClick={() => run(() => client.http.mcp.remove(workspaceId, name))}><Trash2 /></Button>
              </div>
              {'error' in connection && <p className="text-xs text-destructive">{connection.error}</p>}
              {connection.status === 'connected' && config.enabled !== false && <McpTools workspaceId={workspaceId} name={name} client={client} />}
            </div>
          ))}
        </div>
      </>}
  </div>;
}

function McpTools({ workspaceId, name, client }: { workspaceId: string | null; name: string; client: ProkopaiClient }) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');
  const cache = useQueryClient();
  const key = queryKeys.mcp.tools(workspaceId, name);
  const tools = useQuery({ queryKey: key, queryFn: ({ signal }) => client.http.mcp.getTools(workspaceId, name, { signal }), enabled: open });
  const toggle = useMutation({ mutationFn: ({ toolName, enabled }: { toolName: string; enabled: boolean }) =>
    client.http.mcp.setToolEnabled(workspaceId, name, toolName, enabled),
  onSuccess: () => {
    void cache.invalidateQueries({ queryKey: key });
    void cache.invalidateQueries({ queryKey: queryKeys.mcp.status(workspaceId) });
  } });
  const all = tools.data?.tools ?? [];
  return <div className="flex min-w-0 flex-col gap-2">
    <Button size="sm" variant="ghost" className="self-start" aria-expanded={open} onClick={() => setOpen(!open)}>
      {open ? 'Hide tools' : 'Choose tools'}{tools.data ? ' (' + all.filter(tool => tool.enabled).length + '/' + all.length + ')' : ''}
    </Button>
    {open && <>
      {(tools.error || toggle.error) && <Alert variant="destructive"><AlertDescription>{(tools.error ?? toggle.error)?.message}</AlertDescription></Alert>}
      {tools.isLoading ? <Skeleton className="h-12" /> : <>
        <Input aria-label={'Search tools in ' + name} placeholder="Search tools…" value={search} onChange={e => setSearch(e.target.value)} />
        <div className="dialog-scrollbar flex max-h-80 min-w-0 flex-col overflow-x-hidden overflow-y-auto px-3 py-2">
          {all.filter(tool => (tool.name + ' ' + (tool.description ?? '')).toLowerCase().includes(search.toLowerCase())).map(tool =>
            <label key={tool.name} className="flex min-h-8 min-w-0 shrink-0 items-center gap-3 py-1.5">
              <span className="min-w-0 flex-1 text-sm [overflow-wrap:anywhere]">{tool.name}</span>
              <Switch aria-label={'Allow ' + tool.name} checked={tool.enabled} disabled={toggle.isPending}
                onCheckedChange={enabled => toggle.mutate({ toolName: tool.name, enabled })} />
            </label>)}
          {all.length === 0 && <p className="text-xs text-muted-foreground">This server has no tools.</p>}
        </div>
      </>}
    </>}
  </div>;
}
