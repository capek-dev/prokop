import type { HttpClient } from '../transport/http';
import type {
  ListPreconfigsResponse,
  GetPreconfigResponse,
  CreatePreconfigResponse,
  UpdatePreconfigResponse,
  DeletePreconfigResponse,
} from '../types/rest-responses';
import type { PreconfigCapabilities, PreconfigMode } from '../shared';

interface ListOptions {
  signal?: AbortSignal;
}

interface CreateOptions {
  id?: string;
  name?: string;
  description?: string;
  systemPrompt?: string;
  tools?: string[] | null;
  model?: string | null;
  provider?: string | null;
  variant?: string | null;
  settings?: Record<string, unknown> | null;
  mode?: PreconfigMode;
  canSpawnSubagents?: boolean | string[] | null;
  allowSelfAsSubagent?: boolean;
  skills?: string[] | null;
  /** Agent-level capability switches. Absent or null means all enabled. */
  capabilities?: PreconfigCapabilities | null;
  /** Storage format for the preconfig. If 'md', stores as markdown file. */
  format?: 'md';
  signal?: AbortSignal;
}

interface UpdateOptions {
  name?: string;
  description?: string;
  systemPrompt?: string;
  tools?: string[] | null;
  model?: string | null;
  provider?: string | null;
  variant?: string | null;
  settings?: Record<string, unknown> | null;
  isDefault?: boolean;
  mode?: PreconfigMode;
  canSpawnSubagents?: boolean | string[] | null;
  allowSelfAsSubagent?: boolean;
  skills?: string[] | null;
  /** Agent-level capability switches. Omit to keep the stored value. */
  capabilities?: PreconfigCapabilities | null;
}

interface GetOptions {
  signal?: AbortSignal;
}

export class PreconfigsRestNamespace {
  constructor(private http: HttpClient) {}

  async list(options?: ListOptions): Promise<ListPreconfigsResponse> {
    return this.http.get('/preconfigs', { signal: options?.signal });
  }

  async create(options?: CreateOptions): Promise<CreatePreconfigResponse> {
    const { signal, ...body } = options ?? {};
    return this.http.post('/preconfigs', body, { signal });
  }

  async get(id: string, options?: GetOptions): Promise<GetPreconfigResponse> {
    return this.http.get(`/preconfigs/${encodeURIComponent(id)}`, {
      signal: options?.signal,
    });
  }

  async update(
    id: string,
    data: UpdateOptions,
    options?: GetOptions,
  ): Promise<UpdatePreconfigResponse> {
    return this.http.put(`/preconfigs/${encodeURIComponent(id)}`, data, {
      signal: options?.signal,
    });
  }

  async delete(id: string, options?: GetOptions): Promise<DeletePreconfigResponse> {
    return this.http.delete(`/preconfigs/${encodeURIComponent(id)}`, {
      signal: options?.signal,
    });
  }
}
