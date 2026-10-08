import { describe, expect, test } from 'bun:test';
import { readFile } from 'node:fs/promises';
import { parsePullRequestRemote } from '@/infrastructure/pull-requests/repositories';
import { createGitHubPullRequests } from '@/infrastructure/pull-requests/github';
import { createAzurePullRequests } from '@/infrastructure/pull-requests/azure';
import type { CliRequest, RunCli } from '@/infrastructure/pull-requests/cli';
import { pullRequestActionSchema, pullRequestCreateSchema } from '@/transport/http/routes/pull-requests';

const head = 'a'.repeat(40);
const base = 'b'.repeat(40);
const githubRepo = parsePullRequestRemote('origin', 'git@github.com:acme/project.git')!;
const azureRepo = parsePullRequestRemote('origin', 'git@ssh.dev.azure.com:v3/acme/Product/App')!;
const ghPr = {
  number: 7,
  title: 'Feature',
  body: 'Description',
  html_url: 'https://github.com/acme/project/pull/7',
  user: { id: 1, login: 'alice' },
  state: 'open',
  draft: false,
  head: { ref: 'feature', sha: head },
  base: { ref: 'main', sha: base },
  updated_at: '2026-10-08T00:00:00Z',
  requested_reviewers: [],
  node_id: 'PR_7',
  mergeable: true,
};
const azPr = {
  pullRequestId: 7,
  title: 'Feature',
  description: 'Description',
  createdBy: { id: 'alice-id', displayName: 'Alice' },
  status: 'active',
  isDraft: false,
  sourceRefName: 'refs/heads/feature',
  targetRefName: 'refs/heads/main',
  lastMergeSourceCommit: { commitId: head },
  lastMergeTargetCommit: { commitId: base },
  creationDate: '2026-10-08T00:00:00Z',
  reviewers: [],
  repository: { project: { id: 'project-id' } },
  mergeStatus: 'succeeded',
};
const guard = { expectedHead: head, accountId: 'alice-id' };

describe('repository identity', () => {
  test.each([
    ['https://github.com/Acme/Project.git', 'github:acme/project'],
    ['ssh://git@github.com/acme/project.git', 'github:acme/project'],
    ['git@ssh.dev.azure.com:v3/acme/Product/App', 'azure:acme/product/app'],
    ['acme@vs-ssh.visualstudio.com:v3/acme/Product/App', 'azure:acme/product/app'],
    ['ssh://acme@vs-ssh.visualstudio.com/v3/acme/Product/App', 'azure:acme/product/app'],
    ['https://dev.azure.com/acme/My%20Project/_git/App', 'azure:acme/my project/app'],
    ['https://acme.visualstudio.com/Product/_git/App', 'azure:acme/product/app'],
  ])('%s resolves to a canonical repository', (url, key) =>
    expect(parsePullRequestRemote('origin', url)?.key).toBe(key),
  );
  test.each([
    'https://github.com.evil.test/acme/repo',
    'https://github.com:444/acme/repo',
    'https://user:secret@github.com/acme/repo',
    'http://github.com/acme/repo',
    'https://dev.azure.com/acme/project/_git/%2Fsecret',
    'file:///repo',
    'https://github.com/acme/repo/extra',
    'git@vs-ssh.visualstudio.com.evil.test:v3/acme/Product/App',
    'git@vs-ssh.visualstudio.com:v3/acme/Product',
  ])('rejects unsafe or unsupported remote %s', (url) =>
    expect(parsePullRequestRemote('origin', url)).toBeNull(),
  );
  test('legacy Azure SSH identifies the organization from the path, not the SSH user', () => {
    expect(
      parsePullRequestRemote('origin', 'other-user@vs-ssh.visualstudio.com:v3/acme/Product/App'),
    ).toMatchObject({
      provider: 'azure',
      host: 'dev.azure.com',
      owner: 'acme',
      project: 'Product',
      name: 'App',
      url: 'https://dev.azure.com/acme/Product/_git/App',
    });
  });
});

