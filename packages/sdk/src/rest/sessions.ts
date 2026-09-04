import type { HttpClient } from '../transport/http';
import type {
  ListSessionsResponse,
  ListSessionsGroupedResponse,
  CreateSessionResponse,
  GetSessionResponse,
  UpdateSessionResponse,
  DeleteSessionResponse,
  ListMessagesResponse,
  TranscriptPageResponse,
  GetToolDebugResponse,
  SessionWorktreeResponse,
} from '../types/rest-responses';
import type { SessionStatus } from '../types';

interface ListOptions {
  status?: SessionStatus;
  signal?: AbortSignal;
}

interface CreateOptions {
  id?: string;
  workspaceId?: string;
  workspaceRootId?: string;
  preconfigId?: string;
  title?: string;
  metadata?: Record<string, unknown>;
  signal?: AbortSignal;
}

interface UpdateOptions {
  title?: string;
  status?: SessionStatus;
  metadata?: Record<string, unknown>;
  tags?: string[];
  autoApproveSeverity?: string | null;
}

interface ListGroupedOptions {
  workspaceIds: string[];
  status?: SessionStatus;
  rootOnly?: boolean;
  limitPerWorkspace?: number;
  signal?: AbortSignal;
}

interface ListByWorkspaceOptions {
  workspaceId: string;
  status?: SessionStatus;
  rootOnly?: boolean;
  cursor?: string;
  limit?: number;
  signal?: AbortSignal;
}

export class SessionsRestNamespace {
  constructor(private http: HttpClient) {}

  async list(options?: ListOptions): Promise<ListSessionsResponse> {
    return this.http.get('/sessions', {
      params: options?.status ? { status: options.status } : undefined,
      signal: options?.signal,
    });
  }

  async create(options?: CreateOptions): Promise<CreateSessionResponse> {
    const { signal, ...body } = options ?? {};
    return this.http.post('/sessions', body, { signal });
  }

  async get(id: string, options?: { signal?: AbortSignal }): Promise<GetSessionResponse> {
    return this.http.get(`/sessions/${encodeURIComponent(id)}`, { signal: options?.signal });
  }

  async update(id: string, data: UpdateOptions, options?: { signal?: AbortSignal }): Promise<UpdateSessionResponse> {
    return this.http.put(`/sessions/${encodeURIComponent(id)}`, data, { signal: options?.signal });
  }

  async delete(id: string, options?: { signal?: AbortSignal }): Promise<DeleteSessionResponse> {
    return this.http.delete(`/sessions/${encodeURIComponent(id)}`, { signal: options?.signal });
  }

  async bindWorktree(
    id: string,
    worktreeId: string,
    options?: { signal?: AbortSignal },
  ): Promise<SessionWorktreeResponse> {
    return this.http.put(
      `/sessions/${encodeURIComponent(id)}/worktree`,
      { worktreeId },
      { signal: options?.signal },
    );
  }

  async unbindWorktree(
    id: string,
    options?: { signal?: AbortSignal },
  ): Promise<SessionWorktreeResponse> {
    return this.http.delete(`/sessions/${encodeURIComponent(id)}/worktree`, {
      signal: options?.signal,
    });
  }

  async listMessages(id: string, options?: { signal?: AbortSignal }): Promise<ListMessagesResponse> {
    return this.http.get(`/sessions/${encodeURIComponent(id)}/messages`, { signal: options?.signal });
  }

  async getTranscriptPage(
    id: string,
    options?: { before?: number; limit?: number; signal?: AbortSignal },
  ): Promise<TranscriptPageResponse> {
    const params: Record<string, string> = {};
    if (options?.before !== undefined) params.before = String(options.before);
    if (options?.limit !== undefined) params.limit = String(options.limit);
    return this.http.get(`/sessions/${encodeURIComponent(id)}/transcript`, {
      params,
      signal: options?.signal,
    });
  }

  async getToolDebug(
    id: string,
    partId: string,
    options?: { signal?: AbortSignal },
  ): Promise<GetToolDebugResponse> {
    return this.http.get(
      `/sessions/${encodeURIComponent(id)}/tool-parts/${encodeURIComponent(partId)}/debug`,
      { signal: options?.signal },
    );
  }

  async listGrouped(options: ListGroupedOptions): Promise<ListSessionsGroupedResponse> {
    const params: Record<string, string> = {
      workspaceIds: options.workspaceIds.join(','),
    };
    if (options.status) params.status = options.status;
    if (options.rootOnly) params.rootOnly = 'true';
    if (options.limitPerWorkspace !== undefined) params.limitPerWorkspace = String(options.limitPerWorkspace);
    return this.http.get('/sessions/grouped', { params, signal: options.signal });
  }

  async listByWorkspace(options: ListByWorkspaceOptions): Promise<ListSessionsResponse> {
    const params: Record<string, string> = {};
    if (options.status) params.status = options.status;
    if (options.rootOnly) params.rootOnly = 'true';
    if (options.limit !== undefined) params.limit = String(options.limit);
    if (options.cursor) params.cursor = options.cursor;
    return this.http.get(`/workspaces/${encodeURIComponent(options.workspaceId)}/sessions`, { params, signal: options.signal });
  }

  async listTags(workspaceId: string, options?: { signal?: AbortSignal }): Promise<{ tags: string[] }> {
    return this.http.get('/sessions/tags', {
      params: { workspaceId },
      signal: options?.signal,
    });
  }
}