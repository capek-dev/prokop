import { lstat, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import type { GitBranchAction, GitBranchesResult, GitBranchPushTarget, GitBranchPushReview, GitHistoryEntry, GitHistoryResult, GitCommitDetails } from '@prokopai/sdk';
import { git, getGitRepository, previewGitPush } from './git-operations';
import { withGitActionLock } from './git-action-lock';

const SHA = /^(?:[a-f0-9]{40}|[a-f0-9]{64})$/;
function fail(message: string): never { throw new Error(`Git operation: ${message}`); }
async function commitExists(root: string, head: string): Promise<void> {
  if (!SHA.test(head)) fail('invalid commit SHA.');
  await git(root, ['cat-file', '-e', `${head}^{commit}`]);
}
async function branchName(root: string, name: string): Promise<void> {
  if (!name || name.startsWith('-') || (await git(root, ['check-ref-format', `refs/heads/${name}`], { allowFailure: true })).code) fail('invalid branch name.');
}
async function remoteName(root: string, remote: string): Promise<void> {
  if (!/^[A-Za-z0-9][A-Za-z0-9._/-]*$/.test(remote) || !(await getGitRepository(root)).remotes.includes(remote)) fail('choose a configured remote.');
}
async function sourceHead(root: string, input: GitBranchPushTarget): Promise<void> {
  await branchName(root, input.sourceBranch);
  await commitExists(root, input.expectedHead);
  const current = (await git(root, ['rev-parse', '--verify', `refs/heads/${input.sourceBranch}`])).stdout.trim();
  if (current !== input.expectedHead) fail('source branch changed. Review its outgoing commits again.');
}

export async function listGitBranches(root: string): Promise<GitBranchesResult> {
  const repository = await getGitRepository(root);
  const worktrees = (await git(root, ['worktree', 'list', '--porcelain', '-z'])).stdout.split('\0');
  const checkedOut = new Set(worktrees.filter((line) => line.startsWith('branch ')).map((line) => line.slice(7)));
  const output = (await git(root, ['for-each-ref', '--sort=refname', '--format=%(refname)%00%(objectname)%00%(upstream)%00%(upstream:track)%00%(symref)', 'refs/heads', 'refs/remotes'])).stdout;
  const branches: GitBranchesResult['branches'] = [];
  for (const line of output.split('\n').filter(Boolean)) {
    const [ref, head, upstream, track, symbolic] = line.split('\0');
    if (symbolic) continue;
    const local = ref.startsWith('refs/heads/');
    branches.push({ ref, head, name: ref.slice(local ? 11 : 13), kind: local ? 'local' : 'remote', current: local && ref === `refs/heads/${repository.branch}`, checkedOut: checkedOut.has(ref), upstream: upstream || null,
      ahead: upstream && track !== '[gone]' ? Number(/ahead (\d+)/.exec(track)?.[1] ?? 0) : null,
      behind: upstream && track !== '[gone]' ? Number(/behind (\d+)/.exec(track)?.[1] ?? 0) : null,
    });
  }
  return { repository, branches };
}
async function log(root: string, revisions: string[], offset = 0, limit = 51): Promise<GitHistoryEntry[]> {
  const output = (await git(root, ['log', '--no-show-signature', `--skip=${offset}`, `--max-count=${limit}`, '--format=%H%x00%s%x00%an%x00%aI', '-z', ...revisions, '--'])).stdout;
  const fields = output.split('\0');
  const commits: GitHistoryEntry[] = [];
  for (let i = 0; i + 3 < fields.length; i += 4) {
    const head = fields[i].trim();
    if (!SHA.test(head)) fail('invalid Git history response.');
    commits.push({ head, subject: fields[i + 1], author: fields[i + 2], date: fields[i + 3] });
  }
  return commits;
}
export async function getGitHistory(root: string, head: string, offset: number, upstream?: string | null): Promise<GitHistoryResult> {
  await commitExists(root, head);
  if (!Number.isInteger(offset) || offset < 0 || offset > 100000) fail('invalid history offset.');
  // Annotation is against a tracking ref only; a vanished ref (gone upstream)
  // degrades to the plain single-head walk instead of failing the list.
  const upstreamRef = upstream && (await git(root, ['rev-parse', '--verify', '--quiet', upstream], { allowFailure: true })).code === 0 ? upstream : null;
  const revisions = upstreamRef ? [head, upstreamRef] : [head];
  const commits = await log(root, revisions, offset);
  const marked = await annotateSync(root, head, upstreamRef, commits);
  return { commits: marked.slice(0, 50), nextOffset: marked.length > 50 ? offset + 50 : null };
}
/** Marks local-only commits ahead and upstream-only commits behind using set difference. */
async function annotateSync(root: string, head: string, upstreamRef: string | null, commits: GitHistoryEntry[]): Promise<GitHistoryEntry[]> {
  if (!upstreamRef) return commits;
  const shas = async (revs: string[]) => new Set((await git(root, ['rev-list', ...revs, '--'])).stdout.split(/\s+/).filter(Boolean));
  const ahead = await shas([head, `^${upstreamRef}`]);
  const behind = await shas([upstreamRef, `^${head}`]);
  return commits.map((commit) => ahead.has(commit.head) ? { ...commit, sync: 'ahead' as const } : behind.has(commit.head) ? { ...commit, sync: 'behind' as const } : commit);
}
export async function getGitCommitDetails(root: string, head: string): Promise<GitCommitDetails> {
  await commitExists(root, head);
  const parent = (await git(root, ['rev-list', '--parents', '-n', '1', head])).stdout.trim().split(' ')[1];
  const base = parent ?? (await git(root, ['hash-object', '-t', 'tree', '--stdin'], { input: '' })).stdout.trim();
  const files = (await git(root, ['diff', '--name-only', '-z', '--no-renames', base, head, '--'])).stdout.split('\0').filter(Boolean);
  const patch = (await git(root, ['diff', '--no-ext-diff', '--no-textconv', '--no-color', '--no-renames', base, head, '--'])).stdout;
  return { files, patch };
}

export async function reviewGitBranchPush(root: string, input: GitBranchPushTarget): Promise<GitBranchPushReview> {
  await sourceHead(root, input);
  if ((await git(root, ['rev-parse', '--is-shallow-repository'])).stdout.trim() === 'true') fail('fetch complete history on the server before reviewing a push from a shallow repository.');
  const { remoteHead } = await previewGitPush(root, input);
  if (remoteHead) {
    const known = await git(root, ['cat-file', '-e', `${remoteHead}^{commit}`], { allowFailure: true });
    if (known.code) {
      // Review is an explicit network operation. Obtain the exact reviewed object
      // without updating tracking refs, tags, checkout or FETCH_HEAD.
      const url = (await git(root, ['remote', 'get-url', '--push', input.remote])).stdout.replace(/\r?\n$/, '');
      await git(root, ['fetch', '--no-tags', '--no-write-fetch-head', '--no-recurse-submodules', '--', url, remoteHead]);
      await commitExists(root, remoteHead);
    }
  }
  const outgoingRevisions = remoteHead ? [input.expectedHead, `^${remoteHead}`] : [input.expectedHead];
  const incomingRevisions = remoteHead ? [remoteHead, `^${input.expectedHead}`] : [];
  const count = async (revs: string[]) => Number((await git(root, ['rev-list', '--count', ...revs, '--'])).stdout.trim());
  return {
    remoteHead,
    outgoing: await log(root, outgoingRevisions, 0, 50),
    remoteOnly: remoteHead ? await log(root, incomingRevisions, 0, 50) : [],
    outgoingCount: await count(outgoingRevisions),
    remoteOnlyCount: remoteHead ? await count(incomingRevisions) : 0,
  };
}

export async function runGitBranchAction(root: string, input: GitBranchAction): Promise<{ warning?: string }> {
  return withGitActionLock(root, async () => {
    switch (input.action) {
      case 'fetch':
        await remoteName(root, input.remote);
        // Explicit heads-only destination prevents custom fetch refspecs from
        // updating local branches. No pruning or tag changes in this UI.
        await git(root, ['fetch', '--no-tags', '--no-recurse-submodules', '--refmap=', '--', input.remote, `+refs/heads/*:refs/remotes/${input.remote}/*`]);
        break;
      case 'pull': {
        await remoteName(root, input.remote);
        await branchName(root, input.branch);
        await commitExists(root, input.expectedHead);
        const validateCheckout = async () => {
          const state = await getGitRepository(root);
          if (state.branch !== input.expectedBranch || state.head !== input.expectedHead) fail('checkout changed. Refresh before pulling.');
          if (state.upstream?.remote !== input.remote || state.upstream.branch !== input.branch) fail('upstream changed or is not configured. Refresh before pulling.');
          const gitDir = (await git(root, ['rev-parse', '--absolute-git-dir'])).stdout.replace(/\r?\n$/, '');
          for (const sentinel of ['MERGE_HEAD', 'CHERRY_PICK_HEAD', 'REVERT_HEAD', 'rebase-merge', 'rebase-apply', 'sequencer', 'BISECT_LOG']) {
            if (await lstat(join(gitDir, sentinel)).then(() => true, () => false)) fail('finish the in-progress Git operation before pulling.');
          }
        };
        await validateCheckout();
        // Fetch one upstream branch only. Ignore broad configured fetch refspecs.
        const tracking = `refs/remotes/${input.remote}/${input.branch}`;
        await git(root, ['fetch', '--no-tags', '--no-recurse-submodules', '--refmap=', '--', input.remote, `+refs/heads/${input.branch}:${tracking}`]);
        const fetchedHead = (await git(root, ['rev-parse', '--verify', tracking])).stdout.trim();
        await commitExists(root, fetchedHead);
        await validateCheckout();
        if ((await git(root, ['merge-base', '--is-ancestor', fetchedHead, input.expectedHead], { allowFailure: true })).code === 0) break;
        if ((await git(root, ['merge-base', '--is-ancestor', input.expectedHead, fetchedHead], { allowFailure: true })).code !== 0) fail('local and upstream branches have diverged. Pull is fast-forward only; resolve the divergence explicitly on the server.');
        // Git permits unrelated tracked/staged edits and rejects overwrites.
        // No merge commit, rebase, autostash, or overwriting ignored local files.
        await git(root, ['merge', '--ff-only', '--no-autostash', '--no-overwrite-ignore', '--no-edit', '--', fetchedHead]);
        break;
      }
      case 'pull-branch': {
        await branchName(root, input.name);
        await commitExists(root, input.expectedHead);
        const ref = `refs/heads/${input.name}`;
        const upstream = async () => {
          const remote = (await git(root, ['config', '--get', `branch.${input.name}.remote`])).stdout.trim();
          const merge = (await git(root, ['config', '--get', `branch.${input.name}.merge`])).stdout.trim();
          await remoteName(root, remote);
          if (!merge.startsWith('refs/heads/')) fail('configure a remote upstream before pulling.');
          const branch = merge.slice(11);
          await branchName(root, branch);
          return { remote, branch };
        };
        const target = await upstream();
        const validate = async () => {
          const branches = await listGitBranches(root);
          const branch = branches.branches.find((b) => b.ref === ref);
          if (!branch || branch.head !== input.expectedHead) fail('target branch changed. Refresh before pulling.');
          if (branch.current || branch.checkedOut) fail('branch is checked out in a worktree. Pull from that checkout instead.');
          // Rebase can detach HEAD while still owning a branch. Conservatively
          // refuse active operations in every worktree, including the main one.
          const common = (await git(root, ['rev-parse', '--path-format=absolute', '--git-common-dir'])).stdout.trim();
          const linked = await readdir(join(common, 'worktrees')).catch((error: unknown) => {
            if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
            throw error;
          });
          for (const dir of [common, ...linked.map((name) => join(common, 'worktrees', name))]) {
            for (const sentinel of ['MERGE_HEAD', 'CHERRY_PICK_HEAD', 'REVERT_HEAD', 'rebase-merge', 'rebase-apply', 'sequencer', 'BISECT_LOG']) {
              const exists = await lstat(join(dir, sentinel)).then(() => true, (error: unknown) => {
                if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false;
                throw error;
              });
              if (exists) fail('finish the in-progress Git operation before pulling.');
            }
          }
          const currentUpstream = await upstream();
          if (currentUpstream.remote !== target.remote || currentUpstream.branch !== target.branch) fail('upstream changed. Refresh before pulling.');
        };
        await validate();
        const tracking = `refs/remotes/${target.remote}/${target.branch}`;
        await git(root, ['fetch', '--no-tags', '--no-recurse-submodules', '--refmap=', '--', target.remote, `+refs/heads/${target.branch}:${tracking}`]);
        const fetchedHead = (await git(root, ['rev-parse', '--verify', tracking])).stdout.trim();
        await commitExists(root, fetchedHead);
        await validate();
        if ((await git(root, ['merge-base', '--is-ancestor', fetchedHead, input.expectedHead], { allowFailure: true })).code === 0) break;
        if ((await git(root, ['merge-base', '--is-ancestor', input.expectedHead, fetchedHead], { allowFailure: true })).code !== 0) fail('local and upstream branches have diverged. Pull is fast-forward only.');
        // Ancestry is checked above; update-ref itself does not enforce FF.
        // Compare-and-swap prevents overwriting a concurrently changed branch.
        await git(root, ['update-ref', '--no-deref', '-m', 'pull: fast-forward without checkout', ref, fetchedHead, input.expectedHead]);
        break;
      }
      case 'create':
        await branchName(root, input.name);
        await commitExists(root, input.startHead);
        await git(root, ['branch', '--no-track', '--', input.name, input.startHead]);
        break;
      case 'track': {
        await remoteName(root, input.remote);
        await branchName(root, input.branch);
        await branchName(root, input.name);
        await commitExists(root, input.expectedHead);
        if ((await git(root, ['rev-parse', '--verify', `refs/heads/${input.name}`], { allowFailure: true })).code === 0) fail('local branch already exists. Switch to it or choose another name.');
        const remoteRef = `refs/remotes/${input.remote}/${input.branch}`;
        const remoteHead = (await git(root, ['rev-parse', '--verify', remoteRef])).stdout.trim();
        if (remoteHead !== input.expectedHead) fail('remote branch changed. Fetch and review again.');
        // Creates the local branch at the reviewed head with the remote ref as
        // upstream; checkout stays untouched and goes through 'switch'.
        await git(root, ['branch', '--track', '--', input.name, remoteRef]);
        break;
      }
      case 'switch': {
        await branchName(root, input.name);
        await commitExists(root, input.targetHead);
        const state = await getGitRepository(root);
        if (state.head !== input.expectedHead || state.branch !== input.expectedBranch) fail('current checkout changed. Refresh before switching.');
        const target = (await git(root, ['rev-parse', '--verify', `refs/heads/${input.name}`])).stdout.trim();
        if (target !== input.targetHead) fail('target branch changed. Refresh before switching.');
        const gitDir = (await git(root, ['rev-parse', '--absolute-git-dir'])).stdout.replace(/\r?\n$/, '');
        for (const sentinel of ['MERGE_HEAD', 'CHERRY_PICK_HEAD', 'REVERT_HEAD', 'rebase-merge', 'rebase-apply', 'sequencer', 'BISECT_LOG']) {
          if (await lstat(join(gitDir, sentinel)).then(() => true, () => false)) fail('finish the in-progress Git operation before switching.');
        }
        // Git preserves unrelated tracked/staged edits and rejects overwrites.
        // Keep --no-overwrite-ignore below to protect ignored files too.
        const branches = await listGitBranches(root);
        if (branches.branches.some((branch) => branch.name === input.name && branch.kind === 'local' && branch.checkedOut && !branch.current)) fail('branch is checked out in another worktree.');
        await git(root, ['switch', '--no-guess', '--no-overwrite-ignore', '--', input.name]);
        break;
      }
      case 'push': {
        await sourceHead(root, input);
        if (input.expectedRemoteHead !== null && !SHA.test(input.expectedRemoteHead)) fail('invalid remote lease.');
        const preview = await previewGitPush(root, input);
        if (preview.remoteHead !== input.expectedRemoteHead) fail('remote changed. Review outgoing commits again.');
        const args = ['-c', 'push.followTags=false', 'push', '--porcelain', '--no-follow-tags'];
        if (input.force) args.push(`--force-with-lease=refs/heads/${input.branch}:${input.expectedRemoteHead ?? ''}`);
        args.push('--', input.remote, `${input.expectedHead}:refs/heads/${input.branch}`);
        await git(root, args);
        // SHA-pinned pushes cannot use --set-upstream to identify the local
        // source branch. Configure it only after the remote push succeeds.
        try {
          const remote = await git(root, ['config', '--get', `branch.${input.sourceBranch}.remote`], { allowFailure: true });
          const merge = await git(root, ['config', '--get', `branch.${input.sourceBranch}.merge`], { allowFailure: true });
          if (remote.code > 1 || merge.code > 1) throw new Error('Unable to read tracking configuration');
          if (remote.code === 1 && merge.code === 1) {
            await git(root, ['branch', `--set-upstream-to=refs/remotes/${input.remote}/${input.branch}`, '--', input.sourceBranch]);
          }
        } catch {
          return { warning: 'Push succeeded, but upstream tracking could not be configured. Set the branch upstream before pulling.' };
        }
        break;
      }
    }
    return {};
  });
}