describe('GitHub CLI adapter', () => {
  test('create sends arbitrary markdown over stdin, never shell arguments', async () => {
    const calls: CliRequest[] = [];
    const provider = createGitHubPullRequests(
      async (call) => {
        calls.push(call);
        return JSON.stringify(ghPr);
      },
      '/checkout',
      githubRepo,
    );
    const body = 'literal $(touch nope) `hello`\nsecond line';
    await provider.create({
      title: 'Feature',
      body,
      sourceBranch: 'alice:feature',
      targetBranch: 'main',
      draft: true,
      accountId: '1',
    });
    expect(calls[0].cwd).toBe('/checkout');
    expect(calls[0].args).toEqual([
      'api',
      '--hostname',
      'github.com',
      '--method',
      'POST',
      'repos/acme/project/pulls',
      '--input',
      '-',
    ]);
    expect(JSON.parse(calls[0].input!)).toMatchObject({ body, head: 'alice:feature', draft: true });
  });
  test('rejects a stale merge without executing any write', async () => {
    const calls: CliRequest[] = [];
    const provider = createGitHubPullRequests(
      async (call) => {
        calls.push(call);
        return JSON.stringify(ghPr);
      },
      '/checkout',
      githubRepo,
    );
    await expect(
      provider.action(7, { ...guard, expectedHead: base, action: 'merge', method: 'squash' }),
    ).rejects.toThrow('changed');
    expect(calls).toHaveLength(1);
    expect(calls[0].args).toContain('GET');
  });
  test('merge sends an atomic expected SHA and verifies merged=true', async () => {
    const calls: CliRequest[] = [];
    const provider = createGitHubPullRequests(
      async (call) => {
        calls.push(call);
        return JSON.stringify(call.input ? { merged: false } : ghPr);
      },
      '/checkout',
      githubRepo,
    );
    await expect(provider.action(7, { ...guard, action: 'merge', method: 'squash' })).rejects.toThrow(
      'did not merge',
    );
    expect(JSON.parse(calls[1].input!)).toEqual({ sha: head, merge_method: 'squash' });
  });
  test('inline review uses the displayed commit and diff side', async () => {
    const calls: CliRequest[] = [];
    const provider = createGitHubPullRequests(
      async (call) => {
        calls.push(call);
        return JSON.stringify(call.input ? {} : ghPr);
      },
      '/checkout',
      githubRepo,
    );
    await provider.action(7, {
      ...guard,
      action: 'comment',
      body: 'Why?',
      position: { path: 'src/a.ts', line: 9, side: 'LEFT' },
    });
    expect(JSON.parse(calls[1].input!)).toMatchObject({
      commit_id: head,
      path: 'src/a.ts',
      line: 9,
      side: 'LEFT',
    });
  });
  test('denies thread IDs belonging to another pull request', async () => {
    const calls: CliRequest[] = [];
    const provider = createGitHubPullRequests(
      async (call) => {
        calls.push(call);
        return JSON.stringify(
          call.input
            ? {
                data: {
                  repository: {
                    pullRequest: { reviewThreads: { pageInfo: { hasNextPage: false }, nodes: [] } },
                  },
                },
              }
            : ghPr,
        );
      },
      '/checkout',
      githubRepo,
    );
    await expect(
      provider.action(7, { ...guard, action: 'resolve', threadId: 'foreign', resolved: true }),
    ).rejects.toThrow('not part');
    expect(calls).toHaveLength(2);
  });
  test('malformed provider data fails instead of becoming a green or empty PR', async () => {
    const provider = createGitHubPullRequests(
      async () => JSON.stringify({ ...ghPr, state: 'surprise' }),
      '/checkout',
      githubRepo,
    );
    await expect(provider.summary(7)).rejects.toThrow('invalid PR state');
  });
  test('merged pagination advances by raw rows even when page contains only abandoned PRs', async () => {
    const provider = createGitHubPullRequests(
      async () => JSON.stringify(Array.from({ length: 30 }, () => ({ ...ghPr, state: 'closed' }))),
      '/checkout',
      githubRepo,
    );
    expect(await provider.list('merged', 1)).toEqual({ items: [], nextPage: 2 });
  });
});

function azureHarness(
  answer?: (request: CliRequest, resource: string, body: Record<string, unknown> | undefined) => unknown,
) {
  const calls: { request: CliRequest; resource: string; body?: Record<string, unknown> }[] = [];
  const run: RunCli = async (request) => {
    const resource = request.args[request.args.indexOf('--resource') + 1];
    const fileIndex = request.args.indexOf('--in-file');
    const body =
      fileIndex < 0
        ? undefined
        : (JSON.parse(await readFile(request.args[fileIndex + 1], 'utf8')) as Record<string, unknown>);
    calls.push({ request, resource, body });
    const result =
      answer?.(request, resource, body) ??
      (resource === 'pullRequests'
        ? azPr
        : resource === 'pullRequestIterations'
          ? { value: [{ id: 3, sourceRefCommit: { commitId: head }, commonRefCommit: { commitId: base } }] }
          : {});
    return JSON.stringify(result);
  };
  return { calls, provider: createAzurePullRequests(run, '/checkout', azureRepo) };
}

