import type { WorkspaceSettings } from '../shared';
import type { HttpClient } from '../transport/http';
import type {
  ListWorkspacesResponse,
  CreateWorkspaceResponse,
  GetWorkspaceResponse,
  UpdateWorkspaceResponse,
  DeleteWorkspaceResponse,
  ListWorkspaceSessionsResponse,
  ListPinnedMessagesResponse,
  PinMessageResponse,
  UnpinMessageResponse,
} from '../types/rest-responses';

interface ListOptions {
  signal?: AbortSignal;
}

interface CreateOptions {
  name?: string;
  path?: string;
  isVirtual?: boolean;
  additionalPaths?: string[];
  signal?: AbortSignal;
}

interface GetOptions {
  signal?: AbortSignal;
}

export class WorkspacesRestNamespace {
  constructor(private http: HttpClient) {}

  async list(options?: ListOptions): Promise<ListWorkspacesResponse> {
    return this.http.get('/workspaces', { signal: options?.signal });
  }

  async create(options?: CreateOptions): Promise<CreateWorkspaceResponse> {
    const { signal, ...body } = options ?? {};
    return this.http.post('/workspaces', body, { signal });
  }

  async get(id: string, options?: GetOptions): Promise<GetWorkspaceResponse> {
    return this.http.get(`/workspaces/${encodeURIComponent(id)}`, {
      signal: options?.signal,
    });
  }

  async update(
    id: string,
    data: { name?: string; path?: string; additionalPaths?: string[]; settings?: WorkspaceSettings },
    options?: GetOptions,
  ): Promise<UpdateWorkspaceResponse> {
    return this.http.patch(`/workspaces/${encodeURIComponent(id)}`, data, {
      signal: options?.signal,
    });
  }

  async delete(id: string, options?: GetOptions): Promise<DeleteWorkspaceResponse> {
    return this.http.delete(`/workspaces/${encodeURIComponent(id)}`, {
      signal: options?.signal,
    });
  }

  async listSessions(
    id: string,
    options?: GetOptions,
  ): Promise<ListWorkspaceSessionsResponse> {
    return this.http.get(`/workspaces/${encodeURIComponent(id)}/sessions`, {
      signal: options?.signal,
    });
  }

  async listPinnedMessages(
    workspaceId: string,
    options?: { signal?: AbortSignal },
  ): Promise<ListPinnedMessagesResponse> {
    return this.http.get(
      `/workspaces/${encodeURIComponent(workspaceId)}/pinned-messages`,
      { signal: options?.signal },
    );
  }

  async pinMessage(
    workspaceId: string,
    data: { sessionId: string; messageId: string },
    options?: { signal?: AbortSignal },
  ): Promise<PinMessageResponse> {
    return this.http.post(
      `/workspaces/${encodeURIComponent(workspaceId)}/pinned-messages`,
      data,
      { signal: options?.signal },
    );
  }

  async unpinMessage(
    workspaceId: string,
    messageId: string,
    options?: { signal?: AbortSignal },
  ): Promise<UnpinMessageResponse> {
    return this.http.delete(
      `/workspaces/${encodeURIComponent(workspaceId)}/pinned-messages/${encodeURIComponent(messageId)}`,
      { signal: options?.signal },
    );
  }
}
