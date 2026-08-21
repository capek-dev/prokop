import { useState } from 'react';
import { Server, RefreshCw, Plug, PlugZap, ExternalLink, AlertCircle, CheckCircle, XCircle, Loader2 } from 'lucide-react';
import type { McpStatus, McpServerConfig, ProkopaiClient } from '@prokopai/sdk';
import { useMcpStatusQuery, useMcpConnect, useMcpDisconnect, useMcpStartAuth } from '@/hooks/queries';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Alert, AlertDescription } from '@/components/ui/alert';

interface ServerStatus {
  config?: McpServerConfig;
  status: McpStatus;
}

interface MCPServersPanelProps {
  workspaceId: string | undefined;
  sdkClient: ProkopaiClient | null;
}

function StatusBadge({ status }: { status: McpStatus }) {
  switch (status.status) {
    case 'connected':
      return <Badge variant="default" className="bg-green-600"><CheckCircle className="size-3 mr-1" />Connected</Badge>;
    case 'disabled':
      return <Badge variant="secondary"><XCircle className="size-3 mr-1" />Disabled</Badge>;
    case 'failed':
      return <Badge variant="destructive"><AlertCircle className="size-3 mr-1" />Failed</Badge>;
    case 'needs_auth':
      return <Badge variant="outline" className="border-yellow-500 text-yellow-600"><AlertCircle className="size-3 mr-1" />Needs Auth</Badge>;
    case 'needs_client_registration':
      return <Badge variant="outline" className="border-orange-500 text-orange-600"><AlertCircle className="size-3 mr-1" />Needs Registration</Badge>;
    default:
      return <Badge variant="secondary">Unknown</Badge>;
  }
}

export function MCPServersPanel({ workspaceId, sdkClient }: MCPServersPanelProps) {
  const { data: mcpData, isLoading: loading, refetch } = useMcpStatusQuery(sdkClient, workspaceId);
  const connectMut = useMcpConnect(sdkClient);
  const disconnectMut = useMcpDisconnect(sdkClient);
  const startAuthMut = useMcpStartAuth(sdkClient);
  const servers: Record<string, ServerStatus> = (mcpData?.status as Record<string, ServerStatus>) ?? {};
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const handleConnect = async (name: string) => {
    if (!workspaceId || !sdkClient) return;
    setActionLoading(name);
    try {
      await connectMut.mutateAsync({ workspaceId, name });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error');
    } finally {
      setActionLoading(null);
    }
  };

  const handleDisconnect = async (name: string) => {
    if (!workspaceId || !sdkClient) return;
    setActionLoading(name);
    try {
      await disconnectMut.mutateAsync({ workspaceId, name });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error');
    } finally {
      setActionLoading(null);
    }
  };

  const handleAuth = async (name: string) => {
    if (!workspaceId || !sdkClient) return;
    setActionLoading(name);
    try {
      const data = await startAuthMut.mutateAsync({ workspaceId, name });
      if (data.authorizationUrl) {
        window.open(data.authorizationUrl, '_blank');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error');
    } finally {
      setActionLoading(null);
    }
  };

  const serverEntries = Object.entries(servers);

  return (
    <div className="p-3 sm:p-4 space-y-4">
      {error && (
        <div className="flex items-center justify-between gap-2 p-2 rounded bg-destructive/10 text-sm text-destructive">
          <span className="break-words">{error}</span>
          <Button variant="ghost" size="sm" onClick={() => setError(null)} className="shrink-0 h-6 px-2">
            <XCircle className="size-3" />
          </Button>
        </div>
      )}

      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground">
          Configure servers in <code className="text-xs bg-muted px-1 py-0.5 rounded">.jean2/mcp.json</code>
        </p>
        <Button
          variant="outline"
          size="sm"
          onClick={() => refetch()}
          disabled={loading}
          className="h-8 shrink-0"
        >
          <RefreshCw className={`size-4 ${loading ? 'animate-spin' : ''}`} />
        </Button>
      </div>

      {loading && serverEntries.length === 0 ? (
        <div className="flex items-center justify-center py-8">
          <Loader2 className="size-6 animate-spin text-muted-foreground" />
        </div>
      ) : serverEntries.length === 0 ? (
        <div className="text-center py-8 text-muted-foreground">
          <Server className="size-12 mx-auto mb-3 opacity-50" />
          <p className="font-medium">No MCP servers configured</p>
          <p className="text-sm mt-1">
            Create <code className="text-xs bg-muted px-1 py-0.5 rounded">.jean2/mcp.json</code> in your workspace to add servers.
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {serverEntries.map(([name, { config, status }]) => (
            <div key={name} className="border rounded-lg p-4">
              <div className="flex items-start justify-between">
                <div className="flex items-start gap-3">
                  <Server className="size-5 text-muted-foreground mt-0.5" />
                  <div>
                    <div className="font-medium">{name}</div>
                    <div className="text-sm text-muted-foreground">
                      {config?.type === 'local' ? (
                        <span>Local - {config.command?.[0] || 'command'}</span>
                      ) : config?.type === 'remote' ? (
                        <span className="flex items-center gap-1">
                          Remote - {config.url}
                        </span>
                      ) : (
                        'Unknown type'
                      )}
                    </div>
                    {status.status === 'failed' && 'error' in status && (
                      <Alert variant="destructive" className="mt-2 py-2">
                        <AlertDescription className="text-xs">
                          {status.error}
                        </AlertDescription>
                      </Alert>
                    )}
                    {status.status === 'needs_client_registration' && 'error' in status && (
                      <Alert className="mt-2 py-2 border-orange-500">
                        <AlertDescription className="text-xs">
                          {status.error}
                        </AlertDescription>
                      </Alert>
                    )}
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <StatusBadge status={status} />
                </div>
              </div>

              <div className="flex items-center gap-2 mt-3 pt-3 border-t">
                {status.status === 'connected' && (
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => handleDisconnect(name)}
                    disabled={actionLoading === name}
                  >
                    {actionLoading === name ? (
                      <Loader2 className="size-4 animate-spin" />
                    ) : (
                      <PlugZap className="size-4" />
                    )}
                    <span className="ml-1">Disconnect</span>
                  </Button>
                )}

                {(status.status === 'disabled' || status.status === 'failed') && (
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => handleConnect(name)}
                    disabled={actionLoading === name}
                  >
                    {actionLoading === name ? (
                      <Loader2 className="size-4 animate-spin" />
                    ) : (
                      <Plug className="size-4" />
                    )}
                    <span className="ml-1">Connect</span>
                  </Button>
                )}

                {status.status === 'needs_auth' && (
                  <Button
                    variant="default"
                    size="sm"
                    onClick={() => handleAuth(name)}
                    disabled={actionLoading === name}
                  >
                    {actionLoading === name ? (
                      <Loader2 className="size-4 animate-spin" />
                    ) : (
                      <ExternalLink className="size-4" />
                    )}
                    <span className="ml-1">Authenticate</span>
                  </Button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