describe('Azure CLI adapter', () => {
  test('renamed patches read the original path at the common commit', async () => {
    const { provider, calls } = azureHarness((request, resource) => {
      if (resource === 'pullRequestIterationChanges')
        return {
          changeEntries: [
            {
              item: { path: '/new.ts' },
              sourceServerItem: '/old.ts',
              changeType: 'edit, rename',
              changeTrackingId: 8,
            },
          ],
          nextSkip: 0,
        };
      if (resource === 'items')
        return {
          content: request.args.includes(`versionDescriptor.version=${base}`) ? 'old\n' : 'new\n',
          contentMetadata: { isBinary: false },
        };
    });
    const result = await provider.patch(7, head, '/new.ts');
    expect(result.patch).toContain('--- a/old.ts');
    expect(result.patch).toContain('+++ b/new.ts');
    const reads = calls.filter((c) => c.resource === 'items');
    expect(reads[0].request.args).toContain('path=/old.ts');
    expect(reads[0].request.args).toContain(`versionDescriptor.version=${base}`);
    expect(reads[1].request.args).toContain(`versionDescriptor.version=${head}`);
  });
  test.each([true, false])(
    'binary and oversized content are explicitly unavailable (binary=%s)',
    async (isBinary) => {
      const { provider } = azureHarness((_request, resource) => {
        if (resource === 'pullRequestIterationChanges')
          return {
            changeEntries: [{ item: { path: '/file' }, changeType: 'add', changeTrackingId: 8 }],
            nextSkip: 0,
          };
        if (resource === 'items')
          return { content: isBinary ? '' : 'x'.repeat(250_001), contentMetadata: { isBinary } };
      });
      expect(await provider.patch(7, head, '/file')).toMatchObject({
        patch: '',
        unavailable: expect.stringContaining('Binary or large'),
      });
    },
  );
  test('rejects patches if the source changes while reading file content', async () => {
    let reads = 0;
    const { provider } = azureHarness((_request, resource) => {
      if (resource === 'pullRequests' && ++reads > 1)
        return { ...azPr, lastMergeSourceCommit: { commitId: base } };
      if (resource === 'pullRequestIterationChanges')
        return {
          changeEntries: [{ item: { path: '/file' }, changeType: 'add', changeTrackingId: 8 }],
          nextSkip: 0,
        };
      if (resource === 'items') return { content: 'hello', contentMetadata: { isBinary: false } };
    });
    await expect(provider.patch(7, head, '/file')).rejects.toThrow('changed');
  });
  test('keeps file-level conversations and omits deleted threads', async () => {
    const { provider } = azureHarness((_request, resource) => {
      if (resource === 'pullRequestThreads')
        return {
          value: [
            { id: 1, threadContext: { filePath: '/a.ts' }, status: 'active', comments: [] },
            { id: 2, isDeleted: true },
          ],
        };
      if (resource === 'pullRequestStatuses' || resource === 'evaluations') return { value: [] };
    });
    const detail = await provider.detail(7);
    expect(detail.threads).toEqual([
      { id: '1', path: '/a.ts', resolved: false, outdated: false, canResolve: true, comments: [] },
    ]);
    expect(detail.warnings).toEqual([]);
  });
  test('automatic completion uses the viewer identity and preserves policy enforcement', async () => {
    const { provider, calls } = azureHarness();
    await provider.action(7, { ...guard, action: 'enable-auto-merge', method: 'rebase-merge' });
    expect(calls.at(-1)?.body).toEqual({
      autoCompleteSetBy: { id: 'alice-id' },
      completionOptions: { mergeStrategy: 'rebaseMerge', deleteSourceBranch: false, bypassPolicy: false },
    });
  });
  test('authenticates against organization connection data rather than an unrelated az subscription', async () => {
    const { provider, calls } = azureHarness((_r, resource) =>
      resource === 'connectionData'
        ? { authenticatedUser: { id: 'pat-user', providerDisplayName: 'Pat user' } }
        : undefined,
    );
    expect(await provider.account()).toEqual({ id: 'pat-user', name: 'Pat user' });
    expect(calls[0].request.args).toContain('location');
    expect(calls[0].request.args).toContain('https://dev.azure.com/acme');
    expect(calls[0].request.args).toContain('7.1-preview');
    expect(calls[0].request.args).not.toContain('--route-parameters');
  });
  test('completion preserves head guard and never bypasses policy', async () => {
    const { provider, calls } = azureHarness();
    await provider.action(7, { ...guard, action: 'merge', method: 'rebase' });
    expect(calls[1].body).toMatchObject({
      lastMergeSourceCommit: { commitId: head },
      completionOptions: { mergeStrategy: 'rebase', bypassPolicy: false, deleteSourceBranch: false },
    });
  });
  test('inline comment carries file tracking and iteration, and deletes its temporary JSON body', async () => {
    const { provider, calls } = azureHarness();
    await provider.action(7, {
      ...guard,
      action: 'comment',
      body: 'Check this',
      position: { path: '/a.ts', line: 3, side: 'RIGHT', iteration: 3, changeTrackingId: 8 },
    });
    const call = calls.at(-1)!;
    expect(call.body).toMatchObject({
      threadContext: { filePath: '/a.ts', rightFileStart: { line: 3, offset: 1 } },
      pullRequestThreadContext: {
        changeTrackingId: 8,
        iterationContext: { firstComparingIteration: 3, secondComparingIteration: 3 },
      },
    });
    await expect(readFile(call.request.args[call.request.args.indexOf('--in-file') + 1])).rejects.toThrow();
  });
  test('rejects an outdated iteration before writing', async () => {
    const { provider, calls } = azureHarness();
    await expect(
      provider.action(7, {
        ...guard,
        action: 'comment',
        body: 'Check',
        position: { path: '/a.ts', line: 3, side: 'RIGHT', iteration: 2, changeTrackingId: 8 },
      }),
    ).rejects.toThrow('position changed');
    expect(calls.every((c) => !c.body)).toBe(true);
  });
  test.each([
    ['approve', 10],
    ['approve-with-suggestions', 5],
    ['request-changes', -10],
    ['wait', -5],
    ['reset', 0],
  ] as const)('preserves Azure vote %s', async (verdict, vote) => {
    const { provider, calls } = azureHarness();
    await provider.action(7, { ...guard, action: 'review', verdict, body: '' });
    expect(calls.at(-1)?.body).toEqual({ id: 'alice-id', vote });
  });
  test('reports a partial review without silently reposting its successful comment', async () => {
    const { provider, calls } = azureHarness((_r, resource) => {
      if (resource === 'pullRequestReviewers') throw new Error('denied');
    });
    await expect(
      provider.action(7, { ...guard, action: 'review', verdict: 'approve', body: 'Looks good' }),
    ).rejects.toThrow('comment was posted');
    expect(calls.filter((c) => c.resource === 'pullRequestThreads')).toHaveLength(1);
  });
});

