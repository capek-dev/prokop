import type { PullRequestsPort } from '@/application/ports/pull-requests';
import { createAzurePullRequests } from './azure';
import { azureRest, createAzureCredentials, type FetchLike } from './azure-rest';
import { runCli, type RunCli } from './cli';
import { createGitHubPullRequests } from './github';
import { discoverPullRequestRepositories } from './repositories';

export function createCliPullRequestProviders(
  run: RunCli = runCli,
  fetcher: FetchLike = fetch,
): Pick<PullRequestsPort, 'repositories' | 'provider'> {
  // Shared across requests so Azure tokens are minted once per organization, not per call.
  const azure = createAzureCredentials(run, fetcher);
  return {
    repositories: discoverPullRequestRepositories,
    provider: (root, repository) =>
      repository.provider === 'github'
        ? createGitHubPullRequests(run, root, repository)
        : createAzurePullRequests(azureRest(fetcher, azure, repository), repository),
  };
}
