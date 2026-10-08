# Manage pull requests

Open **Pull requests** beside the workspace selector, then choose a checkout and
repository. The view follows the focused session's checkout until you select
another checkout. An unavailable managed worktree does not fall back to the main
repository.

## Connect the server

Install and authenticate the CLI on the machine running the Prokop server, under
the same operating-system account. A phone or browser connecting to that server
does not need either CLI. Install only the CLI for the provider you use.

For GitHub.com, install [GitHub CLI](https://cli.github.com/) and run:

```sh
gh auth login
```

For Azure DevOps Services, install
[Azure CLI](https://learn.microsoft.com/en-us/cli/azure/install-azure-cli), then run:

```sh
az extension add --name azure-devops
az login
```

Organizations using a personal access token can instead authenticate with
`az devops login --organization https://dev.azure.com/YOUR_ORGANIZATION`.
Enter the token at the CLI prompt. Do not put it into a PR or Prokop conversation.

The checkout must have a GitHub.com or Azure DevOps Services Git remote. HTTPS,
SSH, and legacy `organization.visualstudio.com` and `vs-ssh.visualstudio.com` Azure remote URLs are recognized.
GitHub Enterprise and Azure DevOps Server are not supported in this implementation.
Click **Rescan CLI connections** after changing CLI accounts or remotes. The
selected repository and signed-in account appear above the inbox.

## Create and manage

1. Push the source branch using **Branches**.
2. Click **New PR**, enter source and target branches, and write the title and description.
3. Choose draft or ready for review, then create the PR. GitHub fork sources use `owner:branch`.

Overview supports editing the title and description, requesting or removing
reviewers, switching draft status, closing or abandoning, reopening, and merging
or completing. Automatic merge delegates completion to the provider when its
policies allow it. The provider enforces permissions and required checks; Prokop
does not bypass policies or delete the source branch.

Creating a PR does not push commits or switch the local branch.

## Review changes

**Files** loads changed files and patches on demand. Choose unified or side-by-side
diffs and click a line number to write an inline comment. Conversations for the
selected file appear below its diff, with reply and resolve controls. **Activity**
shows the conversation across the PR.

GitHub supports approval and requested changes. Azure preserves approval,
approval with suggestions, rejection, waiting for the author, and reset vote.
General comments are available on both providers.

Unsent feedback is saved in this browser, scoped to server, workspace, checkout,
repository, account, and PR. Viewed-file markers are also local and scoped to the
reviewed commit. A new source commit clears line selection and viewed markers.

## Refresh and limits

Successful and failed Prokop mutations broadcast refresh events because a timed-out
command may still have changed the remote PR. Writes do not retry automatically.
After an uncertain result, refresh and check for the new comment, PR, or merge
before submitting again. Azure posts review comments and votes in separate calls;
if only the comment succeeds, the error asks you to retry only the vote.

Visible queries refresh when stale on view entry and after reconnecting. Changes
made outside Prokop, including CI completion, need **Refresh** while the view stays
open. There is no polling or webhook subscription.

Search and involvement filters apply to loaded PRs. Use **Load more** for additional
results. GitHub activity reads are bounded and show a warning when truncated.
Provider patches can omit large sections; binary and oversized patches show an
unavailable message. Azure text versions are limited to 250,000 characters and
patch lookup to the first 3,000 changed files. Open the provider link for content
outside these limits.

## Implementation entry points

- SDK contracts: `packages/sdk/src/shared-types/pullRequest.ts`; REST namespace:
  `packages/sdk/src/rest/pull-requests.ts`.
- Server use cases: `packages/server/src/application/pull-requests/index.ts`;
  CLI transport and adapters: `packages/server/src/infrastructure/pull-requests/`.
- Client workspace view: `packages/client/src/components/pullRequests/PullRequestsView.tsx`;
  event handling: `packages/client/src/handlers/serverMessage/pullRequestHandlers.ts`.

Automated verification uses injected CLI responses and component tests. Real
provider authentication, remote writes, and browser geometry need a manual smoke
test before release.
