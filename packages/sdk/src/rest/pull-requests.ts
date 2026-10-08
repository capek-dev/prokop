import type { HttpClient } from '../transport/http';
import type {
  PullRequestScope,
  PullRequestDiscovery,
  PullRequestList,
  PullRequestDetail,
  PullRequestFiles,
  PullRequestPatch,
  PullRequestCreate,
  PullRequestMutation,
  PullRequestSummary,
} from '../shared-types/pullRequest';

function scopeParams(scope: PullRequestScope): Record<string, string> {
  return {
    remote: scope.remote,
    repositoryKey: scope.repositoryKey,
    ...(scope.root === undefined ? {} : { root: scope.root }),
  };
}

export class PullRequestsRestNamespace {
  constructor(private http: HttpClient) {}
  private path(workspaceId: string): string {
    return `/workspaces/${encodeURIComponent(workspaceId)}/pull-requests`;
  }
  discover(workspaceId: string, root?: string): Promise<PullRequestDiscovery> {
    return this.http.get(`${this.path(workspaceId)}/connections`, {
      params: root === undefined ? {} : { root },
    });
  }
  list(workspaceId: string, scope: PullRequestScope, state = 'open', page = 1): Promise<PullRequestList> {
    return this.http.get(this.path(workspaceId), {
      params: { ...scopeParams(scope), state, page: String(page) },
    });
  }
  detail(workspaceId: string, scope: PullRequestScope, number: number): Promise<PullRequestDetail> {
    return this.http.get(`${this.path(workspaceId)}/${number}`, { params: scopeParams(scope) });
  }
  files(
    workspaceId: string,
    scope: PullRequestScope,
    number: number,
    head: string,
    page = 1,
  ): Promise<PullRequestFiles> {
    return this.http.get(`${this.path(workspaceId)}/${number}/files`, {
      params: { ...scopeParams(scope), head, page: String(page) },
    });
  }
  patch(
    workspaceId: string,
    scope: PullRequestScope,
    number: number,
    head: string,
    path: string,
  ): Promise<PullRequestPatch> {
    return this.http.get(`${this.path(workspaceId)}/${number}/patch`, {
      params: { ...scopeParams(scope), head, path },
    });
  }
  create(
    workspaceId: string,
    scope: PullRequestScope,
    input: PullRequestCreate,
  ): Promise<PullRequestSummary> {
    return this.http.post(this.path(workspaceId), { ...scope, ...input });
  }
  action(
    workspaceId: string,
    scope: PullRequestScope,
    number: number,
    input: PullRequestMutation,
  ): Promise<{ ok: true }> {
    return this.http.post(`${this.path(workspaceId)}/${number}/actions`, { ...scope, ...input });
  }
}
