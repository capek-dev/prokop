export interface SavedServer {
  id: string;
  name: string;
  url: string;
  token?: string;
  createdAt: string;
}

export interface QuickConnection {
  id: string;
  serverId: string;
  serverName: string;
  workspaceId?: string;
  workspaceName?: string;
  order: number;
}