describe('wire validation', () => {
  const input = { ...guard, remote: 'origin', repositoryKey: githubRepo.key };
  test.each([
    { action: 'merge', method: 'squash', bypassPolicy: true },
    { action: 'comment', body: ' ' },
    { action: 'review', verdict: 'request-changes', body: '' },
    { action: 'reviewer', reviewer: '--admin', remove: false },
    { action: 'comment', body: 'hi', position: { path: 'a', line: 0, side: 'RIGHT' } },
  ])('rejects invalid action %#', (action) =>
    expect(pullRequestActionSchema.safeParse({ ...input, ...action }).success).toBe(false),
  );
  test('accepts a GitHub fork selector but rejects branch argument injection', () => {
    const create = {
      remote: 'origin',
      repositoryKey: githubRepo.key,
      title: 'Feature',
      body: '',
      sourceBranch: 'alice:feature',
      targetBranch: 'main',
      draft: true,
      accountId: '1',
    };
    expect(pullRequestCreateSchema.safeParse(create).success).toBe(true);
    expect(pullRequestCreateSchema.safeParse({ ...create, sourceBranch: '--admin' }).success).toBe(false);
    expect(
      pullRequestActionSchema.safeParse({
        ...input,
        action: 'merge',
        method: 'squash',
        expectedHead: 'a'.repeat(41),
      }).success,
    ).toBe(false);
  });
});
