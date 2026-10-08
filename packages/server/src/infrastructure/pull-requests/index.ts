import type { PullRequestsPort } from '@/application/ports/pull-requests';
import { createAzurePullRequests } from './azure';
import { runCli, type RunCli } from './cli';
import { createGitHubPullRequests } from './github';
import { discoverPullRequestRepositories } from './repositories';

export function createCliPullRequestProviders(
  run: RunCli = runCli,
): Pick<PullRequestsPort, 'repositories' | 'provider'> {
  return {
    repositories: discoverPullRequestRepositories,
    provider: (root, repository) =>
      repository.provider === 'github'
        ? createGitHubPullRequests(run, root, repository)
        : createAzurePullRequests(run, root, repository),
  };
}
