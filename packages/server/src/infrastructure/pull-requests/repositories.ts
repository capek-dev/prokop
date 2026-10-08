import type { PullRequestRepository } from '@prokopai/sdk/types';
import { git, getGitRepository } from '@/infrastructure/filesystem/git-operations';

/** Only supported, canonical public hosts. Never turn a client-supplied URL into a credential target. */
export function parsePullRequestRemote(remote: string, url: string): PullRequestRepository | null {
  let host: string;
  let path: string;
  try {
    const scp = /^(?:[^@/:]+@)?([^/:]+):(.+)$/.exec(url);
    if (scp && !url.includes('://')) {
      host = scp[1].toLowerCase();
      path = scp[2];
    } else {
      const parsed = new URL(url);
      if (!['https:', 'ssh:'].includes(parsed.protocol) || parsed.password || parsed.port) return null;
      host = parsed.hostname.toLowerCase();
      path = parsed.pathname;
    }
    const parts = path
      .replace(/^\/+|\/+$/g, '')
      .replace(/\.git$/, '')
      .split('/')
      .map(decodeURIComponent);
    if (
      parts.some(
        (p) => !p || p === '.' || p === '..' || [...p].some((c) => c.charCodeAt(0) < 32) || /[/\\?#]/.test(p),
      )
    )
      return null;
    if (host === 'github.com' && parts.length === 2 && parts.every((p) => /^[\w.-]+$/.test(p))) {
      const [owner, name] = parts;
      return {
        provider: 'github',
        host,
        owner,
        name,
        remote,
        key: `github:${owner.toLowerCase()}/${name.toLowerCase()}`,
        url: `https://github.com/${owner}/${name}`,
      };
    }
    let owner: string;
    let project: string;
    let name: string;
    if (host === 'dev.azure.com' && parts.length === 4 && parts[2] === '_git')
      [owner, project, , name] = parts;
    else if (
      (host === 'ssh.dev.azure.com' || host === 'vs-ssh.visualstudio.com') &&
      parts.length === 4 &&
      parts[0] === 'v3'
    )
      [, owner, project, name] = parts;
    else if (/^[\w-]+\.visualstudio\.com$/.test(host) && parts.length === 3 && parts[1] === '_git') {
      owner = host.split('.')[0];
      [project, , name] = parts;
    } else return null;
    if (!/^[\w-]+$/.test(owner)) return null;
    return {
      provider: 'azure',
      host: 'dev.azure.com',
      owner,
      project,
      name,
      remote,
      key: `azure:${owner.toLowerCase()}/${project.toLowerCase()}/${name.toLowerCase()}`,
      url: `https://dev.azure.com/${owner}/${encodeURIComponent(project)}/_git/${encodeURIComponent(name)}`,
    };
  } catch {
    return null;
  }
}

export async function discoverPullRequestRepositories(
  root: string,
): Promise<{ repositories: PullRequestRepository[]; branch: string | null }> {
  const state = await getGitRepository(root);
  const repositories: PullRequestRepository[] = [];
  for (const remote of state.remotes) {
    if (!/^[A-Za-z0-9][A-Za-z0-9._/-]*$/.test(remote)) continue;
    const url = (await git(root, ['remote', 'get-url', remote])).stdout.trim();
    const repository = parsePullRequestRemote(remote, url);
    if (repository) repositories.push(repository);
  }
  return { repositories, branch: state.branch };
}
