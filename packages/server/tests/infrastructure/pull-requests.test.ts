import { describe, expect, test } from 'bun:test';
import { parsePullRequestRemote } from '@/infrastructure/pull-requests/repositories';
import { createGitHubPullRequests } from '@/infrastructure/pull-requests/github';
import { createAzurePullRequests } from '@/infrastructure/pull-requests/azure';
import type { CliRequest, RunCli } from '@/infrastructure/pull-requests/cli';
import {
  AzureSetupError,
  azureRest,
  createAzureCredentials,
  type AzureApi,
  type AzureRequest,
  type FetchLike,
} from '@/infrastructure/pull-requests/azure-rest';
import { BadRequestError } from '@/application/http-errors';
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

function azureHarness(answer?: (request: AzureRequest) => unknown) {
  const calls: AzureRequest[] = [];
  const api: AzureApi = async (request) => {
    calls.push(request);
    const result =
      answer?.(request) ??
      (/^pullrequests\/\d+$/.test(request.path)
        ? azPr
        : request.path.endsWith('/iterations')
          ? { value: [{ id: 3, sourceRefCommit: { commitId: head }, commonRefCommit: { commitId: base } }] }
          : {});
    return structuredClone(result);
  };
  const writes = () => calls.filter((c) => c.method && c.method !== 'GET');
  return { calls, writes, provider: createAzurePullRequests(api, azureRepo) };
}

