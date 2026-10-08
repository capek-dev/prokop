import type {
  PullRequestRepository,
  PullRequestSummary,
  PullRequestList,
  PullRequestDetail,
  PullRequestFiles,
  PullRequestPatch,
  PullRequestCreate,
  PullRequestMutation,
} from '@prokopai/sdk/types';

export interface PullRequestProviderPort {
  account(): Promise<{ id: string; name: string }>;
  list(state: string, page: number): Promise<Omit<PullRequestList, 'accountId'>>;
  summary(number: number): Promise<PullRequestSummary>;
  detail(number: number): Promise<Omit<PullRequestDetail, 'accountId'>>;
  files(number: number, head: string, page: number): Promise<PullRequestFiles>;
  patch(number: number, head: string, path: string): Promise<PullRequestPatch>;
  create(input: PullRequestCreate): Promise<PullRequestSummary>;
  action(number: number, input: PullRequestMutation): Promise<void>;
}
export interface PullRequestsPort {
  resolveRoot(workspaceId: string, root?: string): string;
  repositories(root: string): Promise<{ repositories: PullRequestRepository[]; branch: string | null }>;
  provider(root: string, repository: PullRequestRepository): PullRequestProviderPort;
  changed(workspaceId: string, repositoryKey: string): void;
}
