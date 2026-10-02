import type { HttpClient } from '../transport/http';
import type {
  ListAgentsResponse,
  GetAgentResponse,
  PromoteAgentResponse,
  DeleteAgentResponse,
  GetAgentMemoryResponse,
  UpdateAgentMemoryResponse,
  ListAgentSkillsResponse,
} from '../types/rest-responses';

interface GetOptions {
  signal?: AbortSignal;
}

interface UpdateMemoryOptions {
  target: 'user' | 'memory';
  content: string;
  signal?: AbortSignal;
}

export class AgentsRestNamespace {
  constructor(private http: HttpClient) {}

  async list(options?: GetOptions): Promise<ListAgentsResponse> {
    return this.http.get('/agents', { signal: options?.signal });
  }

  async get(id: string, options?: GetOptions): Promise<GetAgentResponse> {
    return this.http.get(`/agents/${encodeURIComponent(id)}`, {
      signal: options?.signal,
    });
  }

  async promote(
    id: string,
    options?: GetOptions,
  ): Promise<PromoteAgentResponse> {
    return this.http.post(`/agents/${encodeURIComponent(id)}/promote`, {}, {
      signal: options?.signal,
    });
  }

  async delete(id: string, options?: GetOptions): Promise<DeleteAgentResponse> {
    return this.http.delete(`/agents/${encodeURIComponent(id)}`, {
      signal: options?.signal,
    });
  }

  async getMemory(id: string, options?: GetOptions): Promise<GetAgentMemoryResponse> {
    return this.http.get(`/agents/${encodeURIComponent(id)}/memory`, {
      signal: options?.signal,
    });
  }

  async listSkills(id: string, options?: GetOptions): Promise<ListAgentSkillsResponse> {
    return this.http.get(`/agents/${encodeURIComponent(id)}/skills`, {
      signal: options?.signal,
    });
  }

  async updateMemory(
    id: string,
    data: UpdateMemoryOptions,
  ): Promise<UpdateAgentMemoryResponse> {
    const { signal, ...body } = data;
    return this.http.patch(`/agents/${encodeURIComponent(id)}/memory`, body, {
      signal,
    });
  }
}