describe('Azure adapter', () => {
  test('renamed patches read the original path at the common commit', async () => {
    const { provider, calls } = azureHarness((request) => {
      if (request.path.endsWith('/changes'))
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
      if (request.path === 'items')
        return {
          content: request.query?.['versionDescriptor.version'] === base ? 'old\n' : 'new\n',
          contentMetadata: { isBinary: false },
        };
    });
    const result = await provider.patch(7, head, '/new.ts');
    expect(result.patch).toContain('--- a/old.ts');
    expect(result.patch).toContain('+++ b/new.ts');
    const reads = calls.filter((c) => c.path === 'items');
    expect(reads.map((r) => [r.query?.path, r.query?.['versionDescriptor.version']])).toEqual([
      ['/old.ts', base],
      ['/new.ts', head],
    ]);
  });
  test.each([true, false])(
    'binary and oversized content are explicitly unavailable (binary=%s)',
    async (isBinary) => {
      const { provider } = azureHarness((request) => {
        if (request.path.endsWith('/changes'))
          return {
            changeEntries: [{ item: { path: '/file' }, changeType: 'add', changeTrackingId: 8 }],
            nextSkip: 0,
          };
        if (request.path === 'items')
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
    const { provider } = azureHarness((request) => {
      if (request.path === 'pullrequests/7' && ++reads > 1)
        return { ...azPr, lastMergeSourceCommit: { commitId: base } };
      if (request.path.endsWith('/changes'))
        return {
          changeEntries: [{ item: { path: '/file' }, changeType: 'add', changeTrackingId: 8 }],
          nextSkip: 0,
        };
      if (request.path === 'items') return { content: 'hello', contentMetadata: { isBinary: false } };
    });
    await expect(provider.patch(7, head, '/file')).rejects.toThrow('changed');
  });
  test('folders are not listed as changed files', async () => {
    const { provider } = azureHarness((request) =>
      request.path.endsWith('/changes')
        ? {
            changeEntries: [
              { item: { path: '/src', isFolder: true }, changeType: 'add', changeTrackingId: 1 },
              { item: { path: '/src/a.ts' }, changeType: 'add', changeTrackingId: 2 },
            ],
          }
        : undefined,
    );
    expect((await provider.files(7, head, 1)).files.map((f) => f.path)).toEqual(['/src/a.ts']);
  });
  test('keeps file-level conversations and omits deleted and system-only threads', async () => {
    const author = { id: 'bob', displayName: 'Bob' };
    const { provider } = azureHarness((request) => {
      if (request.path.endsWith('/threads'))
        return {
          value: [
            { id: 1, threadContext: { filePath: '/a.ts' }, status: 'active', comments: [] },
            {
              id: 3,
              threadContext: { filePath: '/a.ts' },
              status: 'active',
              comments: [
                { id: 1, author, content: 'Why?', publishedDate: '2026-10-08', commentType: 'text' },
              ],
            },
            { id: 2, isDeleted: true },
            {
              id: 4,
              comments: [
                { id: 1, author, content: 'Bob voted 10', publishedDate: '2026-10-08', commentType: 'system' },
              ],
            },
          ],
        };
      if (request.path.endsWith('/statuses') || request.path === 'policy/evaluations') return { value: [] };
    });
    const detail = await provider.detail(7);
    expect(detail.threads).toEqual([
      {
        id: '3',
        path: '/a.ts',
        resolved: false,
        outdated: false,
        canResolve: true,
        comments: [{ id: '1', author: { id: 'bob', name: 'Bob' }, body: 'Why?', createdAt: '2026-10-08' }],
      },
    ]);
    expect(detail.warnings).toEqual([]);
  });
  test('build policies keep their configured names and optional policies are marked', async () => {
    const { provider } = azureHarness((request) =>
      request.path === 'policy/evaluations'
        ? {
            value: [
              {
                status: 'queued',
                configuration: {
                  isBlocking: true,
                  type: { displayName: 'Build' },
                  settings: { displayName: 'CI' },
                },
                context: { buildId: 42 },
              },
              { status: 'approved', configuration: { isBlocking: false, type: { displayName: 'Reviewers' } } },
            ],
          }
        : request.path.endsWith('/threads') || request.path.endsWith('/statuses')
          ? { value: [] }
          : undefined,
    );
    expect((await provider.detail(7)).checks).toEqual([
      { name: 'CI', state: 'queued', url: 'https://dev.azure.com/acme/Product/_build/results?buildId=42' },
      { name: 'Reviewers (optional)', state: 'approved' },
    ]);
  });
  test('automatic completion uses the viewer identity and preserves policy enforcement', async () => {
    const { provider, writes } = azureHarness();
    await provider.action(7, { ...guard, action: 'enable-auto-merge', method: 'rebase-merge' });
    expect(writes().at(-1)?.body).toEqual({
      autoCompleteSetBy: { id: 'alice-id' },
      completionOptions: { mergeStrategy: 'rebaseMerge', deleteSourceBranch: false, bypassPolicy: false },
    });
  });
  test('disabling automatic completion sends the empty identity, which Azure treats as clear', async () => {
    const { provider, writes } = azureHarness();
    await provider.action(7, { ...guard, action: 'disable-auto-merge' });
    expect(writes().at(-1)?.body).toEqual({
      autoCompleteSetBy: { id: '00000000-0000-0000-0000-000000000000' },
    });
  });
  test('identifies the viewer from organization connection data', async () => {
    const { provider, calls } = azureHarness((request) =>
      request.path === 'connectionData'
        ? { authenticatedUser: { id: 'pat-user', providerDisplayName: 'Pat user' } }
        : undefined,
    );
    expect(await provider.account()).toEqual({ id: 'pat-user', name: 'Pat user' });
    expect(calls[0]).toMatchObject({ scope: 'organization', version: '7.1-preview' });
  });
  test('completion preserves head guard and never bypasses policy', async () => {
    const { provider, writes } = azureHarness();
    await provider.action(7, { ...guard, action: 'merge', method: 'rebase' });
    expect(writes()[0].body).toMatchObject({
      lastMergeSourceCommit: { commitId: head },
      completionOptions: { mergeStrategy: 'rebase', bypassPolicy: false, deleteSourceBranch: false },
    });
  });
  test('inline comment carries file tracking and iteration', async () => {
    const { provider, writes } = azureHarness();
    await provider.action(7, {
      ...guard,
      action: 'comment',
      body: 'Check this',
      position: { path: '/a.ts', line: 3, side: 'RIGHT', iteration: 3, changeTrackingId: 8 },
    });
    expect(writes().at(-1)).toMatchObject({
      path: 'pullrequests/7/threads',
      method: 'POST',
      body: {
        threadContext: { filePath: '/a.ts', rightFileStart: { line: 3, offset: 1 } },
        pullRequestThreadContext: {
          changeTrackingId: 8,
          iterationContext: { firstComparingIteration: 3, secondComparingIteration: 3 },
        },
      },
    });
  });
  test('rejects an outdated iteration before writing', async () => {
    const { provider, writes } = azureHarness();
    await expect(
      provider.action(7, {
        ...guard,
        action: 'comment',
        body: 'Check',
        position: { path: '/a.ts', line: 3, side: 'RIGHT', iteration: 2, changeTrackingId: 8 },
      }),
    ).rejects.toThrow('position changed');
    expect(writes()).toEqual([]);
  });
  test.each([
    ['approve', 10],
    ['approve-with-suggestions', 5],
    ['request-changes', -10],
    ['wait', -5],
    ['reset', 0],
  ] as const)('preserves Azure vote %s', async (verdict, vote) => {
    const { provider, writes } = azureHarness();
    await provider.action(7, { ...guard, action: 'review', verdict, body: '' });
    expect(writes().at(-1)).toMatchObject({
      path: 'pullrequests/7/reviewers/alice-id',
      method: 'PUT',
      body: { id: 'alice-id', vote },
    });
  });
  test('reports a partial review without silently reposting its successful comment', async () => {
    const { provider, calls } = azureHarness((request) => {
      if (request.path.includes('/reviewers/')) throw new Error('denied');
    });
    await expect(
      provider.action(7, { ...guard, action: 'review', verdict: 'approve', body: 'Looks good' }),
    ).rejects.toThrow('comment was posted');
    expect(calls.filter((c) => c.path.endsWith('/threads') && c.method === 'POST')).toHaveLength(1);
  });
  test('adds a reviewer by e-mail through an exact identity match', async () => {
    const id = '11111111-2222-3333-4444-555555555555';
    const { provider, writes, calls } = azureHarness((request) =>
      request.path === 'identities' ? { value: [{ id }] } : undefined,
    );
    await provider.action(7, { ...guard, action: 'reviewer', reviewer: 'bob@example.com', remove: false });
    expect(calls.find((c) => c.path === 'identities')).toMatchObject({
      scope: 'identities',
      query: { searchFilter: 'General', filterValue: 'bob@example.com' },
    });
    expect(writes()).toEqual([
      { path: `pullrequests/7/reviewers/${id}`, method: 'PUT', body: { id, vote: 0 } },
    ]);
  });
  test('refuses an ambiguous reviewer instead of guessing', async () => {
    const { provider, writes } = azureHarness((request) =>
      request.path === 'identities' ? { value: [{ id: 'a' }, { id: 'b' }] } : undefined,
    );
    await expect(
      provider.action(7, { ...guard, action: 'reviewer', reviewer: 'bob', remove: false }),
    ).rejects.toThrow('several');
    expect(writes()).toEqual([]);
  });
  test('removes a reviewer identity without a lookup', async () => {
    const id = '11111111-2222-3333-4444-555555555555';
    const { provider, writes, calls } = azureHarness();
    await provider.action(7, { ...guard, action: 'reviewer', reviewer: id, remove: true });
    expect(calls.some((c) => c.path === 'identities')).toBe(false);
    expect(writes()).toEqual([{ path: `pullrequests/7/reviewers/${id}`, method: 'DELETE' }]);
  });
});

describe('Azure REST transport', () => {
  const tenant = '479b24df-2b4c-4c28-9ced-2eebf82e9ab8';
  function transport({
    tenantHeader = tenant,
    accounts = [] as Record<string, unknown>[],
    token = (): unknown => ({ accessToken: 'token', expires_on: Math.floor(Date.now() / 1000) + 3600 }),
    response = (): Response => Response.json({ ok: true }),
    env = {} as Record<string, string>,
  } = {}) {
    const cli: CliRequest[] = [];
    const requests: { url: string; init: RequestInit }[] = [];
    const run: RunCli = async (request) => {
      cli.push(request);
      if (request.args[1] === 'list') return JSON.stringify(accounts);
      return JSON.stringify(token());
    };
    const fetcher: FetchLike = async (url, init) => {
      requests.push({ url, init });
      if (init.method === 'HEAD')
        return new Response(null, { status: 405, headers: { 'x-vss-resourcetenant': tenantHeader } });
      return response();
    };
    const credentials = createAzureCredentials(run, fetcher, env);
    return { cli, requests, api: azureRest(fetcher, credentials, azureRepo) };
  }
  const header = (init: RequestInit) => (init.headers as Record<string, string>).authorization;

  test("mints a token for the organization's own tenant, not the default az tenant", async () => {
    const { cli, requests, api } = transport();
    await api({ path: 'pullrequests/7' });
    expect(requests[0]).toMatchObject({ url: 'https://dev.azure.com/acme/_apis/connectionData' });
    expect(cli.at(-1)?.args).toEqual([
      'account',
      'get-access-token',
      '--resource',
      '499b84ac-1321-427f-aa17-267ca6975798',
      '--tenant',
      tenant,
      '--only-show-errors',
      '--output',
      'json',
    ]);
    expect(requests[1].url).toBe(
      'https://dev.azure.com/acme/Product/_apis/git/repositories/App/pullrequests/7?api-version=7.1',
    );
    expect(header(requests[1].init)).toBe('Bearer token');
  });
  test('prefers the az account signed in to that tenant over the default account', async () => {
    const { cli, api } = transport({
      accounts: [
        { id: 'default-sub', tenantId: 'other', isDefault: true },
        { id: 'tenant-sub', tenantId: tenant.toUpperCase(), isDefault: false },
      ],
    });
    await api({ path: 'pullrequests/7' });
    expect(cli.at(-1)?.args).toContain('tenant-sub');
    expect(cli.at(-1)?.args).not.toContain('--tenant');
  });
  test('organizations without a tenant use the default az account', async () => {
    const { cli, api } = transport({ tenantHeader: '00000000-0000-0000-0000-000000000000' });
    await api({ path: 'pullrequests/7' });
    expect(cli).toHaveLength(1);
    expect(cli[0].args).not.toContain('--tenant');
  });
  test('reuses one token across concurrent and later requests', async () => {
    const { cli, api } = transport({ tenantHeader: '' });
    await Promise.all([api({ path: 'a' }), api({ path: 'b' }), api({ path: 'c' })]);
    await api({ path: 'd' });
    expect(cli).toHaveLength(1);
  });
  test('mints again when the cached token is about to expire', async () => {
    const { cli, api } = transport({
      tenantHeader: '',
      token: () => ({ accessToken: 'token', expires_on: Math.floor(Date.now() / 1000) + 60 }),
    });
    await api({ path: 'a' });
    await api({ path: 'b' });
    expect(cli).toHaveLength(2);
  });
  test('a tenant membership failure names the exact sign-in command', async () => {
    const run: RunCli = async (request) => {
      if (request.args[1] === 'list') return '[]';
      throw new BadRequestError(
        request.classify?.('AADSTS50020: User account does not exist in tenant') ?? 'generic',
      );
    };
    const fetcher: FetchLike = async () =>
      new Response(null, { status: 405, headers: { 'x-vss-resourcetenant': tenant } });
    const failure = await azureRest(fetcher, createAzureCredentials(run, fetcher, {}), azureRepo)({
      path: 'x',
    }).catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(AzureSetupError);
    expect((failure as AzureSetupError).message).toContain('not a member');
    expect((failure as AzureSetupError).details).toEqual({
      command: `az login --tenant ${tenant} --allow-no-subscriptions`,
    });
  });
  test('a personal access token from AZURE_DEVOPS_EXT_PAT skips az entirely', async () => {
    const { cli, requests, api } = transport({ env: { AZURE_DEVOPS_EXT_PAT: 'pat' } });
    await api({ path: 'a' });
    expect(cli).toEqual([]);
    expect(header(requests.at(-1)!.init)).toBe(`Basic ${Buffer.from(':pat').toString('base64')}`);
  });
  test("surfaces Azure's own error message for rejected writes", async () => {
    const { api } = transport({
      response: () =>
        Response.json({ message: 'TF401179: An active pull request already exists.' }, { status: 409 }),
    });
    await expect(api({ path: 'pullrequests', method: 'POST', body: {} })).rejects.toThrow('TF401179');
  });
  test('an HTML sign-in page is an authentication failure, not data, and drops the token', async () => {
    let page = true;
    const { cli, api } = transport({
      tenantHeader: '',
      response: () =>
        page
          ? new Response('<html>Sign in</html>', { status: 203, headers: { 'content-type': 'text/html' } })
          : Response.json({}),
    });
    await expect(api({ path: 'a' })).rejects.toBeInstanceOf(AzureSetupError);
    page = false;
    await api({ path: 'a' });
    expect(cli).toHaveLength(2);
  });
  test('sends JSON bodies with the requested method and API version', async () => {
    const { requests, api } = transport({ tenantHeader: '' });
    await api({
      path: 'policy/evaluations',
      scope: 'project',
      query: { artifactId: 'vstfs:///x' },
      version: '7.1-preview.1',
    });
    await api({ path: 'pullrequests/7', method: 'PATCH', body: { title: 'New' } });
    expect(requests[1].url).toBe(
      'https://dev.azure.com/acme/Product/_apis/policy/evaluations?artifactId=vstfs%3A%2F%2F%2Fx&api-version=7.1-preview.1',
    );
    expect(requests[2].init).toMatchObject({ method: 'PATCH', body: '{"title":"New"}' });
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
